import { cloudConfigured, cloudRequest, CloudError } from "./cloud.ts";
export type TransitCity = { id: string; name: string };
export type TransitLine = { id: string; name: string; type?: string; start?: string; end?: string; stops?: TransitStop[] };
export type TransitStop = { key: string; id: string; name: string; number: string; order: number; direction: string };
export type TransitStation = { id: string; name: string; number: string };
export type TransitConnection = TransitLine & { key: string; from: TransitStop; to: TransitStop; next: string };
export type TransitArrival = { routeId: string; seconds: number; stopsAway: number; vehicle: string; checkedAt: string };
export type TransitSelection = {
  provider: "tago"; routeId: string; cityCode?: string; cityName?: string;
  fromId: string; toId: string; fromKey: string; toKey: string; direction: string;
};

export function transitPick(line: TransitLine, stops: TransitStop[], fromKey: string, toKey: string, bus: boolean, city?: TransitCity) {
  const start = stops.find(stop => stop.key === fromKey), end = stops.find(stop => stop.key === toKey);
  if (!start || !end || start.key === end.key || (bus && (start.direction !== end.direction || end.order <= start.order))) return null;
  const transit: TransitSelection = { provider: "tago", routeId: line.id, cityCode: city?.id, cityName: city?.name, fromId: start.id, toId: end.id, fromKey: start.key, toKey: end.key, direction: start.direction };
  return { title: line.name, from: start.name, to: end.name, transit };
}

export const transitMessages: Record<string, string> = {
  SETUP_REQUIRED: "노선 검색 연결을 준비 중이에요. 연결 후 버스와 지하철 목록을 선택할 수 있어요.",
  AUTH_REQUIRED: "이 교통정보 서비스의 이용 승인이 필요해요. 연결 후 이용할 수 있어요.",
  QUOTA_EXCEEDED: "교통정보 조회가 잠시 많아요. 나중에 다시 시도해 주세요.",
  BUSY: "다른 교통정보를 불러오고 있어요. 잠시 후 다시 시도해 주세요.",
};
function apiBase() {
  const value = process.env.NEXT_PUBLIC_TRANSIT_API_URL || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:4191" : "");
  if (!value) throw new Error(transitMessages.SETUP_REQUIRED);
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, "");
  } catch { throw new Error(transitMessages.SETUP_REQUIRED); }
}
export async function transitList<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T[]> {
  const url = cloudConfigured ? "" : `${apiBase()}/v1/${path}?${new URLSearchParams(params)}`;
  let response;
  try {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(path.endsWith("arrivals") ? 15000 : 90000)]);
    response = cloudConfigured ? await cloudRequest("transit", { path, ...params }, { signal: requestSignal }) : await fetch(url, { signal: requestSignal });
  }
  catch (error) { if (error instanceof CloudError) throw error; if (signal.aborted) throw new DOMException("Aborted", "AbortError"); throw new Error("교통정보에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."); }
  let body;
  try { body = await response.json(); } catch { throw new Error("교통정보를 읽지 못했어요. 다시 시도해 주세요."); }
  if (!response.ok) throw new Error(transitMessages[body?.code] ?? "교통정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!Array.isArray(body.items)) throw new Error("교통정보를 읽지 못했어요. 다시 시도해 주세요.");
  return body.items;
}

const arrivalRequests = new Map<string, Promise<TransitArrival[]>>();
const arrivalCache = new Map<string, { expires: number; items: TransitArrival[] }>();
// Every route at the same boarding stop shares one request and a short cache.
// Unmounting one card must not cancel the other cards' request.
export function stationArrivals(city: string, node: string): Promise<TransitArrival[]> {
  const key = JSON.stringify([city, node]);
  const cached = arrivalCache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.items);
  const pending = arrivalRequests.get(key);
  if (pending) return pending;
  const request = transitList<TransitArrival>("station-arrivals", { city, node }, AbortSignal.timeout(15000)).then(items => {
    if (arrivalCache.size >= 100) arrivalCache.delete(arrivalCache.keys().next().value!);
    arrivalCache.set(key, { expires: Date.now() + 5000, items });
    return items;
  }).finally(() => arrivalRequests.delete(key));
  arrivalRequests.set(key, request);
  return request;
}
