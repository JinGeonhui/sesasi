import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parseDiscordMemo, prepareImport } from '../supabase/functions/_shared/discord-import.ts';

const owner = '11111111-0000-0000-0000-000000000001', other = '11111111-0000-0000-0000-000000000002';
const channel = '223456789012345678', message = '123456789012345678';
const created = '2026-11-18T01:00:00.000Z';

test('PostgreSQL: private imports, account isolation, atomic CAS, unique linking and rollback', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;`);
  for (const name of ['20261118000100_discord_state.sql', '20261119000100_account_records.sql', '20261119000200_discord_records_access.sql', '20261120000100_discord_import.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  // Run the existing account/RLS regression suite against the same migrations.
  await db.exec('begin;');
  await db.exec(await readFile(new URL('./account-records.sql', import.meta.url), 'utf8'));
  await db.exec('rollback;');
  await db.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
  await db.exec('set role service_role;');
  const read = async (id = message, user = owner) => (await db.query('select public.sesasi_discord_import_read($1,$2,$3) as data', [user, channel, id])).rows[0].data;
  const commit = (snapshot, change, id = message, user = owner) => db.query('select public.sesasi_discord_import_commit($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [user, channel, id, snapshot.revision, JSON.stringify(change.state), JSON.stringify(change.changes)]);
  const rows = parseDiscordMemo('# 2026.11.18\n1. [작업] 계획\n- [일상] 기록, 문자 >> 그대로');
  const empty = await read();
  assert.deepEqual(empty, { revision: 0, state: null, records: [], boundIds: [] });
  const first = prepareImport(empty, rows, message, created, created);
  await commit(empty, first);
  const snapshot = await read();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.records.filter(row => row.collection === 'entries').length, 2);
  assert.deepEqual((await read(message, other)).records, []);
  await assert.rejects(commit(empty, first), /RECORD_CONFLICT/);
  assert.equal((await read()).revision, 1);

  // Even two imports prepared before either commits cannot bind the same entry.
  await assert.rejects(commit({ revision: 0 }, { state: first.state, changes: [] }, '523456789012345678'), /RECORD_CONFLICT/);
  const collision = await read('523456789012345678');
  assert.equal(collision.state, null);

  // App writes race with an import. Both the category and source state roll back.
  const planned = snapshot.records.find(row => row.collection === 'entries' && row.value.title === '계획');
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await db.query('select public.sesasi_record_save($1,$2,$3::jsonb,$4)', ['entries', planned.key, JSON.stringify({ ...planned.value, done: true }), planned.revision]);
  await db.exec('reset role; set role service_role;');
  const changedRows = rows.map((row, i) => i ? row : { ...row, title: '변경된 계획' });
  const stale = prepareImport(snapshot, changedRows, message, created, '2026-11-18T02:00:00.000Z');
  stale.changes.unshift({ collection: 'categories', key: 'rollback-category', revision: 0, value: 'version' });
  await assert.rejects(commit(snapshot, stale), /RECORD_CONFLICT/);
  const after = await read();
  assert.equal(after.revision, 1);
  assert.equal(after.records.some(row => row.key === 'rollback-category'), false);
  assert.equal(after.records.find(row => row.key === planned.key).value.done, true);
  const merged = prepareImport(after, changedRows, message, created, '2026-11-18T02:00:00.000Z');
  await commit(after, merged);
  assert.equal((await read()).records.find(row => row.key === planned.key).value.done, true);

  await db.exec('reset role; set role authenticated;');
  await assert.rejects(read(), /permission denied/);
  await assert.rejects(commit(empty, first), /permission denied/);
  await db.exec('reset role; set role anon;');
  await assert.rejects(read(), /permission denied/);
  await db.exec('reset role;');
});
