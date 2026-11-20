import { createHash } from 'node:crypto';

export function bridgeConfig(env) {
  const required = ['DISCORD_BOT_TOKEN', 'DISCORD_BRIDGE_SECRET', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID', 'DISCORD_AUTHOR_ID', 'DISCORD_IMPORT_FROM', 'SUPABASE_URL'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')}`);
  if (env.DISCORD_BRIDGE_SECRET.length < 32) throw new Error('DISCORD_BRIDGE_SECRET must contain at least 32 characters');
  for (const key of ['DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID', 'DISCORD_AUTHOR_ID']) if (!/^\d{17,20}$/.test(env[key])) throw new Error(`Invalid ${key}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.DISCORD_IMPORT_FROM) || !Number.isFinite(Date.parse(env.DISCORD_IMPORT_FROM)) || new Date(env.DISCORD_IMPORT_FROM).toISOString().slice(0, 10) !== env.DISCORD_IMPORT_FROM) throw new Error('Invalid DISCORD_IMPORT_FROM');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid SUPABASE_URL');
  return { token: env.DISCORD_BOT_TOKEN, secret: env.DISCORD_BRIDGE_SECRET, guildId: env.DISCORD_GUILD_ID, channelId: env.DISCORD_CHANNEL_ID, authorId: env.DISCORD_AUTHOR_ID, from: Date.parse(`${env.DISCORD_IMPORT_FROM}T00:00:00+09:00`), endpoint: `${url.origin}/functions/v1/discord-import` };
}

export function bridgeRequest(config, fetchImpl = fetch) {
  return async (body) => {
    const response = await fetchImpl(config.endpoint, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(90000),
    });
    const data = await response.json();
    if (!response.ok) { const error = new Error('Bridge request failed'); error.code = data.code ?? 'BRIDGE_UNAVAILABLE'; throw error; }
    return data;
  };
}

// The durable queue is the Discord channel plus server-side message mappings.
// Every scan replays all source messages since the configured start and checks
// missing mapped IDs. In-memory fingerprints only avoid redundant requests.
export function createBridge({ config, request, fetchPage, report = () => {} }) {
  let tail = Promise.resolve(), known = new Set(), scanning = false, flushing = false;
  const fingerprints = new Map(), errors = new Map();
  const serialized = action => {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  };
  async function importMessage(id, fingerprint) {
    if (fingerprints.get(id) === fingerprint) return;
    try {
      const result = await request({ action: 'import', messageId: id });
      fingerprints.set(id, fingerprint); errors.delete(id);
      if (result.imported) known.add(id);
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'BRIDGE_UNAVAILABLE';
      if (errors.get(id) !== code) { errors.set(id, code); report(id, code); }
      // Do not cache failures. A later scan retries even without another edit.
      // Stop an unavailable/rate-limited scan instead of repeating the same
      // failing request for every historical message.
      if (!['MEMO_CONFLICT', 'RECORD_CONFLICT', 'INVALID_MEMO_FORMAT', 'OUTSIDE_SYNC_RANGE'].includes(code)) throw error;
    }
  }
  async function accept(message) {
    if (message.channelId !== config.channelId || message.guildId !== config.guildId || message.author?.id !== config.authorId || message.author.bot || message.webhookId || message.createdTimestamp < config.from) return;
    if (!known.has(message.id) && !/^#\s+\d{4}[.-]/.test(message.content)) return;
    const signature = createHash('sha256').update(`${message.editedTimestamp ?? ''}:${message.content}`).digest('hex');
    await importMessage(message.id, signature);
  }
  return {
    onMessage: message => serialized(() => accept(message)),
    onDelete: message => serialized(async () => {
      if (message.channelId === config.channelId) {
        fingerprints.delete(message.id);
        await importMessage(message.id, 'deleted');
      }
    }),
    flush: async () => {
      if (flushing) return;
      flushing = true;
      try { return await serialized(() => request({ action: 'flush' })); }
      finally { flushing = false; }
    },
    scan: async () => {
      if (scanning) return;
      scanning = true;
      try {
        await serialized(async () => {
          known = new Set((await request()).messages);
          const seen = new Set();
          let before, complete = false;
          for (let page = 0; page < 500; page++) {
            const messages = await fetchPage(before);
            if (!messages.length) { complete = true; break; }
            for (const message of [...messages].reverse()) {
              seen.add(message.id);
              await accept(message);
            }
            const oldest = messages.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b);
            if (messages.length < 100 || oldest.createdTimestamp < config.from) { complete = true; break; }
            before = oldest.id;
          }
          if (!complete) throw new Error('Channel scan limit reached; narrow DISCORD_IMPORT_FROM');
          for (const id of known) if (!seen.has(id)) await importMessage(id, 'deleted');
          await request({ action: 'flush' });
        });
      } finally { scanning = false; }
    },
    drain: () => tail,
  };
}
