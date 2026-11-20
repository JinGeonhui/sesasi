import { HttpError, type Environment } from './http.ts';
import { MEMO_MODAL_ID, memoModal, parseMemoModal } from './discord-modal.ts';
import type { MemoInput } from './discord-import.ts';

type ImportHandler = (request: Request) => Promise<Response>;
type DiscordMessage = { id: string; channel_id: string; author: { id: string; bot?: boolean }; webhook_id?: string; timestamp: string; content: string };
const snowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value);
const reply = (content: string) => Response.json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

// Each command invokes the existing importer in-process, not another Edge Function.
// Finish pagination before reconciling deletions; a failed scan never implies deletion.
export async function syncDiscordCommand(env: Environment, importer: ImportHandler, fetchImpl: typeof fetch = fetch, now = Date.now) {
  const start = now(), channel = env('DISCORD_CHANNEL_ID')!, author = env('DISCORD_AUTHOR_ID')!;
  const since = Date.parse(`${env('DISCORD_IMPORT_FROM')}T00:00:00+09:00`);
  if (!Number.isFinite(since)) throw new Error('SETUP_REQUIRED');
  const call = async (body?: object) => {
    const response = await importer(new Request('https://internal/discord-import', {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env('DISCORD_BRIDGE_SECRET')}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const data = await response.json();
    if (!response.ok) throw new Error(data.code ?? 'BRIDGE_UNAVAILABLE');
    return data;
  };
  const known: string[] = (await call()).messages;
  const seen = new Set<string>(), candidates = new Set<string>();
  let before = '', complete = false;
  for (let page = 0; page < 10; page++) {
    if (now() - start > 45000) throw new Error('SCAN_LIMIT');
    const response = await fetchImpl(`https://discord.com/api/v10/channels/${channel}/messages?limit=100${before ? `&before=${before}` : ''}`, {
      headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('DISCORD_READ_FAILED');
    const messages: DiscordMessage[] = await response.json();
    if (!Array.isArray(messages) || messages.some(m => !snowflake(m.id) || m.channel_id !== channel || !Number.isFinite(Date.parse(m.timestamp)))) throw new Error('DISCORD_READ_FAILED');
    if (!messages.length) { complete = true; break; }
    for (const message of messages) {
      seen.add(message.id);
      if (message.author?.id === author && !message.author.bot && !message.webhook_id && Date.parse(message.timestamp) >= since && (known.includes(message.id) || /^#\s+\d{4}[.-]/.test(message.content))) candidates.add(message.id);
    }
    const oldest = messages.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b);
    if (messages.length < 100 || Date.parse(oldest.timestamp) < since) { complete = true; break; }
    if (before && BigInt(oldest.id) >= BigInt(before)) throw new Error('DISCORD_READ_FAILED');
    before = oldest.id;
  }
  if (!complete) throw new Error('SCAN_LIMIT');
  // The importer confirms a missing source with Discord before applying a tombstone.
  for (const id of known) if (!seen.has(id)) candidates.add(id);
  let changed = 0, failed = 0, processed = 0;
  for (const id of [...candidates].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)) {
    if (now() - start > 85000) break;
    try {
      const result = await call({ action: 'import', messageId: id });
      if (result.changed) changed++;
    } catch (error) {
      failed++;
      if (!(error instanceof Error) || !['MEMO_CONFLICT', 'RECORD_CONFLICT', 'INVALID_MEMO_FORMAT', 'OUTSIDE_SYNC_RANGE'].includes(error.message)) break;
    }
    processed++;
  }
  // Existing app -> Discord sync is independent. Do not turn a successful import
  // into a reported failure just because its outbound webhook is temporarily busy.
  let outputPending = false;
  if (candidates.size && now() - start < 100000) {
    try { await call({ action: 'flush' }); } catch { outputPending = true; }
  } else if (changed) outputPending = true;
  return { checked: candidates.size, changed, failed, remaining: candidates.size - processed, outputPending };
}

type Dependencies = {
  env: Environment;
  waitUntil: (task: Promise<void>) => void;
  claim: (id: string) => Promise<string>;
  release: (id: string) => Promise<void>;
  save: (id: string, rows: MemoInput[]) => Promise<{ count: number; outputPending: boolean }>;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export function createDiscordCommandHandler({ env, waitUntil, claim, release, save, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), fetchImpl = fetch, now = Date.now }: Dependencies) {
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const signature = request.headers.get('x-signature-ed25519') ?? '', timestamp = request.headers.get('x-signature-timestamp') ?? '';
    const publicKey = env('DISCORD_APPLICATION_PUBLIC_KEY') ?? '';
    if (!/^[a-f\d]{64}$/i.test(publicKey)) return new Response(null, { status: 503 });
    if (!/^[a-f\d]{128}$/i.test(signature) || !/^\d+$/.test(timestamp) || Math.abs(now() - Number(timestamp) * 1000) > 300000) return new Response(null, { status: 401 });
    const body = await request.text();
    if (body.length > 65536) return new Response(null, { status: 413 });
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16));
    try {
      const key = await crypto.subtle.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
      if (!await crypto.subtle.verify('Ed25519', key, bytes(signature), new TextEncoder().encode(timestamp + body))) return new Response(null, { status: 401 });
    } catch { return new Response(null, { status: 401 }); }
    let interaction;
    try { interaction = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
    if (!interaction || interaction.application_id !== env('DISCORD_APPLICATION_ID')) return new Response(null, { status: 403 });
    if (interaction.type === 1) return Response.json({ type: 1 });
    const command = interaction.type === 2 && interaction.data?.name === 'memo';
    const submission = interaction.type === 5 && interaction.data?.custom_id === MEMO_MODAL_ID;
    if (!command && !submission) return reply('메모를 추가하려면 /memo를 실행해 주세요.');
    if (interaction.guild_id !== env('DISCORD_GUILD_ID') || interaction.channel_id !== env('DISCORD_CHANNEL_ID') || interaction.member?.user?.id !== env('DISCORD_AUTHOR_ID')) return reply('지정된 메모 채널에서 연결된 본인 계정만 사용할 수 있습니다.');
    if (!snowflake(interaction.id) || typeof interaction.token !== 'string' || !/^[A-Za-z0-9._-]{1,512}$/.test(interaction.token)) return new Response(null, { status: 400 });
    if (command) return Response.json(memoModal(now()));
    let rows: MemoInput[];
    try { rows = parseMemoModal(interaction.data.components, env('DISCORD_SYNC_FROM')); }
    catch (error) {
      return reply(error instanceof HttpError && error.code === 'OUTSIDE_SYNC_RANGE'
        ? `${env('DISCORD_SYNC_FROM')} 이후 날짜로 입력해 주세요. /memo로 다시 열 수 있습니다.`
        : '저장하지 못했습니다. 날짜와 각 줄의 형식을 확인해 주세요: - [카테고리] 내용 또는 1. [카테고리] 내용 (본문 120자 이하). /memo로 다시 열 수 있습니다.');
    }
    const task = async () => {
      let acquired = false, content: string, dismiss = false;
      try {
        const status = await claim(interaction.id);
        if (status === 'duplicate') return;
        if (status !== 'acquired') content = '다른 메모를 저장 중입니다. 잠시 후 /memo로 다시 추가해 주세요.';
        else {
          acquired = true;
          const result = await save(interaction.id, rows);
          content = `메모 ${result.count}개를 반영했습니다.`;
          dismiss = !result.outputPending;
          if (result.outputPending) content += '\n서사시 저장은 완료했지만 디스코드 목록 갱신이 지연되고 있습니다. 같은 메모를 다시 추가하지 않아도 됩니다.';
        }
      } catch (error) {
        content = error instanceof HttpError && ['MEMO_CONFLICT', 'RECORD_CONFLICT'].includes(error.code)
          ? '기존 메모와 중복되거나 동시에 변경되어 추가하지 못했습니다. 서사시에서 해당 날짜의 메모를 확인해 주세요.'
          : '저장 결과를 확인하지 못했습니다. 서사시에서 메모를 확인한 뒤, 없으면 /memo로 다시 추가해 주세요.';
      } finally { if (acquired) await release(interaction.id).catch(() => {}); }
      const url = `https://discord.com/api/v10/webhooks/${env('DISCORD_APPLICATION_ID')}/${interaction.token}/messages/@original`;
      const response = await fetchImpl(url, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (!response.ok) { console.error('Discord command result delivery failed.'); return; }
      if (dismiss) {
        await sleep(5000);
        const deleted = await fetchImpl(url, { method: 'DELETE', signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (!deleted.ok && deleted.status !== 404) console.error('Discord command result cleanup failed.');
      }
    };
    waitUntil(task().catch(() => { console.error('Discord command failed.'); }));
    return Response.json({ type: 5, data: { flags: 64 } });
  };
}
