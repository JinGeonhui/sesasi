import type { Todo } from './discord-format.ts';
import { HttpError } from './http.ts';
export const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function webhookURL(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(503, 'INVALID_WEBHOOK'); }
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || url.port || url.username || url.password || url.hash || !/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[\w-]{40,200}$/.test(url.pathname) || [...url.searchParams.keys()].some(key => key !== 'thread_id') || (url.search && (url.searchParams.getAll('thread_id').length !== 1 || !/^\d{17,20}$/.test(url.searchParams.get('thread_id')!)))) throw new HttpError(503, 'INVALID_WEBHOOK');
  url.hostname = 'discord.com'; url.pathname = url.pathname.replace(/^\/api\/(?!v10\/)/, '/api/v10/');
  return url.href;
}
export function validateSubmission(value: unknown): { sourceId: string; todos: Todo[] } {
  const obj = value as { sourceId?: unknown; todos?: unknown } | null;
  if (!obj || typeof obj.sourceId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(obj.sourceId) || !Array.isArray(obj.todos) || obj.todos.length > 5000) throw new HttpError(400, 'INVALID_MEMOS');
  const ids = new Set<string>();
  const todos: Todo[] = obj.todos.map(todo => {
    if (!todo || typeof todo.id !== 'string' || !todo.id || todo.id.length > 100 || ids.has(todo.id) || todo.kind !== 'todo' || !validDay(todo.date) || typeof todo.done !== 'boolean' || typeof todo.title !== 'string' || !todo.title.trim() || todo.title.length > 120 || typeof todo.category !== 'string' || todo.category.length > 40 || typeof todo.order !== 'string' || todo.order.length > 2000 || (todo.createdOn !== '' && !validDay(todo.createdOn))) throw new HttpError(400, 'INVALID_MEMOS');
    ids.add(todo.id);
    return { id: todo.id, kind: 'todo', date: todo.date, done: todo.done, title: todo.title, category: todo.category, order: todo.order, createdOn: todo.createdOn };
  });
  return { sourceId: obj.sourceId, todos };
}
export type DiscordState = { identity: string; sourceId: string | null; desired: Record<string, string[]>; messages: Record<string, { id: string; hash: string }[]>; lastSyncedAt: string | null; error: string; retryAt: number };
export const emptyDiscordState = (): DiscordState => ({ identity: '', sourceId: null, desired: {}, messages: {}, lastSyncedAt: null, error: '', retryAt: 0 });
export async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join(''); }
export async function discordStatus(state: DiscordState, sourceId: string | null, configured: boolean, since: string) {
  const own = configured && (!state.sourceId || sourceId === state.sourceId);
  let pending = false;
  for (const day of new Set([...Object.keys(state.desired), ...Object.keys(state.messages)])) {
    if (day < since) continue;
    const wanted = state.desired[day] ?? [], sent = state.messages[day] ?? [];
    if (wanted.length !== sent.length) pending = true;
    for (let i = 0; i < wanted.length; i++) if (sent[i]?.hash !== await digest(wanted[i])) pending = true;
  }
  return { service: 'sesasi-discord', configured, own, pending: own && pending, lastSyncedAt: own ? state.lastSyncedAt : null, error: configured && !own ? 'SOURCE_MISMATCH' : own ? state.error : '', retryAt: own ? state.retryAt : 0 };
}
