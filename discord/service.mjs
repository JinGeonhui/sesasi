import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { discordMessages } from "../app/planner/discord-format.ts";

export class DiscordError extends Error {
  constructor(code, retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
const fail = code => { throw new DiscordError(code); };
const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validSource = value => typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
const digest = value => createHash("sha256").update(value).digest("hex");

export function webhookURL(value) {
  let url;
  try { url = new URL(value); } catch { fail("INVALID_WEBHOOK"); }
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname)
    || url.port || url.username || url.password || url.hash
    || !/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[\w-]{40,200}$/.test(url.pathname)
    || [...url.searchParams.keys()].some(key => key !== "thread_id")
    || (url.search && (url.searchParams.getAll("thread_id").length !== 1 || !/^\d{17,20}$/.test(url.searchParams.get("thread_id"))))) fail("INVALID_WEBHOOK");
  url.hostname = "discord.com";
  url.pathname = url.pathname.replace(/^\/api\/(?!v10\/)/, "/api/v10/");
  return url.href;
}

export function validateSnapshot(value) {
  if (!Array.isArray(value) || value.length > 5000) fail("INVALID_MEMOS");
  const ids = new Set();
  return value.map(todo => {
    if (!todo || typeof todo.id !== "string" || !todo.id || todo.id.length > 100 || ids.has(todo.id)
      || todo.kind !== "todo" || !validDay(todo.date) || typeof todo.done !== "boolean"
      || typeof todo.title !== "string" || !todo.title.trim() || todo.title.length > 120
      || typeof todo.category !== "string" || todo.category.length > 40
      || typeof todo.order !== "string" || todo.order.length > 2000
      || (todo.createdOn !== "" && !validDay(todo.createdOn))) fail("INVALID_MEMOS");
    ids.add(todo.id);
    return { id: todo.id, kind: "todo", date: todo.date, done: todo.done, title: todo.title,
      category: todo.category, order: todo.order, createdOn: todo.createdOn };
  });
}

export async function createDiscordService({ file, webhookUrl = "", since = "", fetchImpl = fetch, now = Date.now }) {
  const webhook = webhookUrl.trim() ? webhookURL(webhookUrl.trim()) : "";
  if (since && !validDay(since)) fail("INVALID_DATE");
  let state = { version: 2, sourceId: null, since: "", identity: "", desired: {}, messages: {}, lastSyncedAt: null };
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (![1, 2].includes(saved.version) || !saved.desired || !saved.messages) fail("STATE_UNAVAILABLE");
    state = { version: 2, identity: saved.identity, sourceId: saved.sourceId ?? saved.config?.sourceId ?? null,
      since: saved.since ?? saved.config?.since ?? "", desired: saved.desired, messages: saved.messages, lastSyncedAt: saved.lastSyncedAt };
  } catch (error) { if (error.code !== "ENOENT") fail("STATE_UNAVAILABLE"); }
  if (webhook && state.identity !== digest(webhook)) {
    state = { version: 2, sourceId: null, since: "", identity: digest(webhook), desired: {}, messages: {}, lastSyncedAt: null };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now()));
  state.since = since || state.since || today;
  let tail = Promise.resolve(), lastError = "", retryAt = 0;
  const serial = fn => { const task = tail.then(fn); tail = task.catch(() => {}); return task; };
  async function save(next) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, file);
      state = next;
    } catch { fail("STATE_UNAVAILABLE"); }
  }
  function pending() {
    if (!webhook) return false;
    const days = new Set([...Object.keys(state.desired), ...Object.keys(state.messages)]);
    return [...days].some(day => {
      if (day < state.since) return false;
      const wanted = state.desired[day] ?? [], sent = state.messages[day] ?? [];
      return wanted.length !== sent.length || wanted.some((content, i) => sent[i]?.hash !== digest(content));
    });
  }
  function status(sourceId) {
    const own = Boolean(webhook) && (!state.sourceId || state.sourceId === sourceId);
    return { service: "sesasi-discord", configured: Boolean(webhook), own,
      pending: own && pending(), lastSyncedAt: own ? state.lastSyncedAt : null,
      error: webhook && !own ? "SOURCE_MISMATCH" : own ? lastError : "", retryAt: own ? retryAt : 0 };
  }
  async function request(webhook, method, messageId, content) {
    const url = new URL(webhook);
    if (messageId) url.pathname += `/messages/${messageId}`;
    if (method === "POST") url.searchParams.set("wait", "true");
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: "error", signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        ...(content === undefined ? {} : { body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }) }) });
    } catch { fail("DISCORD_UNAVAILABLE"); }
    if (response.status === 204) return null;
    let body;
    try { body = await response.json(); } catch { fail("DISCORD_UNAVAILABLE"); }
    if (response.status === 429) throw new DiscordError("RATE_LIMITED", Math.max(1000, Math.min(3600000, Number(body.retry_after) * 1000 || 5000)));
    if (response.status === 404 && body.code === 10008) fail("MESSAGE_MISSING");
    if ([401, 403, 404].includes(response.status)) fail("WEBHOOK_UNAVAILABLE");
    if (!response.ok) fail(response.status === 400 ? "DISCORD_REJECTED" : "DISCORD_UNAVAILABLE");
    return body;
  }
  async function flush() {
    if (!webhook || !state.sourceId || now() < retryAt) return;
    try {
      const days = [...new Set([...Object.keys(state.desired), ...Object.keys(state.messages)])].filter(day => day >= state.since).sort();
      for (const day of days) {
        const wanted = state.desired[day] ?? [];
        for (let i = 0; i < wanted.length; i++) {
          let sent = state.messages[day]?.[i];
          if (sent?.hash === digest(wanted[i])) continue;
          if (sent) {
            try { await request(webhook, "PATCH", sent.id, wanted[i]); }
            catch (error) { if (error.code !== "MESSAGE_MISSING") throw error; sent = null; }
          }
          if (!sent) {
            const posted = await request(webhook, "POST", null, wanted[i]);
            if (!/^\d{17,20}$/.test(posted?.id)) fail("DISCORD_UNAVAILABLE");
            sent = { id: posted.id };
          }
          const messages = structuredClone(state.messages);
          messages[day] ??= [];
          messages[day][i] = { id: sent.id, hash: digest(wanted[i]) };
          await save({ ...state, messages });
        }
        while ((state.messages[day]?.length ?? 0) > wanted.length) {
          const sent = state.messages[day].at(-1);
          try { await request(webhook, "DELETE", sent.id); }
          catch (error) { if (error.code !== "MESSAGE_MISSING") throw error; }
          const messages = structuredClone(state.messages);
          messages[day].pop();
          if (!messages[day].length) delete messages[day];
          await save({ ...state, messages });
        }
      }
      if (pending()) return;
      if (lastError || !state.lastSyncedAt) await save({ ...state, lastSyncedAt: new Date(now()).toISOString() });
      lastError = ""; retryAt = 0;
    } catch (error) {
      lastError = error instanceof DiscordError ? error.code : "STATE_UNAVAILABLE";
      retryAt = now() + (error.retryAfter || 30000);
    }
  }
  return {
    status,
    submit: input => serial(async () => {
      if (!webhook) fail("SETUP_REQUIRED");
      if (!validSource(input?.sourceId)) fail("INVALID_REQUEST");
      if (state.sourceId && state.sourceId !== input.sourceId) fail("SOURCE_MISMATCH");
      const todos = validateSnapshot(input.todos).filter(todo => todo.date >= state.since);
      // An empty new browser must not claim the personal connection.
      if (!state.sourceId && !todos.length) return status(input.sourceId);
      const desired = Object.fromEntries([...new Set(todos.map(todo => todo.date))].sort().map(day => [day, discordMessages(day, todos)]));
      // Retain older published dates outside the chosen synchronization window.
      for (const [day, content] of Object.entries(state.desired)) if (day < state.since) desired[day] = content;
      if (state.sourceId && JSON.stringify(desired) === JSON.stringify(state.desired)) return status(input.sourceId);
      await save({ ...state, desired, sourceId: input.sourceId, lastSyncedAt: null });
      lastError = "";
      return status(input.sourceId);
    }),
    flush: () => serial(flush),
  };
}
