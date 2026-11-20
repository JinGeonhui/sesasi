import { HttpError, jsonBody, type Environment } from './http.ts';
import { validDay } from './discord-contract.ts';
import { memoDay } from './discord-format.ts';
import { parseDiscordMemo, prepareImport, type ImportSnapshot, type MemoInput } from './discord-import.ts';

type Database = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
const snowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
async function equalSecret(a: string, b: string) {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
export function createDiscordImportHandler(env: Environment, db: Database, flush: (userId: string) => Promise<Response>, fetchImpl: typeof fetch = fetch) {
  return async (req: Request) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    try {
      if (req.headers.has('origin')) throw new HttpError(403, 'ORIGIN_DENIED');
      if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      const secret = env('DISCORD_BRIDGE_SECRET') ?? '';
      if (secret.length < 32) throw new HttpError(503, 'BRIDGE_NOT_CONFIGURED');
      const token = req.headers.get('authorization')?.match(/^Bearer (\S{32,256})$/)?.[1];
      if (!token || !await equalSecret(token, secret)) throw new HttpError(401, 'BRIDGE_AUTH_REQUIRED');
      const owner = env('DISCORD_OWNER_USER_ID') ?? '', channelId = env('DISCORD_CHANNEL_ID') ?? '', guildId = env('DISCORD_GUILD_ID') ?? '', authorId = env('DISCORD_AUTHOR_ID') ?? '';
      const botToken = env('DISCORD_BOT_TOKEN') ?? '', from = env('DISCORD_IMPORT_FROM') ?? '', since = env('DISCORD_SYNC_FROM') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(owner) || ![channelId, guildId, authorId].every(snowflake) || !botToken || !validDay(from) || !validDay(since)) throw new HttpError(503, 'BRIDGE_NOT_CONFIGURED');
      const rpc = async (name: string, args: Record<string, unknown>) => {
        const result = await db.rpc(name, args);
        if (result.error) throw new HttpError(result.error.message.includes('RECORD_CONFLICT') ? 409 : 503, result.error.message.includes('RECORD_CONFLICT') ? 'RECORD_CONFLICT' : 'STATE_UNAVAILABLE');
        return result.data;
      };
      const args = { p_user: owner, p_channel: channelId };
      if (req.method === 'GET') return Response.json({ messages: await rpc('sesasi_discord_import_list', args) }, { headers });
      const input = await jsonBody(req, 1024) as { action?: string; messageId?: string } | null;
      if (input?.action === 'flush') {
        const response = await flush(owner);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        return response;
      }
      if (input?.action !== 'import' || !snowflake(input.messageId)) throw new HttpError(400, 'INVALID_REQUEST');
      const messageId = input.messageId;
      const get = async (path: string) => {
        const response = await fetchImpl(`https://discord.com/api/v10/${path}`, { headers: { Authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (response.status === 429) throw new HttpError(429, 'DISCORD_RATE_LIMITED', 30);
        if (response.status !== 404 && !response.ok) throw new HttpError(502, 'DISCORD_READ_FAILED');
        const data = await response.json();
        return { response, data };
      };
      const channel = await get(`channels/${channelId}`);
      if (!channel.response.ok || channel.data.guild_id !== guildId || channel.data.type !== 0) throw new HttpError(403, 'CHANNEL_DENIED');
      // Fetch the authoritative current message instead of trusting Gateway
      // payloads (which may be partial, stale or retried out of order).
      const { response, data: message } = await get(`channels/${channelId}/messages/${messageId}`);
      const snapshot = await rpc('sesasi_discord_import_read', { ...args, p_message: messageId }) as ImportSnapshot;
      let rows: MemoInput[] | null;
      let createdAt: string, version: string;
      let deleted = false;
      if (response.status === 404) {
        if (message.code !== 10008) throw new HttpError(502, 'DISCORD_READ_FAILED');
        if (!snapshot.state) return Response.json({ ignored: true }, { headers });
        deleted = true; rows = []; createdAt = version = new Date().toISOString();
      } else {
        if (message.id !== messageId || message.channel_id !== channelId || message.author?.id !== authorId || message.author?.bot || message.webhook_id) return Response.json({ ignored: true }, { headers });
        if (!Number.isFinite(Date.parse(message.timestamp)) || typeof message.content !== 'string') throw new HttpError(502, 'DISCORD_READ_FAILED');
        if (memoDay(new Date(message.timestamp)) < from) return Response.json({ ignored: true }, { headers });
        rows = parseDiscordMemo(message.content);
        if (rows === null) {
          if (snapshot.state) throw new HttpError(422, 'INVALID_MEMO_FORMAT');
          return Response.json({ ignored: true }, { headers });
        }
        if (rows.some(row => row.date < since)) throw new HttpError(422, 'OUTSIDE_SYNC_RANGE');
        createdAt = new Date(message.timestamp).toISOString();
        if (!Number.isFinite(Date.parse(message.edited_timestamp ?? message.timestamp))) throw new HttpError(502, 'DISCORD_READ_FAILED');
        version = new Date(message.edited_timestamp ?? message.timestamp).toISOString();
      }
      const change = prepareImport(snapshot, rows, messageId, createdAt, version, deleted);
      if (change) await rpc('sesasi_discord_import_commit', { ...args, p_message: messageId, p_revision: snapshot.revision, p_state: change.state, p_changes: change.changes });
      return Response.json({ imported: true, changed: Boolean(change), count: rows.length }, { headers });
    } catch (error) {
      const known = error instanceof HttpError;
      return Response.json({ code: known ? error.code : 'BRIDGE_UNAVAILABLE' }, { status: known ? error.status : 502, headers: { ...headers, ...(known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) } });
    }
  };
}
