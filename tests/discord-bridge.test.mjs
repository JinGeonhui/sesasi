import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeConfig, bridgeRequest, createBridge } from '../discord/bridge.mjs';
const env = { SUPABASE_URL: 'https://example.supabase.co', DISCORD_BOT_TOKEN: 'fake', DISCORD_BRIDGE_SECRET: 'secret'.repeat(8), DISCORD_GUILD_ID: '123456789012345678', DISCORD_CHANNEL_ID: '223456789012345678', DISCORD_AUTHOR_ID: '323456789012345678', DISCORD_IMPORT_FROM: '2026-11-18' };
const config = bridgeConfig(env);
const message = (values = {}) => ({ id: '423456789012345678', guildId: config.guildId, channelId: config.channelId, author: { id: config.authorId, bot: false }, webhookId: null, createdTimestamp: Date.parse('2026-11-18T01:00:00Z'), editedTimestamp: null, content: '# 2026.11.18\n- [작업] 메모', ...values });

test('missing/invalid settings fail closed, with no token values in errors', () => {
  assert.throws(() => bridgeConfig({}), /Missing settings/);
  assert.throws(() => bridgeConfig({ ...env, SUPABASE_URL: 'http://example.supabase.co' }), /Invalid SUPABASE_URL/);
  assert.throws(() => bridgeConfig({ ...env, DISCORD_IMPORT_FROM: '2026-02-30' }), /Invalid DISCORD_IMPORT_FROM/);
  assert.throws(() => bridgeConfig({ ...env, DISCORD_CHANNEL_ID: 'abc' }), /Invalid DISCORD_CHANNEL_ID/);
});
test('bot ignores other authors, channels, webhook echoes, old messages and normal conversation', async () => {
  const calls = [];
  const bridge = createBridge({ config, request: async value => { calls.push(value); return {}; }, fetchPage: async () => [] });
  for (const values of [{ author: { id: 'other' } }, { channelId: 'other' }, { guildId: 'other' }, { webhookId: 'webhook' }, { author: { id: config.authorId, bot: true } }, { createdTimestamp: 0 }, { content: '일반 채팅' }]) await bridge.onMessage(message(values));
  assert.equal(calls.length, 0);
  await bridge.onMessage(message()); await bridge.onMessage(message());
  assert.equal(calls.length, 1);
});
test('failed imports retry on rescan; restart and deletion are recovered from durable message mappings', async () => {
  const calls = [], reported = [];
  let fail = true, pages = [message()];
  const request = async body => {
    if (!body) return { messages: [message().id, '523456789012345678'] };
    calls.push(body);
    if (body.action === 'import' && body.messageId === message().id && fail) { const e = new Error('hidden'); e.code = 'MEMO_CONFLICT'; throw e; }
    return { imported: true };
  };
  const bridge = createBridge({ config, request, fetchPage: async () => pages, report: (...args) => reported.push(args) });
  await bridge.onMessage(message());
  fail = false;
  await bridge.scan();
  assert.equal(calls.filter(c => c.messageId === message().id).length, 2);
  assert.ok(calls.some(c => c.messageId === '523456789012345678'));
  assert.equal(reported[0][1], 'MEMO_CONFLICT');
  pages = [];
  await bridge.scan();
  assert.equal(calls.filter(c => c.messageId === message().id).length, 3);
  const restarted = createBridge({ config, request, fetchPage: async () => [message()] });
  await restarted.scan();
  assert.equal(calls.filter(c => c.messageId === message().id).length, 4);
});
test('known source changed to malformed text is still sent to the server for rejection', async () => {
  const calls = [];
  const bridge = createBridge({ config, request: async body => { if (!body) return { messages: [message().id] }; calls.push(body); return { imported: true }; }, fetchPage: async () => [message({ content: '제목 제거' })] });
  await bridge.scan();
  assert.ok(calls.some(c => c.messageId === message().id));
});
test('HTTP uses only bridge credentials and converts responses to safe error codes', async () => {
  const request = bridgeRequest(config, async (url, init) => {
    assert.equal(url, config.endpoint);
    assert.equal(init.headers.Authorization, `Bearer ${config.secret}`);
    assert.equal(init.redirect, 'error');
    return Response.json({ code: 'MEMO_CONFLICT' }, { status: 409 });
  });
  await assert.rejects(request({ action: 'import', messageId: message().id }), error => error.code === 'MEMO_CONFLICT' && !error.message.includes(config.secret));
});

test('outages abort a history scan before treating unseen messages as deleted', async () => {
  const calls = [];
  const bridge = createBridge({ config, request: async body => {
    if (!body) return { messages: ['523456789012345678'] };
    calls.push(body);
    const error = new Error('temporary failure'); error.code = 'DISCORD_READ_FAILED'; throw error;
  }, fetchPage: async () => [message()] });
  await assert.rejects(bridge.scan());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messageId, message().id);
});
