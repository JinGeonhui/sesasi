import { cloudClient } from './cloud.ts';

export type Collection = 'entries' | 'categories' | 'preferences' | 'archive';
export type StoredRecord<T = unknown> = { key: string; value: T | null; revision: number };
export async function accountClient() {
  const client = cloudClient();
  if (!client) throw new Error('서버가 설정되지 않았습니다.');
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
  return client;
}
function failed(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('RECORD_CONFLICT')) throw new Error('다른 화면에서 변경된 항목입니다. 목록을 새로고침한 뒤 다시 수정해 주세요.');
  throw new Error('서버에 저장하거나 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
}
export async function listRecords<T>(collection: Collection): Promise<StoredRecord<T>[]> {
  const client = await accountClient();
  const { data, error } = await client.rpc('sesasi_records_list', { p_collection: collection });
  failed(error);
  return data as StoredRecord<T>[];
}
export async function saveRecord(collection: Collection, key: string, value: unknown, revision: number) {
  const client = await accountClient();
  const { data, error } = await client.rpc('sesasi_record_save', { p_collection: collection, p_key: key, p_value: value, p_revision: revision });
  failed(error);
  window.dispatchEvent(new Event('sesasi-records-change'));
  return data as number;
}
export async function importRecords(collection: Collection, records: { key: string; value: unknown }[]) {
  if (!records.length) return;
  const client = await accountClient();
  const { error } = await client.rpc('sesasi_records_import', { p_collection: collection, p_records: records });
  failed(error);
}
