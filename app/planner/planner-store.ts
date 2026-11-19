import { importLegacyPlanner } from './legacy-import.ts';
import { importRecords, listRecords, saveRecord, type StoredRecord } from './record-store.ts';
import { resolveCategory } from './categories.ts';
import { todoCategory, uncategorized, type Entry } from './data.ts';

export type PlannerSnapshot = { entries: Entry[]; catalog: Map<string, string>; records: StoredRecord<Entry>[]; categories: StoredRecord<string>[] };
export async function loadPlanner(): Promise<PlannerSnapshot> {
  await importLegacyPlanner();
  await importRecords('categories', ['업무', '개인', '공부'].map(key => ({ key, value: 'legacy' })));
  const [records, categories] = await Promise.all([listRecords<Entry>('entries'), listRecords<string>('categories')]);
  const catalog = new Map(categories.filter(row => row.value && row.value !== 'deleted').map(row => [row.key, row.value!]));
  const entries = records.flatMap(row => row.value ? [row.value.kind === 'todo' ? resolveCategory(row.value, catalog) : row.value] : []);
  return { entries, catalog, records, categories };
}
export async function addCategory(name: string, snapshot: PlannerSnapshot) {
  name = name.trim();
  if (!name || name.length > 40) throw new Error('카테고리 이름은 1~40자로 입력해 주세요.');
  if (name === uncategorized || snapshot.catalog.has(name)) throw new Error('이미 있는 카테고리예요.');
  const version = crypto.randomUUID();
  await saveRecord('categories', name, version, snapshot.categories.find(row => row.key === name)?.revision ?? 0);
  return version;
}
export async function deleteCategory(name: string, snapshot: PlannerSnapshot) {
  const row = snapshot.categories.find(row => row.key === name);
  if (!row || name === uncategorized) throw new Error('카테고리 목록을 다시 확인해 주세요.');
  await saveRecord('categories', name, 'deleted', row.revision);
}
export async function saveEntry(entry: Entry, remove: boolean, customCategory: boolean, snapshot: PlannerSnapshot) {
  if (!remove && entry.kind === 'todo') {
    const name = todoCategory(entry);
    if (name !== uncategorized) {
      let version = snapshot.catalog.get(name);
      if (!version && customCategory) version = await addCategory(name, snapshot);
      if (!version) throw new Error('카테고리가 변경됐어요. 다시 선택해 주세요.');
      entry = { ...entry, categoryVersion: version };
    }
  }
  await saveRecord('entries', entry.id, remove ? null : entry, snapshot.records.find(row => row.key === entry.id)?.revision ?? 0);
  window.dispatchEvent(new Event('sesasi-planner-change'));
}
