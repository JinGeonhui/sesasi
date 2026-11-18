import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protectedHandler, fields, jsonBody, HttpError } from '../supabase/functions/_shared/http.ts';
import { validateSubmission, webhookURL, emptyDiscordState, discordStatus } from '../supabase/functions/_shared/discord-contract.ts';
import { deliverDiscord } from '../supabase/functions/_shared/discord-delivery.ts';
import { discordMessages } from '../supabase/functions/_shared/discord-format.ts';
const env = key => ({ SESASI_OWNER_EMAIL: 'owner@example.com', SESASI_ALLOWED_ORIGINS: 'http://localhost:3000' })[key];
const user = { id: 'owner', email: 'owner@example.com', confirmed: true };
const req = (token = 'valid', origin = 'http://localhost:3000', method = 'GET') => new Request('https://project.supabase.co/functions/v1/weather', { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const webhook = `https://discord.com/api/v10/webhooks/123456789012345678/${'x'.repeat(60)}`;
const memo = { id: 'a', kind: 'todo', date: '2026-11-19', title: '면허 시험', category: '면허', done: false, order: '1', createdOn: '2026-11-18' };

test('미인증·위조 토큰·타인·미확인 이메일은 개인 함수에 접근하지 못한다', async () => {
  let calls = 0;
  for (const [token, identity, status] of [['', user, 401], ['forged', null, 401], ['valid', { ...user, email: 'other@example.com' }, 403], ['valid', { ...user, confirmed: false }, 403]]) {
    const run = protectedHandler(env, async () => identity, async () => { calls++; return Response.json({ ok: true }); });
    assert.equal((await run(req(token))).status, status);
  }
  assert.equal(calls, 0);
  const run = protectedHandler(env, async () => user, async () => Response.json({ ok: true }));
  assert.equal((await run(req())).status, 200);
});
test('CORS 허용 목록을 검사하고 preflight에는 로그인을 요구하지 않는다', async () => {
  const run = protectedHandler(env, async () => { throw new Error('must not authenticate'); }, async () => assert.fail());
  assert.equal((await run(req('valid', 'https://other.invalid'))).status, 403);
  const response = await run(req('', 'http://localhost:3000', 'OPTIONS'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});
test('서버 미설정과 내부 오류를 구분하고 비밀키·오류 원문을 노출하지 않는다', async () => {
  const missing = protectedHandler(() => undefined, async () => user, async () => assert.fail());
  assert.equal((await missing(req())).status, 503);
  const run = protectedHandler(env, async () => user, async () => { throw new Error('private-webhook-secret'); });
  const response = await run(req());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { code: 'SERVER_UNAVAILABLE' });
  const limited = protectedHandler(env, async () => user, async () => { throw new HttpError(429, 'RATE_LIMITED', 60); });
  assert.equal((await limited(req())).headers.get('retry-after'), '60');
});
test('허용되지 않은 URL·중복 필드·큰 본문을 거부한다', async () => {
  assert.throws(() => fields(new URL('https://example.com/?city=a&city=b'), ['city']));
  assert.throws(() => fields(new URL('https://example.com/?city=a&url=secret'), ['city']));
  const body = new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '한'.repeat(40) }) });
  await assert.rejects(jsonBody(body, 100), error => error.status === 413);
  assert.throws(() => webhookURL('https://other.invalid/api/webhooks/123/secret'));
  assert.equal(webhookURL(webhook), webhook);
});
test('날짜·중복 ID 검증과 기존 디스코드 메모 형식을 유지한다', () => {
  const submission = { sourceId: 'source-1234567890123456', todos: [memo] };
  assert.equal(validateSubmission(submission).todos.length, 1);
  assert.throws(() => validateSubmission({ ...submission, todos: [memo, memo] }));
  assert.throws(() => validateSubmission({ ...submission, todos: [{ ...memo, date: '2026-02-30' }] }));
  assert.equal(discordMessages(memo.date, [memo])[0], '# 2026.11.19\n1. [면허] 면허 시험');
  assert.equal(discordMessages(memo.date, [{ ...memo, done: true }])[0], '# 2026.11.19\n- ~~[면허] 면허 시험~~');
});
test('전송 실패 뒤 성공한 부분부터 이어 보내며 중복 게시를 막는다', async () => {
  const state = emptyDiscordState(); state.sourceId = 'source-1234567890123456'; state.desired = { '2026-11-19': ['first', 'second'] };
  const calls = []; let fail = true, time = 100000; const saves = [];
  const fetcher = async (_url, init) => {
    const content = JSON.parse(init.body).content; calls.push(content);
    assert.deepEqual(JSON.parse(init.body).allowed_mentions, { parse: [] });
    if (content === 'second' && fail) throw new Error('network');
    return Response.json({ id: content === 'first' ? '123456789012345678' : '123456789012345679' });
  };
  await deliverDiscord(state, webhook, '2026-11-19', async value => saves.push(structuredClone(value)), fetcher, () => time);
  assert.equal(state.messages['2026-11-19'].length, 1);
  assert.equal(state.error, 'DISCORD_UNAVAILABLE');
  fail = false; time += 30001;
  await deliverDiscord(state, webhook, '2026-11-19', async value => saves.push(structuredClone(value)), fetcher, () => time);
  assert.deepEqual(calls, ['first', 'second', 'second']);
  assert.equal(state.error, '');
  assert.equal((await discordStatus(state, state.sourceId, true, '2026-11-19')).pending, false);
  assert.equal((await discordStatus(state, 'another-browser', true, '2026-11-19')).error, 'SOURCE_MISMATCH');
});
test('요청 제한 재시도 시각과 날짜 범위를 지키고 상태 저장 실패 시 전송하지 않는다', async () => {
  const state = emptyDiscordState(); state.desired = { '2026-11-18': ['old'], '2026-11-19': ['new'] };
  let calls = 0;
  const limited = async (_url, init) => { calls++; assert.equal(JSON.parse(init.body).content, 'new'); return Response.json({ retry_after: 120 }, { status: 429 }); };
  await deliverDiscord(state, webhook, '2026-11-19', async () => {}, limited, () => 1000);
  assert.equal(state.retryAt, 121000);
  await deliverDiscord(state, webhook, '2026-11-19', async () => {}, limited, () => 2000);
  assert.equal(calls, 1);
  state.retryAt = 0;
  await assert.rejects(deliverDiscord(state, webhook, '2026-11-19', async () => { throw new Error('lost lease'); }, async () => { calls++; return Response.json({}); }, () => 1000));
  assert.equal(calls, 1);
});
