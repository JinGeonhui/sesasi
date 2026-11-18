import { todoCategory, uncategorized, type Entry, type Todo } from "./data";

export const categoryPrefix = "sesasi.todo-category.v1.";
const legacy = "legacy";
const deleted = "deleted";
const defaults = ["업무", "개인", "공부"];

export function categoryVersion(name: string) {
  return localStorage.getItem(categoryPrefix + name);
}

export function readCategories(entries: Entry[]) {
  // Import names used before categories could exist independently of tasks.
  const names = new Set(defaults);
  for (const entry of entries) {
    if (entry.kind === "todo" && !entry.categoryVersion) names.add(todoCategory(entry));
  }
  names.delete(uncategorized);
  for (const name of names) {
    if (categoryVersion(name) === null) localStorage.setItem(categoryPrefix + name, legacy);
  }

  const catalog = new Map<string, string>();
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(categoryPrefix)) continue;
    const version = localStorage.getItem(key);
    if (version && version !== deleted) catalog.set(key.slice(categoryPrefix.length), version);
  }
  return catalog;
}

export function resolveCategory(todo: Todo, catalog: Map<string, string>): Todo {
  const name = todoCategory(todo);
  if (name === uncategorized || catalog.get(name) === (todo.categoryVersion ?? legacy)) return todo;
  return { ...todo, category: uncategorized, categoryVersion: undefined };
}

export function addCategory(input: string) {
  const name = input.trim();
  if (!name || name.length > 40) throw new Error("카테고리 이름은 1~40자로 입력해 주세요.");
  const current = categoryVersion(name);
  if (name === uncategorized || (current && current !== deleted)) throw new Error("이미 있는 카테고리예요.");
  const version = crypto.randomUUID();
  localStorage.setItem(categoryPrefix + name, version);
  return version;
}

export function deleteCategory(name: string, version: string) {
  if (name === uncategorized || categoryVersion(name) !== version) throw new Error("카테고리 목록이 변경됐어요. 다시 선택해 주세요.");
  // One write invalidates all references, including references in other tabs.
  // Recreating the same name gets a new version and starts with no tasks.
  localStorage.setItem(categoryPrefix + name, deleted);
  window.dispatchEvent(new Event("sesasi-planner-change"));
}
