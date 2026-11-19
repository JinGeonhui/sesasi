import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public';
let fail = false;
let records = new Map();
let events = [];
const client = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } }, error: null }) },
  rpc: async (name, args) => {
    if (fail) return { data: null, error: { message: 'unavailable' } };
    const collection = records.get(args.p_collection) ?? new Map();
    records.set(args.p_collection, collection);
    if (name === 'sesasi_records_import') {
      for (const item of args.p_records) if (!collection.has(item.key)) collection.set(item.key, { ...item, revision: 1 });
      return { error: null };
    }
    if (name === 'sesasi_records_list') return { data: [...collection.values()], error: null };
    const old = collection.get(args.p_key);
    if ((old?.revision ?? 0) !== args.p_revision) return { error: { message: 'RECORD_CONFLICT' } };
    const revision = args.p_revision + 1;
    collection.set(args.p_key, { key: args.p_key, value: args.p_value, revision });
    return { data: revision, error: null };
  },
};
globalThis.window = { __sesasiCloud: { signature: 'https://example.supabase.co:test-public', client }, dispatchEvent: event => events.push(event.type) };
const { importLegacyPlanner } = await import('../app/planner/legacy-import.ts');
const { loadPlanner, saveEntry, deleteCategory } = await import('../app/planner/planner-store.ts');
function fixture(values = {}) {
  records = new Map(); events = []; fail = false;
  const storage = { ...values };
  Object.defineProperties(storage, {
    getItem: { value: key => storage[key] ?? null },
    removeItem: { value: key => { delete storage[key]; } },
    setItem: { value: () => { throw new Error('Local writes are forbidden'); } },
  });
  window.localStorage = storage;
  return storage;
}
const memo = { id: 'memo1', kind: 'todo', date: '2026-11-19', title: 'preserved memo', done: false, category: '업무' };
test('failed migration keeps every legacy record; successful retry imports and clears only migrated keys', async () => {
  const raw = JSON.stringify(memo);
  const local = fixture({ 'sesasi.planner.v1.memo1': raw, 'sesasi.weather.city': '서울', 'sesasi.cloud.auth.v1': 'session-placeholder' });
  fail = true;
  await assert.rejects(importLegacyPlanner(), /서버/);
  assert.equal(local['sesasi.planner.v1.memo1'], raw);
  fail = false;
  await importLegacyPlanner();
  assert.deepEqual(records.get('entries').get('memo1').value, memo);
  assert.equal(local['sesasi.planner.v1.memo1'], undefined);
  assert.equal(local['sesasi.cloud.auth.v1'], 'session-placeholder');
  assert.equal(records.get('preferences').get('sesasi.weather.city').value, '서울');
});
test('server writes are awaited; stale device cannot overwrite or resurrect a deleted record', async () => {
  fixture({ 'sesasi.planner.v1.memo1': JSON.stringify(memo) });
  const first = await loadPlanner();
  const other = await loadPlanner();
  fail = true;
  await assert.rejects(saveEntry({ ...memo, done: true }, false, false, first), /서버/);
  assert.equal(records.get('entries').get('memo1').value.done, false);
  assert.deepEqual(events, []);
  fail = false;
  await saveEntry({ ...memo, done: true }, false, false, first);
  await assert.rejects(saveEntry(memo, false, false, other), /다른 화면/);
  const latest = await loadPlanner();
  await saveEntry(memo, true, false, latest);
  window.localStorage['sesasi.planner.v1.memo1'] = JSON.stringify(memo);
  assert.equal((await loadPlanner()).entries.length, 0);
});
test('deleted categories resolve existing memos to uncategorized on every device', async () => {
  fixture({ 'sesasi.planner.v1.memo1': JSON.stringify(memo) });
  const snapshot = await loadPlanner();
  await deleteCategory('업무', snapshot);
  const next = await loadPlanner();
  assert.equal(next.entries[0].category, '미분류');
  assert.equal(next.catalog.has('업무'), false);
});
test('corrupt migration is retained and never presented as an empty successful load', async () => {
  const local = fixture({ 'sesasi.planner.v1.bad': 'broken json' });
  await assert.rejects(loadPlanner());
  assert.equal(local['sesasi.planner.v1.bad'], 'broken json');
});
