import type { TransitSelection } from "./transit";

export type Kind = "event" | "todo" | "route" | "note";
type Base = { id: string; title: string };
export type Entry = Base & (
  | { kind: "event"; date: string; end: string; time: string; endTime?: string }
  | { kind: "todo"; date: string; done: boolean; category?: string; categoryVersion?: string; order?: string; inserted?: boolean; createdOn?: string }
  | { kind: "route"; mode: "버스" | "지하철"; from: string; to: string; alias?: string; transit?: TransitSelection }
  | { kind: "note"; date: string; body: string }
);

export type Todo = Extract<Entry, { kind: "todo" }>;
export type CalendarEvent = Extract<Entry, { kind: "event" }>;
export type TransitRoute = Extract<Entry, { kind: "route" }>;

export const uncategorized = "미분류";
export function todoCategory(todo: Todo) {
  return todo.category?.trim() || uncategorized;
}
export const todoOrder = (todo: Todo) => todo.order ?? `0-${todo.id}`;

// An inserted row sorts immediately after its anchor, ahead of older insertions.
// Only the new record needs a write, so other rows retain their position.
export function newTodoOrder(id: string, after?: Todo) {
  const now = Date.now();
  return after ? `${todoOrder(after)}/${9999999999999 - now}-${id}` : `1-${now}-${id}`;
}
export function compareTodos(a: Todo, b: Todo) {
  const left = todoOrder(a), right = todoOrder(b);
  return a.date.localeCompare(b.date) || (left < right ? -1 : left > right ? 1 : 0);
}

export function eventHours(event: CalendarEvent, day?: string) {
  if (!event.time) return "종일";
  if (!event.endTime) return event.time;
  if (event.date === event.end) return `${event.time} – ${event.endTime}`;
  if (!day) return `${event.time} 시작 · ${event.endTime} 종료`;
  if (day === event.date) return `${event.time}부터`;
  if (day === event.end) return `${event.endTime}까지`;
  return "종일";
}

export const kindNames = { event: "일정", todo: "할 일", route: "교통 노선", note: "작업 메모" };
export function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function localDate(value: string) {
  return new Date(value + "T12:00:00");
}
export function shift(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
export function onDay(entry: Entry, day: string) {
  return entry.kind === "event" && entry.date <= day && day <= entry.end
    && !(day === entry.end && day !== entry.date && entry.endTime === "00:00");
}
export function formatDay(day: string, options: Intl.DateTimeFormatOptions) {
  return localDate(day).toLocaleDateString("ko-KR", options);
}
