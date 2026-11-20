import { validDay } from './discord-contract.ts';
import { memoDay, memoType, type MemoType, type Todo } from './discord-format.ts';
import { HttpError } from './http.ts';

export type MemoInput = { date: string; title: string; category: string; memoType: MemoType; done: boolean };
export type ImportState = { version: string; deleted: boolean; rows: { id: string; input: MemoInput; order?: string }[] };
export type RecordRow = { collection: string; key: string; revision: number; value: unknown };
export type ImportSnapshot = { revision: number; state: ImportState | null; records: RecordRow[]; boundIds: string[] };
export type RecordChange = RecordRow;
const invalid = () => { throw new HttpError(422, 'INVALID_MEMO_FORMAT'); };

// Only the outer date/list/category/completion syntax has meaning. Commas,
// arrows, prices and all other body text remain part of the same title.
export function parseDiscordMemo(content: string): MemoInput[] | null {
  if (content.length > 4000) invalid();
  const lines = content.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
  if (!lines.length || !/^#\s+\d{4}[.-]/.test(lines[0])) return null;
  let date = '';
  const rows: MemoInput[] = [];
  for (const line of lines) {
    const heading = line.match(/^# (\d{4})[.-](\d{2})[.-](\d{2})\s*$/);
    if (heading) {
      date = `${heading[1]}-${heading[2]}-${heading[3]}`;
      if (!validDay(date)) invalid();
      continue;
    }
    if (!date) invalid();
    const prefix = line.match(/^(?:([1-9]\d*)\.|(-)) /);
    if (!prefix) invalid();
    let body = line.slice(prefix![0].length);
    let done = false;
    if (body.startsWith('~~')) {
      if (!prefix![2]) invalid();
      const close = body.indexOf('~~', 2);
      if (close < 0) invalid();
      // Remove just the completion wrapper. Text after it (including >>) is
      // ordinary body text, never a separate result or command.
      body = body.slice(2, close) + body.slice(close + 2);
      done = true;
    }
    const category = body.match(/^\[([^\]\r\n]{1,40})\] /);
    if (!category || !category[1].trim()) invalid();
    const title = body.slice(category![0].length);
    if (!title.trim() || title.length > 120) invalid();
    rows.push({ date, title, category: category![1], memoType: prefix![1] || done ? 'planned' : 'recorded', done });
    if (rows.length > 200) invalid();
  }
  return rows;
}

const fields = ['date', 'title', 'category', 'memoType', 'done'] as const;
function inputOf(todo: Todo): MemoInput {
  return { date: todo.date, title: todo.title, category: todo.category ?? '미분류', memoType: memoType(todo), done: memoType(todo) === 'recorded' ? false : todo.done };
}
const same = (a: MemoInput, b: MemoInput) => fields.every(key => a[key] === b[key]);
const identity = (a: MemoInput, b: MemoInput) => a.date === b.date && a.category === b.category && a.title === b.title;
const conflict = () => { throw new HttpError(409, 'MEMO_CONFLICT'); };

// Merge only fields changed in the Discord source since its previous import.
// Unchanged source lines cannot undo app edits or resurrect app deletions.
export function prepareImport(snapshot: ImportSnapshot, incoming: MemoInput[], messageId: string, createdAt: string, version: string, deleted = false, uuid = () => crypto.randomUUID()) {
  const previous = snapshot.state;
  if (previous && (previous.deleted || previous.version > version)) return null;
  const old = previous?.rows ?? [];
  if (previous && previous.version === version && previous.deleted === deleted && old.length === incoming.length && old.every((row, i) => same(row.input, incoming[i]))) return null;
  const records = new Map(snapshot.records.map(row => [`${row.collection}:${row.key}`, row]));
  const changes = new Map<string, RecordChange>();
  const used = new Set<number>();
  const match = incoming.map(row => {
    const index = old.findIndex((prior, i) => !used.has(i) && identity(prior.input, row));
    if (index >= 0) used.add(index);
    return index;
  });
  const unmatchedOld = old.map((_, i) => i).filter(i => !used.has(i));
  const unmatchedNew = match.map((index, i) => index < 0 ? i : -1).filter(i => i >= 0);
  // A one-for-one edit is a rename. More ambiguous edits are rejected instead
  // of silently binding different lines to existing memos.
  if (unmatchedOld.length && unmatchedNew.length) {
    if (unmatchedOld.length !== 1 || unmatchedNew.length !== 1) conflict();
    match[unmatchedNew[0]] = unmatchedOld[0]; used.add(unmatchedOld[0]);
  }
  const put = (collection: string, key: string, value: unknown) => {
    const record = records.get(`${collection}:${key}`);
    changes.set(`${collection}:${key}`, { collection, key, value, revision: record?.revision ?? 0 });
  };
  const categoryVersion = (category: string) => {
    if (category === '미분류') return undefined;
    const key = `categories:${category}`;
    const value = (changes.get(key) ?? records.get(key))?.value;
    if (typeof value === 'string' && value !== 'deleted') return value;
    const next = uuid(); put('categories', category, next); return next;
  };
  const bound = new Set([...snapshot.boundIds, ...old.map(row => row.id)]);
  const orderFor = (i: number) => `1-${Date.parse(createdAt)}-${messageId}-${String(i).padStart(3, '0')}`;
  const rows = incoming.map((input, i) => {
    const prior = old[match[i]];
    if (prior) {
      const record = records.get(`entries:${prior.id}`);
      const current = record?.value as (Todo & { categoryVersion?: string }) | null | undefined;
      const reordered = match[i] !== i;
      if (same(prior.input, input) && (!reordered || !current)) return { ...prior, input };
      if (!current || current.kind !== 'todo') conflict();
      const values = inputOf(current!);
      const next = { ...current! };
      if (input.memoType !== prior.input.memoType || input.done !== prior.input.done) {
        const unchanged = values.memoType === prior.input.memoType && values.done === prior.input.done;
        const alreadyApplied = values.memoType === input.memoType && values.done === input.done;
        if (!unchanged && !alreadyApplied) conflict();
      }
      for (const field of fields) {
        if (prior.input[field] === input[field]) continue;
        if (values[field] !== prior.input[field] && values[field] !== input[field]) conflict();
        Object.assign(next, { [field]: input[field] });
      }
      // Completing a stale planned source must not create a checked activity
      // record after the app changed its type (and vice versa).
      if (next.memoType === 'recorded' && next.done) conflict();
      if (input.category !== prior.input.category) next.categoryVersion = categoryVersion(input.category);
      if (reordered) {
        if (current!.order !== prior.order) conflict();
        next.order = orderFor(i);
      }
      put('entries', prior.id, next);
      return { id: prior.id, input, order: next.order };
    }
    const candidates = snapshot.records.filter(row => row.collection === 'entries' && row.value && (row.value as Todo).kind === 'todo' && identity(inputOf(row.value as Todo), input));
    if (candidates.length) {
      if (candidates.length !== 1 || bound.has(candidates[0].key) || !same(inputOf(candidates[0].value as Todo), input)) conflict();
      put('entries', candidates[0].key, candidates[0].value);
      bound.add(candidates[0].key);
      return { id: candidates[0].key, input, order: (candidates[0].value as Todo).order };
    }
    const id = `discord-${messageId}-${uuid()}`;
    put('entries', id, { id, kind: 'todo', ...input, categoryVersion: categoryVersion(input.category), createdOn: memoDay(new Date(createdAt)), order: orderFor(i) });
    bound.add(id);
    return { id, input, order: orderFor(i) };
  });
  for (let i = 0; i < old.length; i++) {
    if (used.has(i)) continue;
    const current = records.get(`entries:${old[i].id}`)?.value as Todo | null;
    if (!current) continue;
    if (!same(inputOf(current), old[i].input)) conflict();
    put('entries', old[i].id, null);
  }
  return { state: { version, deleted, rows }, changes: [...changes.values()] };
}
