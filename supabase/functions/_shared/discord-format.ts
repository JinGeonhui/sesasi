export type Todo = { id: string; kind: "todo"; date: string; title: string; done: boolean; category?: string; order?: string; createdOn?: string };
const todoCategory = (todo: Todo) => todo.category?.trim() || "미분류";
function compareTodos(a: Todo, b: Todo) {
  const left = a.order ?? `0-${a.id}`, right = b.order ?? `0-${b.id}`;
  return a.date.localeCompare(b.date) || (left < right ? -1 : left > right ? 1 : 0);
}

export function memoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function memoCreatedOn(todo: Todo) {
  if (todo.createdOn !== undefined) return todo.createdOn;
  // Older rows already carry their creation time in their ordering key.
  const part = todo.order?.split("/").at(-1) ?? "";
  const match = part.match(todo.order?.includes("/") ? /^(\d{13})-/ : /^1-(\d{13})-/);
  if (!match) return "";
  const stamp = todo.order?.includes("/") ? 9999999999999 - Number(match[1]) : Number(match[1]);
  return memoDay(new Date(stamp));
}

// Use the same markers in the app and Discord. The creation date, rather than
// the day the list is viewed, determines whether a memo was planned in advance.
export function memoRows<T extends Todo>(todos: T[]) {
  const numbers = new Map<string, number>();
  return [...todos].sort(compareTodos).map(todo => {
    const created = memoCreatedOn(todo);
    let marker = "-";
    if (!todo.done && created && created < todo.date) {
      const number = (numbers.get(todo.date) ?? 0) + 1;
      numbers.set(todo.date, number);
      marker = `${number}.`;
    }
    return { todo, marker };
  });
}

function plain(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\\`*_~|\[\]<>]/g, "\\$&").trim();
}

export function discordLines(day: string, todos: Todo[]) {
  return memoRows(todos.filter(todo => todo.date === day)).map(({ todo, marker }) => {
    const text = `[${plain(todoCategory(todo))}] ${plain(todo.title)}`;
    if (todo.done) return `- ~~${text}~~`;
    return `${marker} ${text}`;
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
