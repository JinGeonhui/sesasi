import { digest, type DiscordState } from './discord-contract.ts';
import { HttpError } from './http.ts';
// Save each successful message before proceeding. Another worker must hold the
// database lease before entering this function; persist() checks its fencing token.
export async function deliverDiscord(state: DiscordState, webhook: string, since: string, persist: (state: DiscordState) => Promise<void>, fetcher = fetch, now = Date.now) {
  if (now() < state.retryAt) return;
  const deadline = now() + 45000;
  let operations = 0;
  async function request(method: string, id?: string, content?: string): Promise<string | null> {
    if (now() >= deadline || ++operations > 20) throw new HttpError(429, 'CONTINUE_PENDING', 1);
    // Renew/check lease ownership before any external side effect.
    await persist(state);
    const url = new URL(webhook);
    if (id) url.pathname += `/messages/${id}`;
    if (method === 'POST') url.searchParams.set('wait', 'true');
    let response: Response;
    try { response = await fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json' }, ...(content === undefined ? {} : { body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }) }) }); }
    catch { throw new HttpError(502, 'DISCORD_UNAVAILABLE'); }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null);
    if (response.status === 429) throw new HttpError(429, 'RATE_LIMITED', Math.max(1, Math.min(3600, Math.ceil(Number(body?.retry_after) || 5))));
    if (response.status === 404 && body?.code === 10008) throw new HttpError(404, 'MESSAGE_MISSING');
    if ([401, 403, 404].includes(response.status)) throw new HttpError(502, 'WEBHOOK_UNAVAILABLE');
    if (!response.ok || !/^\d{17,20}$/.test(body?.id ?? '')) throw new HttpError(502, 'DISCORD_UNAVAILABLE');
    return body.id;
  }
  try {
    const days = [...new Set([...Object.keys(state.desired), ...Object.keys(state.messages)])].filter(day => day >= since).sort();
    for (const day of days) {
      const wanted = state.desired[day] ?? [];
      for (let i = 0; i < wanted.length; i++) {
        const hash = await digest(wanted[i]); const sent = state.messages[day]?.[i];
        if (sent?.hash === hash) continue;
        let id: string | undefined = sent?.id;
        if (id) {
          try { await request('PATCH', id, wanted[i]); }
          catch (error) { if (!(error instanceof HttpError) || error.code !== 'MESSAGE_MISSING') throw error; id = undefined; }
        }
        if (!id) id = (await request('POST', undefined, wanted[i]))!;
        state.messages[day] ??= []; state.messages[day][i] = { id, hash };
        await persist(state);
      }
      while ((state.messages[day]?.length ?? 0) > wanted.length) {
        const sent = state.messages[day].at(-1)!;
        try { await request('DELETE', sent.id); }
        catch (error) { if (!(error instanceof HttpError) || error.code !== 'MESSAGE_MISSING') throw error; }
        state.messages[day].pop(); if (!state.messages[day].length) delete state.messages[day];
        await persist(state);
      }
    }
    state.error = ''; state.retryAt = 0; state.lastSyncedAt = new Date(now()).toISOString();
  } catch (error) {
    state.error = error instanceof HttpError ? error.code : 'STATE_UNAVAILABLE';
    state.retryAt = now() + (error instanceof HttpError && error.retryAfter ? error.retryAfter * 1000 : 30000);
  }
  await persist(state);
}
