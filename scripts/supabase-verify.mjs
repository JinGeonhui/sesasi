import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const { url, owner, publicKey, secretKey } = JSON.parse(readFileSync('supabase/.temp/bootstrap.json', 'utf8'));
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(35000) }) } };
const admin = createClient(url, secretKey, options), client = createClient(url, publicKey, options);
const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: owner, options: { redirectTo: 'http://localhost:3000/planner/settings/' } });
if (generated.error) throw new Error(`Owner setup failed: ${generated.error.code ?? generated.error.status}`);
const verified = await client.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: generated.data.properties.verification_type });
if (verified.error || !verified.data.session) throw new Error(`Owner session verification failed: ${verified.error?.code ?? verified.error?.status ?? 'no_session'}`);
const session = verified.data.session;
console.log('Owner authentication verified. Checking cloud endpoints.');
const headers = { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, Origin: 'http://localhost:3000' };
const get = (name, query, override = headers) => fetch(`${url}/functions/v1/${name}?${new URLSearchParams(query)}`, { headers: { ...override, ...(name === 'weather' ? { 'x-region': process.env.SESASI_WEATHER_TEST_REGION || 'eu-central-1' } : {}) }, signal: AbortSignal.timeout(40000) });
const unauthorized = await get('weather', { kind: 'weather', city: '광주' }, { apikey: publicKey, Origin: 'http://localhost:3000' });
assert.equal(unauthorized.status, 401);
const results = await Promise.all([
  ['weather', { kind: 'weather', city: '광주' }],
  ['weather', { kind: 'air', city: '광주' }],
  ['transit', { path: 'cities' }],
  ['discord-sync', {}],
].map(async ([name, query]) => {
  const response = await get(name, query), body = await response.json();
  const result = { function: name, kind: query.kind, status: response.status, region: response.headers.get('x-sb-edge-region') };
  if (response.ok && name === 'weather') { assert.ok(body.body?.current?.time); result.time = body.body.current.time; }
  else if (response.ok && name === 'transit') { assert.ok(Array.isArray(body.items)); result.items = body.items.length; }
  else if (response.ok) { assert.equal(body.service, 'sesasi-discord'); result.configured = body.configured; }
  else result.code = body.code ?? body.message;
  return result;
}));
console.log(JSON.stringify({ unauthorizedBlocked: true, results }, null, 2));
assert.ok(results.every(result => result.status === 200), 'Cloud endpoint verification failed');
// Preserve existing published-message IDs when switching from the local server.
let local;
try { local = JSON.parse(readFileSync('discord/private/state.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (local?.sourceId) {
  const existing = await admin.rpc('sesasi_discord_read', { p_user: session.user.id });
  if (existing.error) throw new Error('Cannot inspect existing state');
  if (!existing.data?.sourceId) {
    const token = crypto.randomUUID();
    const lease = await admin.rpc('sesasi_discord_acquire', { p_user: session.user.id, p_token: token });
    if (lease.error || !lease.data) throw new Error('Cannot acquire import lease');
    try {
      const { error, data } = await admin.rpc('sesasi_discord_save', { p_user: session.user.id, p_token: token, p_state: { identity: local.identity, sourceId: local.sourceId, desired: local.desired, messages: local.messages, lastSyncedAt: local.lastSyncedAt, error: '', retryAt: 0 } });
      if (error || !data) throw new Error('Cannot import local Discord state');
      console.log('Existing Discord message state preserved.');
    } finally { await admin.rpc('sesasi_discord_release', { p_user: session.user.id, p_token: token }); }
  }
}
// One-use login link for the user's browser; never print credentials or send email.
const login = await admin.auth.admin.generateLink({ type: 'magiclink', email: owner, options: { redirectTo: 'http://localhost:3000/planner/settings/' } });
if (login.error) throw new Error('Could not prepare browser sign-in');
writeFileSync('supabase/.temp/browser-login.json', JSON.stringify({ link: login.data.properties.action_link }), { mode: 0o600 });
console.log('Browser sign-in prepared privately. No Discord messages were sent by this verification.');
