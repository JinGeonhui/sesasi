import { HttpError, type Environment } from './http.ts';
import { validDay } from './discord-contract.ts';
import { memoDay } from './discord-format.ts';
import { parseDiscordMemo, prepareImport, type ImportSnapshot, type MemoInput } from './discord-import.ts';

export const MEMO_MODAL_ID = 'sesasi-memo-add-v1';
export function memoModal(now: number) {
  return { type: 9, data: { custom_id: MEMO_MODAL_ID, title: '메모 추가', components: [
    { type: 18, label: '날짜', description: 'YYYY.MM.DD 형식으로 입력하세요.', component: {
      type: 4, custom_id: 'date', style: 1, required: true, min_length: 10, max_length: 10,
      value: memoDay(new Date(now)).replaceAll('-', '.'),
    } },
    { type: 18, label: '추가할 메모', description: '한 줄에 하나씩: 1. 계획 / - 수행 기록 / - ~~완료한 계획~~', component: {
      type: 4, custom_id: 'memos', style: 2, required: true, max_length: 3980,
      placeholder: '- [일상] finder 정리\n1. [작업] 내일 할 일',
    } },
  ] } };
}

export function parseMemoModal(components: unknown, since: string | undefined): MemoInput[] {
  const invalid = () => { throw new HttpError(422, 'INVALID_MEMO_FORMAT'); };
  if (!Array.isArray(components) || components.length !== 2) return invalid();
  const fields = new Map<string, string>();
  for (const label of components) {
    const input = label?.component;
    if (label?.type !== 18 || input?.type !== 4 || !['date', 'memos'].includes(input.custom_id) || typeof input.value !== 'string' || fields.has(input.custom_id)) return invalid();
    fields.set(input.custom_id, input.value);
  }
  const date = (fields.get('date') ?? '').trim().replaceAll('.', '-');
  const text = fields.get('memos') ?? '';
  if (!validDay(date) || text.length > 3980 || text.split(/\r?\n/).some(line => line.trimStart().startsWith('#'))) return invalid();
  if (!since || !validDay(since)) throw new HttpError(503, 'SETUP_REQUIRED');
  if (date < since) throw new HttpError(422, 'OUTSIDE_SYNC_RANGE');
  const rows = parseDiscordMemo(`# ${date}\n${text}`);
  if (!rows?.length) return invalid();
  return rows;
}

type Database = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
// Modal submissions have no channel source message. Keep their receipts in a
// separate namespace so legacy message reconciliation cannot delete them.
export async function saveDiscordModal(env: Environment, db: Database, flush: (userId: string) => Promise<Response>, id: string, rows: MemoInput[], now = Date.now()) {
  const owner = env('DISCORD_OWNER_USER_ID') ?? '', channel = env('DISCORD_CHANNEL_ID') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(owner) || !/^\d{17,20}$/.test(channel)) throw new HttpError(503, 'SETUP_REQUIRED');
  const args = { p_user: owner, p_channel: `modal:${channel}`, p_message: id };
  const rpc = async (name: string, parameters: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, parameters);
    if (error) throw new HttpError(503, error.message.includes('RECORD_CONFLICT') ? 'RECORD_CONFLICT' : 'STATE_UNAVAILABLE');
    return data;
  };
  const snapshot = await rpc('sesasi_discord_import_read', args) as ImportSnapshot;
  // A receipt survives command lease expiry and app edits/deletions. Replaying
  // the same submission must never restore or overwrite those later changes.
  if (!snapshot.state) {
    const timestamp = new Date(now).toISOString();
    const change = prepareImport(snapshot, rows, id, timestamp, timestamp)!;
    await rpc('sesasi_discord_import_commit', { ...args, p_revision: snapshot.revision, p_state: change.state, p_changes: change.changes });
  }
  let outputPending = false;
  try {
    const response = await flush(owner);
    if (!response.ok) outputPending = true;
    else {
      const status = await response.json();
      outputPending = Boolean(status.pending || status.error);
    }
  } catch { outputPending = true; }
  return { count: rows.length, outputPending };
}
