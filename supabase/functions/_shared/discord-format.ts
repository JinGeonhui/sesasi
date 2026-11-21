export type MemoType = "planned" | "recorded";
export type Todo = { id: string; kind: "todo"; date: string; title: string; done: boolean; category?: string; order?: string; createdOn?: string; memoType?: MemoType };
const todoCategory = (todo: Todo) => todo.category?.trim() || "미분류";
function compareTodos(a: Todo, b: Todo) {
  const left = a.order ?? `0-${a.id}`, right = b.order ?? `0-${b.id}`;
  return a.date.localeCompare(b.date) || (left < right ? -1 : left > right ? 1 : 0);
}

export function memoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function memoCreatedOn(todo: Pick<Todo, "createdOn" | "order">) {
  if (todo.createdOn !== undefined) return todo.createdOn;
  // Older rows already carry their creation time in their ordering key.
  const part = todo.order?.split("/").at(-1) ?? "";
  const match = part.match(todo.order?.includes("/") ? /^(\d{13})-/ : /^1-(\d{13})-/);
  if (!match) return "";
  const stamp = todo.order?.includes("/") ? 9999999999999 - Number(match[1]) : Number(match[1]);
  return memoDay(new Date(stamp));
}

export function memoType(todo: Pick<Todo, "date" | "createdOn" | "order" | "memoType">): MemoType {
  if (todo.memoType === "planned" || todo.memoType === "recorded") return todo.memoType;
  const created = memoCreatedOn(todo);
  return created && created < todo.date ? "planned" : "recorded";
}

export function memoStatus(todo: Todo): "pending" | "completed" | "recorded" {
  if (memoType(todo) === "recorded") return "recorded";
  return todo.done ? "completed" : "pending";
}

// Explicit choices persist across date changes. Legacy memos retain their
// creation-date classification, independent of the day the list is viewed.
export function memoRows<T extends Todo>(todos: T[]) {
  const numbers = new Map<string, number>();
  return [...todos].sort(compareTodos).map(todo => {
    const status = memoStatus(todo);
    let marker = "-";
    if (status === "pending") {
      const number = (numbers.get(todo.date) ?? 0) + 1;
      numbers.set(todo.date, number);
      marker = `${number}.`;
    }
    return { todo, marker, status };
  });
}

function plain(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[\\`*_~|\[\]<>]/g, "\\$&").trim();
}

export function discordLines(day: string, todos: Todo[]) {
  const rows = memoRows(todos.filter(todo => todo.date === day));
  // Discord can continue an ordered list across adjacent '-' rows. Keep the
  // two list types in separate paragraphs, preserving order within each group.
  const pending = rows.filter(row => row.status === "pending");
  const recorded = rows.filter(row => row.status !== "pending");
  const line = ({ todo, marker, status }: (typeof rows)[number]) => {
    const text = `[${plain(todoCategory(todo))}] ${plain(todo.title)}`;
    if (status === "completed") return `- ~~${text}~~`;
    return `${marker} ${text}`;
  };
  return [...pending.map(line), ...(pending.length && recorded.length ? [""] : []), ...recorded.map(line)];
}

export function discordMessages(day: string, todos: Todo[]) {
  const lines = discordLines(day, todos);
  if (!lines.length) return [];
  const heading = `# ${day.replaceAll("-", ".")}`;
  const parts: string[] = [];
  let content = heading;
  let sectionBreak = false;
  for (const line of lines) {
    if (!line) { sectionBreak = true; continue; }
    if (heading.length + line.length + 1 > 2000) throw new Error("MEMO_TOO_LONG");
    let separator = content !== heading && sectionBreak ? "\n\n" : "\n";
    if (content.length + separator.length + line.length > 2000) { parts.push(content); content = heading; separator = "\n"; }
    content += separator + line;
    sectionBreak = false;
  }
  parts.push(content);
  return parts;
}
