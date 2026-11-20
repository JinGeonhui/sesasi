import { cloudClient, cloudConfigured, cloudRequest, CloudError } from "./cloud.ts";
import { todoCategory, todoOrder, type Todo } from "./data";
import { loadPlanner } from "./planner-store";
import { memoCreatedOn } from "./discord-format";

export type DiscordStatus = {
  service: string; configured: boolean; own: boolean; pending: boolean; lastSyncedAt: string | null; error: string; retryAt: number;
};
export type DiscordState = { phase: "loading" | "ready" | "error"; status: DiscordStatus | null; error: string };
const initial: DiscordState = { phase: "loading", status: null, error: "" };
let current = initial;
const listeners = new Set<() => void>();
export const subscribeDiscord = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getDiscordState = () => current;
export const getServerDiscordState = () => initial;
function publish(value: DiscordState) { current = value; listeners.forEach(listener => listener()); }

const messages: Record<string, string> = {
  INVALID_WEBHOOK: "디스코드에서 복사한 웹후크 URL을 확인해 주세요.",
  WEBHOOK_UNAVAILABLE: "웹후크가 삭제됐거나 사용할 수 없어요. 채널에서 새 URL을 복사해 연결해 주세요.",
  DISCORD_UNAVAILABLE: "디스코드에 연결하지 못했어요. 메모는 저장됐으며 연결이 복구되면 다시 보내요.",
  DISCORD_REJECTED: "디스코드가 메시지를 받지 못했어요. 텍스트 채널의 웹후크인지 확인해 주세요.",
  RATE_LIMITED: "디스코드 전송 요청이 많아 잠시 기다린 뒤 자동으로 다시 보내요.",
  SOURCE_MISMATCH: "메모를 저장했던 브라우저에서 새 버전을 열어 이전 기록을 가져와 주세요.",
  INVALID_MEMOS: "일부 메모의 형식을 확인하지 못해 전송을 멈췄어요. 메모를 수정한 뒤 다시 시도해 주세요.",
  STATE_UNAVAILABLE: "서버의 연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  BUSY: "메모를 반영하고 있어요. 잠시 후 다시 시도해 주세요.",
};
export const discordError = (code: string) => messages[code] ?? "디스코드 연동을 완료하지 못했어요. 다시 시도해 주세요.";

export async function discordSource() {
  const client = cloudClient();
  const session = await client?.auth.getSession();
  if (!session?.data.session) throw new CloudError('LOGIN_REQUIRED');
  return session.data.session.user.id;
}
function apiBase() {
  // The connector holds a private webhook; it is deliberately local-only.
  if (typeof window === "undefined" || !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("디스코드 연결은 이 컴퓨터의 localhost 작업 페이지에서 사용할 수 있어요.");
  }
  return `http://127.0.0.1:${process.env.NEXT_PUBLIC_DISCORD_PORT || "4192"}`;
}
async function request(path: string, method = "GET", body?: object): Promise<DiscordStatus> {
  const base = cloudConfigured ? "" : apiBase();
  let response;
  try {
    const init = { method, cache: "no-store" as RequestCache, signal: AbortSignal.timeout(cloudConfigured ? 90000 : 20000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) };
    const params = Object.fromEntries(new URL(path, "http://localhost").searchParams);
    response = cloudConfigured ? await cloudRequest("discord-sync", params, init) : await fetch(base + path, init);
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new Error(cloudConfigured ? "개인 서버에 연결하지 못했어요. 메모는 저장됐으며 다시 시도합니다." : "디스코드 연결 서버가 꺼져 있어요. 이 컴퓨터에서 개발 서버를 다시 실행해 주세요.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(discordError(result.code));
  if (result.service !== "sesasi-discord") throw new Error("디스코드 연결 서버를 확인하지 못했어요.");
  return result;
}

export async function discordTodos(): Promise<Todo[]> {
  const { entries } = await loadPlanner();
  return entries.filter((entry): entry is Todo => entry.kind === "todo").map((entry): Todo => {
    const todo = entry;
    return { id: todo.id, kind: "todo", date: todo.date, title: todo.title, done: todo.done,
      category: todoCategory(todo), order: todoOrder(todo), createdOn: memoCreatedOn(todo), memoType: todo.memoType };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

let tail = Promise.resolve();
function serialized(operation: () => Promise<void>) {
  const task = tail.then(async () => {
    if (navigator.locks) await navigator.locks.request("sesasi-discord-sync", operation);
    else await operation();
  });
  tail = task.then(() => {}, () => {});
  return task;
}
function update(status: DiscordStatus) { publish({ phase: "ready", status, error: status.error ? discordError(status.error) : "" }); }

export async function refreshDiscord() {
  return serialized(async () => {
    try {
      const sourceId = await discordSource();
      let status = await request(`/v1/status?sourceId=${encodeURIComponent(sourceId)}`);
      if (status.own && status.configured) status = await request("/v1/sync", "POST", { sourceId, todos: await discordTodos() });
      update(status);
    } catch (error) {
      publish({ phase: "error", status: current.status, error: error instanceof Error ? error.message : "메모 저장소를 읽지 못했어요." });
    }
  });
}
