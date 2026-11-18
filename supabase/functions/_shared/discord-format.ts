export type Todo = { id: string; kind: "todo"; date: string; title: string; done: boolean; category?: string; order?: string; createdOn?: string };
const todoCategory = (todo: Todo) => todo.category?.trim() || "미분류";
function compareTodos(a: Todo, b: Todo) {
  const left = a.order ?? `0-${a.id}`, right = b.order ?? `0-${b.id}`;
  return a.date.localeCompare(b.date) || (left < right ? -1 : left > right ? 1 : 0);
}

export function memoCreatedOn(todo: Todo) {
  if (todo.createdOn !== undefined) return todo.createdOn;
  // Older rows already carry their creation time in their ordering key.
  const part = todo.order?.split("/").at(-1) ?? "";
  const match = part.match(todo.order?.includes("/") ? /^(\d{13})-/ : /^1-(\d{13})-/);
  if (!match) return "";
  const stamp = todo.order?.includes("/") ? 9999999999999 - Number(match[1]) : Number(match[1]);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(stamp));
}

function plain(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\\`*_~|\[\]<>]/g, "\\$&").trim();
}

export function discordLines(day: string, todos: Todo[]) {
  let number = 0;
  return todos.filter(todo => todo.date === day).sort(compareTodos).map(todo => {
    const text = `[${plain(todoCategory(todo))}] ${plain(todo.title)}`;
    if (todo.done) return `- ~~${text}~~`;
    const created = memoCreatedOn(todo);
    return `${created && created < day ? `${++number}.` : "-"} ${text}`;
  });
}

export function discordMessages(day: string, todos: Todo[]) {
  const lines = discordLines(day, todos);
  if (!lines.length) return [];
  const heading = `# ${day.replaceAll("-", ".")}`;
  const parts: string[] = [];
  let content = heading;
  for (const line of lines) {
    if (heading.length + line.length + 1 > 2000) throw new Error("MEMO_TOO_LONG");
    if (content.length + line.length + 1 > 2000) { parts.push(content); content = heading; }
    content += `\n${line}`;
  }
  parts.push(content);
  return parts;
}
