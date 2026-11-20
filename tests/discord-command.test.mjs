import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDiscordCommandHandler, syncDiscordCommand } from '../supabase/functions/_shared/discord-command.ts';

const app = '111111111111111111', channel = '222222222222222222', guild = '333333333333333333', author = '444444444444444444';
const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');
const values = { DISCORD_APPLICATION_ID: app, DISCORD_APPLICATION_PUBLIC_KEY: publicKey, DISCORD_GUILD_ID: guild, DISCORD_CHANNEL_ID: channel, DISCORD_AUTHOR_ID: author, DISCORD_IMPORT_FROM: '2026-11-20', DISCORD_BRIDGE_SECRET: 'test-secret' };
const env = key => values[key];
const payload = () => ({ type: 2, application_id: app, id: '555555555555555555', token: 'test-interaction-token', guild_id: guild, channel_id: channel, member: { user: { id: author } }, data: { name: '적용' } });
async function signed(data, seconds = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(data), timestamp = String(seconds);
  const signature = Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + body))).toString('hex');
  return new Request('https://example.com', { method: 'POST', body, headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } });
}
function setup(status = 'acquired') {
  const tasks = [], calls = [];
  const handler = createDiscordCommandHandler({ env, waitUntil: task => tasks.push(task), claim: async () => { calls.push('claim'); return status; }, release: async () => calls.push('release'), sync: async () => { calls.push('sync'); return { checked: 2, changed: 1, failed: 0, remaining: 0, outputPending: false }; }, fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); } });
  return { handler, tasks, calls };
}
test('verifies real Ed25519 signatures; rejects missing, tampered, and stale requests before work', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(new Request('https://x', { method: 'POST', body: '{}' }))).status, 401);
  const valid = await signed(payload());
  assert.equal((await handler(new Request(valid, { body: JSON.stringify({ ...payload(), channel_id: 'other' }) }))).status, 401);
  assert.equal((await handler(await signed(payload(), Math.floor(Date.now()/1000)-301))).status, 401);
  assert.deepEqual(calls, []);
  assert.deepEqual(await (await handler(await signed({ type: 1, application_id: app }))).json(), { type: 1 });
});
test('another user/channel/guild and DMs receive a private denial without imports', async () => {
  for (const change of [{ member: { user: { id: 'other' } } }, { channel_id: 'other' }, { guild_id: 'other' }, { guild_id: undefined, member: undefined, user: { id: author } }]) {
    const { handler, tasks, calls } = setup();
    const reply = await (await handler(await signed({ ...payload(), ...change }))).json();
    assert.equal(reply.type, 4); assert.equal(reply.data.flags, 64);
    assert.equal(tasks.length, 0); assert.deepEqual(calls, []);
  }
});
test('defers privately, runs once, releases lease and sends a mention-free result', async () => {
  const { handler, tasks, calls } = setup();
  assert.deepEqual(await (await handler(await signed(payload()))).json(), { type: 5, data: { flags: 64 } });
  await Promise.all(tasks);
  assert.deepEqual(calls.slice(0,3), ['claim','sync','release']);
  assert.match(calls[3].content, /1개 변경/); assert.deepEqual(calls[3].allowed_mentions, { parse: [] });
  for (const status of ['duplicate','busy']) {
    const run = setup(status); await run.handler(await signed(payload())); await Promise.all(run.tasks);
    assert.equal(run.calls.includes('sync'), false);
  }
});
const message = (id, extra = {}) => ({ id, channel_id: channel, author: { id: author }, timestamp: '2026-11-20T01:00:00Z', content: '# 2026.11.20\n- [작업] 메모', ...extra });
test('manual scan filters bot/other/old messages and confirms absent linked sources via importer', async () => {
  const imports = [], one = '666666666666666666', missing = '777777777777777777';
  const importer = async req => {
    if (req.method === 'GET') return Response.json({ messages: [missing] });
    const body = await req.json(); imports.push(body);
    return Response.json({ changed: true });
  };
  const result = await syncDiscordCommand(env, importer, async () => Response.json([
    message(one), message('888888888888888881', { author: { id: author, bot: true } }), message('888888888888888882', { author: { id: 'other' } }), message('888888888888888883', { timestamp: '2026-11-19T00:00:00Z' }), message('888888888888888884', { webhook_id: 'webhook' }),
  ]));
  assert.deepEqual(imports.filter(x => x.action === 'import').map(x => x.messageId), [one, missing]);
  assert.equal(result.changed, 2); assert.equal(result.remaining, 0);
});
test('incomplete or failing history scan makes no imports/deletions', async () => {
  let writes = 0, page = 0;
  const importer = async req => { if (req.method !== 'GET') writes++; return Response.json({ messages: ['777777777777777777'] }); };
  await assert.rejects(syncDiscordCommand(env, importer, async () => {
    page++;
    return Response.json(Array.from({length:100}, (_,i) => message(String(900000000000000000n-BigInt(page*100+i)))));
  }), /SCAN_LIMIT/);
  assert.equal(writes, 0);
  await assert.rejects(syncDiscordCommand(env, importer, async () => new Response(null, { status: 429 })), /DISCORD_READ_FAILED/);
  assert.equal(writes, 0);
});
test('PostgreSQL command receipts deny browser roles, duplicate requests and concurrent owner work', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('create schema auth; create schema private; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261120000200_discord_commands.sql', import.meta.url), 'utf8'));
  const owner = '11111111-0000-0000-0000-000000000001';
  await db.query('insert into auth.users values($1)', [owner]);
  const claim = async id => (await db.query('select public.sesasi_discord_command_claim($1,$2) as result', [owner,id])).rows[0].result;
  await db.exec('set role authenticated'); await assert.rejects(claim('1'), /permission denied/);
  await db.exec('reset role; set role service_role');
  assert.equal(await claim('1'), 'acquired'); assert.equal(await claim('1'), 'duplicate'); assert.equal(await claim('2'), 'busy');
  await db.query('select public.sesasi_discord_command_release($1,$2)', [owner,'1']);
  assert.equal(await claim('1'), 'duplicate'); assert.equal(await claim('2'), 'acquired');
});
