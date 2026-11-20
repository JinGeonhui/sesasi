import type { adminClient } from './runtime.ts';
import { HttpError, jsonBody, type Environment } from './http.ts';
import { digest, discordStatus, emptyDiscordState, validDay, validateSubmission, webhookURL, type DiscordState } from './discord-contract.ts';
import { memoCreatedOn, discordMessages } from './discord-format.ts';
import { deliverDiscord } from './discord-delivery.ts';

export async function handleDiscordSync(req: Request, user: { id: string }, env: Environment, db: ReturnType<typeof adminClient>, fetchImpl: typeof fetch = fetch) {
  const rawWebhook = env('DISCORD_WEBHOOK_URL')?.trim() ?? '';
  const webhook = rawWebhook ? webhookURL(rawWebhook) : '';
  const since = env('DISCORD_SYNC_FROM') ?? '';
  if (!validDay(since)) throw new HttpError(503, 'SETUP_REQUIRED');
  const identity = webhook ? await digest(webhook) : '';
  const normalize = (value: Partial<DiscordState> | null) => value?.identity === identity && value.desired && value.messages ? { ...emptyDiscordState(), ...value } as DiscordState : { ...emptyDiscordState(), identity };
  if (req.method === 'GET') {
    const { data, error } = await db.rpc('sesasi_discord_read', { p_user: user.id });
    if (error) throw new HttpError(503, 'STATE_UNAVAILABLE');
    const sourceId = new URL(req.url).searchParams.get('sourceId');
    const state = normalize(data);
    return Response.json(await discordStatus(sourceId === user.id ? { ...state, sourceId: user.id } : state, sourceId, Boolean(webhook), since));
  }
  if (!webhook) throw new HttpError(503, 'SETUP_REQUIRED');
  // Client snapshots can be stale on another device. Build the outbound snapshot
  // from committed account records after acquiring the delivery lease below.
  const submitted = validateSubmission(await jsonBody(req));
  const token = crypto.randomUUID();
  const { data, error } = await db.rpc('sesasi_discord_acquire', { p_user: user.id, p_token: token });
  if (error) throw new HttpError(503, 'STATE_UNAVAILABLE');
  if (data === null) throw new HttpError(429, 'BUSY', 5);
  const state = normalize(data);
  const persist = async (next: DiscordState) => {
    const result = await db.rpc('sesasi_discord_save', { p_user: user.id, p_token: token, p_state: next });
    if (result.error || !result.data) throw new HttpError(503, 'STATE_UNAVAILABLE');
  };
  try {
    let input = submitted;
    if (submitted.sourceId === user.id) {
      const records = await db.rpc('sesasi_discord_records', { p_user: user.id });
      if (records.error || !records.data) throw new HttpError(503, 'STATE_UNAVAILABLE');
      const { entries, categories } = records.data as { entries: { id: string; kind: string; date: string; title: string; done: boolean; category?: string; categoryVersion?: string; order?: string; createdOn?: string; memoType?: "planned" | "recorded" }[]; categories: Record<string, string> };
      input = validateSubmission({ sourceId: user.id, todos: entries.filter(entry => entry.kind === 'todo').map(todo => ({
        id: todo.id, kind: 'todo', date: todo.date, title: todo.title, done: todo.done,
        category: todo.category && categories[todo.category] === (todo.categoryVersion ?? 'legacy') ? todo.category : '미분류',
        order: todo.order ?? `0-${todo.id}`, createdOn: memoCreatedOn(todo), memoType: todo.memoType,
      })) });
      // A fresh device must not erase messages before the original browser imports.
      if (state.sourceId && state.sourceId !== user.id && !input.todos.length) return Response.json(await discordStatus(state, input.sourceId, true, since));
    } else if (state.sourceId && state.sourceId !== submitted.sourceId) {
      // Older published clients may keep syncing until this account migrates.
      // After migration they can no longer replace the canonical server snapshot.
      throw new HttpError(409, 'SOURCE_MISMATCH');
    }
    const todos = input.todos.filter(todo => todo.date >= since);
    if (!state.sourceId && !todos.length) return Response.json(await discordStatus(state, input.sourceId, true, since));
    const desired = Object.fromEntries([...new Set(todos.map(todo => todo.date))].sort().map(day => [day, discordMessages(day, todos)]));
    for (const [day, content] of Object.entries(state.desired)) if (day < since) desired[day] = content;
    if (JSON.stringify(desired) !== JSON.stringify(state.desired)) state.lastSyncedAt = null;
    state.sourceId = input.sourceId; state.desired = desired;
    await persist(state);
    const status = await discordStatus(state, input.sourceId, true, since);
    if (status.pending || state.error || !state.lastSyncedAt) await deliverDiscord(state, webhook, since, persist, fetchImpl);
    return Response.json(await discordStatus(state, input.sourceId, true, since));
  } finally {
    await db.rpc('sesasi_discord_release', { p_user: user.id, p_token: token });
  }
}
