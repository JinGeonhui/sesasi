import { todoCategory, uncategorized, type Todo } from "./data.ts";

const legacy = "legacy";

export function resolveCategory(todo: Todo, catalog: Map<string, string>): Todo {
  const name = todoCategory(todo);
  if (name === uncategorized || catalog.get(name) === (todo.categoryVersion ?? legacy)) return todo;
  return { ...todo, category: uncategorized, categoryVersion: undefined };
}
