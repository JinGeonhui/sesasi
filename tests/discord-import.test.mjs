import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscordMemo, prepareImport } from '../supabase/functions/_shared/discord-import.ts';
import { createDiscordImportHandler } from '../supabase/functions/_shared/discord-import-handler.ts';
import { discordLines } from '../supabase/functions/_shared/discord-format.ts';

const content = '# 2026.11.18\n- ~~[면허] 오후 4시 10분 시험~~ >> 95점, 합격\n- [일상] 선물(42680원 소비), 추가 기록 >> 문자\n1. [작업] 개인 프젝 개선';
const source = '123456789012345678', channel = '223456789012345678', guild = '323456789012345678', author = '423456789012345678';
const created = '2026-11-17T16:00:00.000Z', later = '2026-11-18T03:00:00.000Z';
const initial = () => ({ state: null, revision: 0, records: [], boundIds: [] });
function apply(snapshot, change) {
  if (!change) return snapshot;
  const records = new Map(snapshot.records.map(row => [`${row.collection}:${row.key}`, row]));
  for (const row of change.changes) records.set(`${row.collection}:${row.key}`, { ...row, revision: row.revision + 1 });
  return { ...snapshot, records: [...records.values()], state: change.state, revision: snapshot.revision + 1, boundIds: change.state.rows.map(row => row.id) };
}
function setup(text = content) {
  const rows = parseDiscordMemo(text);
  let n = 0;
  return apply(initial(), prepareImport(initial(), rows, source, created, created, false, () => `uuid-${++n}`));
}
const entry = (snapshot, i = 0) => snapshot.records.find(row => row.key === snapshot.state.rows[i].id);
const memoConflict = fn => assert.throws(fn, error => error.code === 'MEMO_CONFLICT');

test('date/list/strike syntax is parsed; arrows, commas and all body punctuation stay plain text', () => {
  const rows = parseDiscordMemo(content);
  assert.deepEqual(rows.map(row => [row.memoType, row.done]), [['planned', true], ['recorded', false], ['planned', false]]);
  assert.equal(rows[0].title, '오후 4시 10분 시험 >> 95점, 합격');
  assert.equal(rows[1].title, '선물(42680원 소비), 추가 기록 >> 문자');
  assert.equal(rows[0].date, '2026-11-18');
  assert.equal(Object.keys(rows[0]).includes('result'), false);
  const plain = '문장, ... >> 문자 / 1. 숫자 - 하이픈 ~~일반~~ **text**';
  assert.equal(parseDiscordMemo(`# 2026.11.18\n- [작업] ${plain}`)[0].title, plain);
  assert.equal(parseDiscordMemo('# 2026.11.18\n- [작업]  앞뒤 공백  ')[0].title, ' 앞뒤 공백  ');
  assert.equal(parseDiscordMemo('일반 대화, 숫자 1. 내용'), null);
  assert.equal(parseDiscordMemo('# 2026.11.18\n\n# 2026.11.19\n1. [작업] 새벽 계획')[0].date, '2026-11-19');
});
test('invalid or partial input rejects the whole message, never a partial import', () => {
  for (const text of ['# 2026.02.30\n- [작업] 내용', '# 2026.11.18\n- ~~[작업] 내용', '# 2026.11.18\n1. ~~[작업] 내용~~', content + '\n인식 못한 행', '# 2026.11.18\n- [작업] ' + '가'.repeat(121)]) {
    assert.throws(() => parseDiscordMemo(text), error => error.code === 'INVALID_MEMO_FORMAT');
  }
});
test('creates explicit types, categories and Korean creation date; repeat delivery is idempotent', () => {
  const snapshot = setup();
  assert.equal(snapshot.records.filter(row => row.collection === 'entries').length, 3);
  assert.equal(snapshot.records.filter(row => row.collection === 'categories').length, 3);
  assert.equal(entry(snapshot).value.createdOn, '2026-11-18');
  assert.equal(entry(snapshot, 2).value.memoType, 'planned');
  assert.equal(prepareImport(snapshot, parseDiscordMemo(content), source, created, created), null);
  const lines = discordLines('2026-11-18', snapshot.records.filter(row => row.collection === 'entries').map(row => row.value));
  assert.ok(lines[0].startsWith('- ~~[면허]'));
  assert.ok(lines[0].includes('95점, 합격'));
});
test('completion and plain text edits retain the same entry IDs', () => {
  const snapshot = setup();
  const changed = content.replace('1. [작업] 개인 프젝 개선', '- ~~[작업] 개인 프젝 개선~~').replace('95점, 합격', '100점, 합격');
  const next = apply(snapshot, prepareImport(snapshot, parseDiscordMemo(changed), source, created, later));
  assert.deepEqual(next.state.rows.map(row => row.id), snapshot.state.rows.map(row => row.id));
  assert.equal(entry(next, 2).value.done, true);
  assert.equal(entry(next).value.title, '오후 4시 10분 시험 >> 100점, 합격');
});
test('unchanged source fields preserve app edits; changed fields merge without overwriting them', () => {
  const snapshot = setup();
  entry(snapshot, 2).value.done = true;
  entry(snapshot, 2).revision++;
  const changed = content.replace('개인 프젝 개선', '개인 프젝 개선, 본문 수정');
  const next = apply(snapshot, prepareImport(snapshot, parseDiscordMemo(changed), source, created, later));
  assert.equal(entry(next, 2).value.done, true);
  assert.equal(entry(next, 2).value.title, '개인 프젝 개선, 본문 수정');
});
test('same-field edits and stale state/type changes conflict instead of silently winning', () => {
  const snapshot = setup();
  entry(snapshot, 2).value.title = '앱에서 다른 제목';
  memoConflict(() => prepareImport(snapshot, parseDiscordMemo(content.replace('개인 프젝 개선', '디스코드에서 다른 제목')), source, created, later));
  entry(snapshot, 2).value.title = '개인 프젝 개선';
  entry(snapshot, 2).value.memoType = 'recorded';
  memoConflict(() => prepareImport(snapshot, parseDiscordMemo(content.replace('1. [작업] 개인 프젝 개선', '- ~~[작업] 개인 프젝 개선~~')), source, created, later));
});
test('app tombstones cannot be resurrected by retries or edits to the Discord source', () => {
  const snapshot = setup();
  entry(snapshot, 2).value = null;
  const unchanged = prepareImport(snapshot, parseDiscordMemo(content), source, created, later);
  assert.equal(unchanged.changes.length, 0);
  memoConflict(() => prepareImport(snapshot, parseDiscordMemo(content.replace('개인 프젝 개선', '다시 생성')), source, created, later));
});
test('line deletion affects only linked unchanged entries; concurrent app changes block deletion', () => {
  const snapshot = setup();
  const changed = content.split('\n').slice(0, -1).join('\n');
  const change = prepareImport(snapshot, parseDiscordMemo(changed), source, created, later);
  assert.deepEqual(change.changes.map(row => [row.key, row.value]), [[snapshot.state.rows[2].id, null]]);
  entry(snapshot, 2).value.done = true;
  memoConflict(() => prepareImport(snapshot, parseDiscordMemo(changed), source, created, later));
});
test('deleted messages stay tombstoned; out-of-order snapshots cannot revert newer imports', () => {
  const snapshot = setup();
  snapshot.state.version = later;
  assert.equal(prepareImport(snapshot, [], source, created, created), null);
  const deleted = apply(snapshot, prepareImport(snapshot, [], source, created, '2026-11-19T00:00:00.000Z', true));
  assert.equal(deleted.state.deleted, true);
  assert.equal(prepareImport(deleted, parseDiscordMemo(content), source, created, '2026-11-20T00:00:00.000Z'), null);
});
test('exact existing memos are linked once; ambiguous duplicates and multi-line renames are rejected', () => {
  const snapshot = setup();
  const adopt = { ...snapshot, state: null, revision: 0, boundIds: [] };
  const linked = prepareImport(adopt, parseDiscordMemo(content), source, created, created);
  assert.deepEqual(linked.state.rows.map(row => row.id), snapshot.state.rows.map(row => row.id));
  memoConflict(() => prepareImport({ ...adopt, boundIds: [snapshot.state.rows[0].id] }, parseDiscordMemo(content), source, created, created));
  memoConflict(() => prepareImport(snapshot, parseDiscordMemo(content.replace('개인 프젝 개선', '다른 제목').replace('선물(42680원 소비)', '완전히 다른 내용')), source, created, later));
});

const secret = 'test-bridge-secret-'.repeat(3);
function handlerFixture() {
  const settings = { DISCORD_BRIDGE_SECRET: secret, DISCORD_OWNER_USER_ID: '11111111-0000-0000-0000-000000000001', DISCORD_CHANNEL_ID: channel, DISCORD_GUILD_ID: guild, DISCORD_AUTHOR_ID: author, DISCORD_BOT_TOKEN: 'not-a-real-bot-token', DISCORD_IMPORT_FROM: '2026-11-18', DISCORD_SYNC_FROM: '2026-11-18' };
  const calls = [];
  let snapshot = initial(), message = { id: source, channel_id: channel, author: { id: author }, timestamp: created, edited_timestamp: null, content };
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    assert.equal(args.p_user, settings.DISCORD_OWNER_USER_ID);
    if (name.endsWith('_read')) return { data: snapshot, error: null };
    if (name.endsWith('_list')) return { data: [source], error: null };
    if (name.endsWith('_commit')) { snapshot = apply(snapshot, { state: args.p_state, changes: args.p_changes }); return { data: null, error: null }; }
    throw new Error('Unexpected RPC');
  } };
  const handler = createDiscordImportHandler(key => settings[key], db, async () => Response.json({ flushed: true }), async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bot not-a-real-bot-token');
    if (url.endsWith(`/channels/${channel}`)) return Response.json({ guild_id: guild, type: 0 });
    return message ? Response.json(message) : Response.json({ code: 10008 }, { status: 404 });
  });
  const request = (body = { action: 'import', messageId: source }, headers = {}) => handler(new Request('https://example.test', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { request, calls, settings, setMessage: value => { message = value; }, getMessage: () => message, getSnapshot: () => snapshot };
}
test('bridge endpoint requires dedicated credentials and rejects browser requests before touching data', async () => {
  const f = handlerFixture();
  assert.equal((await f.request(undefined, { Authorization: '' })).status, 401);
  assert.equal((await f.request(undefined, { Origin: 'https://sesasi-six.vercel.app' })).status, 403);
  f.settings.DISCORD_BRIDGE_SECRET = '';
  assert.equal((await f.request()).status, 503);
  assert.equal(f.calls.length, 0);
});
test('server fetches the authoritative message; another author/bot/webhook cannot import memos', async () => {
  for (const patch of [{ author: { id: '999999999999999999' } }, { author: { id: author, bot: true } }, { webhook_id: '999999999999999999' }]) {
    const f = handlerFixture(); f.setMessage({ ...f.getMessage(), ...patch });
    assert.equal((await (await f.request()).json()).ignored, true);
    assert.equal(f.calls.filter(c => c.name.endsWith('_commit')).length, 0);
  }
});
test('import, repeat, authenticated listing, flush and verified deletion work without a live Discord message', async () => {
  const f = handlerFixture();
  assert.equal((await (await f.request()).json()).count, 3);
  assert.equal((await (await f.request()).json()).changed, false);
  assert.deepEqual(await (await f.request(null)).json(), { messages: [source] });
  assert.deepEqual(await (await f.request({ action: 'flush' })).json(), { flushed: true });
  f.setMessage(null);
  assert.equal((await (await f.request()).json()).count, 0);
  assert.ok(f.getSnapshot().records.filter(row => row.collection === 'entries').every(row => row.value === null));
});
test('removing a known source heading or inserting an invalid row never erases app data', async () => {
  const f = handlerFixture(); await f.request();
  f.setMessage({ ...f.getMessage(), content: '일반 대화로 수정', edited_timestamp: later });
  assert.equal((await f.request()).status, 422);
  assert.equal(f.getSnapshot().state.rows.length, 3);
});

test('imported memos and later app edits use the same canonical webhook message, without echoing stale source', async () => {
  const { handleDiscordSync } = await import('../supabase/functions/_shared/discord-sync-handler.ts');
  const snapshot = setup();
  let state = null;
  const calls = [];
  const db = { rpc: async (name, args) => {
    if (name === 'sesasi_discord_acquire') return { data: state ?? {}, error: null };
    if (name === 'sesasi_discord_records') return { data: {
      entries: snapshot.records.filter(row => row.collection === 'entries').map(row => row.value),
      categories: Object.fromEntries(snapshot.records.filter(row => row.collection === 'categories').map(row => [row.key, row.value])),
    }, error: null };
    if (name === 'sesasi_discord_save') { state = structuredClone(args.p_state); return { data: true, error: null }; }
    if (name === 'sesasi_discord_release') return { data: null, error: null };
    throw new Error('Unexpected RPC');
  } };
  const settings = { DISCORD_WEBHOOK_URL: `https://discord.com/api/webhooks/123456789012345678/${'x'.repeat(68)}`, DISCORD_SYNC_FROM: '2026-11-18' };
  const flush = () => handleDiscordSync(new Request('https://internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: 'owner-1234567890123456', todos: [] }) }), { id: 'owner-1234567890123456' }, key => settings[key], db, async (_, options) => {
    calls.push({ method: options.method, body: JSON.parse(options.body) });
    return Response.json({ id: '723456789012345678' });
  });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].body.content.includes('95점, 합격'));
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] });
  await flush();
  assert.equal(calls.length, 1);
  entry(snapshot, 2).value.done = true;
  await flush();
  assert.equal(calls[1].method, 'PATCH');
  assert.ok(calls[1].body.content.includes('- ~~[작업] 개인 프젝 개선~~'));
});

test('reordering source lines retains IDs and changes display order without resetting app completion', () => {
  const snapshot = setup();
  entry(snapshot, 2).value.done = true;
  const rows = parseDiscordMemo(content).reverse();
  const next = apply(snapshot, prepareImport(snapshot, rows, source, created, later));
  assert.deepEqual(next.state.rows.map(row => row.id), [...snapshot.state.rows].reverse().map(row => row.id));
  const sorted = next.records.filter(row => row.collection === 'entries').map(row => row.value).sort((a,b) => a.order.localeCompare(b.order));
  assert.equal(sorted[0].title, '개인 프젝 개선');
  assert.equal(sorted[0].done, true);
});
