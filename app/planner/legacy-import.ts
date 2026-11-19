// The only application localStorage access: read old records once, then remove
// only the exact values whose import the server acknowledged. Never write locally.
import { importRecords } from './record-store.ts';
import type { Entry } from './data.ts';

export async function importLegacyPlanner() {
  let storage: Storage;
  try { storage = window.localStorage; } catch { return; }
  const captured = Object.keys(storage).flatMap(key => {
    const value = storage.getItem(key);
    return value === null ? [] : [{ key, value }];
  });
  const entryPrefix = 'sesasi.planner.v1.', categoryPrefix = 'sesasi.todo-category.v1.';
  const entries = captured.filter(item => item.key.startsWith(entryPrefix));
  const categories = captured.filter(item => item.key.startsWith(categoryPrefix));
  const preferences = captured.filter(item => ['sesasi.weather.city', 'sesasi.weather.metrics.v1'].includes(item.key));
  // Parse before writing anything. Corrupt data stays available for recovery.
  const parsed = entries.map(item => {
    const value = JSON.parse(item.value) as Entry;
    if (!value || typeof value.id !== 'string' || !['event', 'todo', 'route', 'note'].includes(value.kind) || typeof value.title !== 'string') throw new Error('이전 기록의 형식을 확인하지 못했어요. 기존 데이터는 보존했습니다.');
    return { key: value.id, value };
  });
  const names = new Set(['업무', '개인', '공부']);
  for (const { value } of parsed) if (value.kind === 'todo' && !value.categoryVersion && value.category?.trim()) names.add(value.category.trim());
  names.delete('미분류');
  await importRecords('categories', categories.map(item => ({ key: item.key.slice(categoryPrefix.length), value: item.value })));
  await importRecords('categories', [...names].map(key => ({ key, value: 'legacy' })));
  await importRecords('entries', parsed);
  await importRecords('preferences', preferences.map(item => ({ key: item.key, value: item.value })));
  for (const item of [...entries, ...categories, ...preferences]) {
    if (storage.getItem(item.key) === item.value) storage.removeItem(item.key);
  }
}
