import { cloudConfigured, cloudRequest, CloudError } from "./cloud.ts";
import { freshness, maxAge, parseWeather, weatherAge, weatherStale, weatherTime, weatherURL, type City, type WeatherData, type WeatherKind } from "./weather-data.ts";

export type WeatherIssue = "timeout" | "network" | "rate-limit" | "server" | "invalid" | "auth";
export class WeatherRequestError extends Error {
  issue: WeatherIssue;
  retryAfter: number;
  constructor(issue: WeatherIssue, retryAfter = 0) { super(issue); this.issue = issue; this.retryAfter = retryAfter; }
}
export type WeatherPayload = { body: unknown; fetchedAt: number };
export type WeatherSnapshot = {
  data: WeatherData | null; fetchedAt: number; pending: boolean; slow: boolean;
  stale: boolean; error: WeatherIssue | null; retryAt: number | null;
};
export const initialWeather: WeatherSnapshot = { data: null, fetchedAt: 0, pending: true, slow: false, stale: false, error: null, retryAt: null };
export const getServerWeather = () => initialWeather;
type Cache = Pick<Storage, "getItem" | "setItem">;

export function weatherCacheKey(kind: WeatherKind, city: City) { return `sesasi.weather.cache.v1.${kind}.${city}`; }
export function readWeatherCache(kind: WeatherKind, city: City, storage: Cache | undefined, now: number): WeatherPayload | null {
  try {
    const stored = JSON.parse(storage?.getItem(weatherCacheKey(kind, city)) ?? "null");
    if (!stored || !Number.isFinite(stored.fetchedAt) || stored.fetchedAt > now + 60000) return null;
    const data = parseWeather(kind, stored.body);
    const age = weatherAge(data, stored.fetchedAt, now);
    return weatherTime(data.time) <= now + 15 * 60000 && age >= 0 && age < maxAge ? stored : null;
  } catch { return null; }
}

async function fetchWeather(kind: WeatherKind, city: City, signal: AbortSignal): Promise<WeatherPayload> {
  const configured = process.env.NEXT_PUBLIC_TRANSIT_API_URL;
  const local = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const base = configured || (local ? `http://127.0.0.1:${process.env.NEXT_PUBLIC_TRANSIT_PORT || "4191"}` : "");
  const url = base ? `${base.replace(/\/$/, "")}/v1/${kind}?city=${encodeURIComponent(city)}` : weatherURL(kind, city);
  let response: Response;
  try { response = cloudConfigured ? await cloudRequest("weather", { kind, city }, { signal }) : await fetch(url, { signal }); }
  catch (error) { throw new WeatherRequestError(error instanceof CloudError ? "auth" : signal.aborted ? "timeout" : "network"); }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const delay = retry ? /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now() : 60000;
    throw new WeatherRequestError("rate-limit", Number.isFinite(delay) ? Math.max(1000, Math.min(3600000, delay)) : 60000);
  }
  let json;
  try { json = await response.json(); } catch { throw new WeatherRequestError(response.ok ? "invalid" : "server"); }
  if (!response.ok) throw new WeatherRequestError(json.code === "WEATHER_TIMEOUT" ? "timeout" : "server");
  return cloudConfigured || base ? json : { body: json, fetchedAt: Date.now() };
}

type ResourceOptions = {
  request?: (kind: WeatherKind, city: City, signal: AbortSignal) => Promise<WeatherPayload>;
  storage?: () => Cache | undefined; now?: () => number; timeoutMs?: number;
};

export function createWeatherResource(kind: WeatherKind, city: City, options: ResourceOptions = {}) {
  const now = options.now ?? Date.now;
  const request = options.request ?? fetchWeather;
  const storage = options.storage ?? (() => undefined);
  let state = initialWeather, failures = 0, controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: WeatherSnapshot) { state = next; listeners.forEach(listener => listener()); }
  function schedule(delay: number) {
    clearTimeout(timer);
    if (listeners.size) timer = setTimeout(() => void refresh(), Math.max(0, delay));
  }
  function retained() {
    return state.data && weatherAge(state.data, state.fetchedAt, now()) < maxAge ? state.data : null;
  }
  async function refresh() {
    if (!listeners.size || controller) return;
    clearTimeout(timer);
    // Respect provider rate limits even if the user repeatedly clicks refresh.
    if (state.error === "rate-limit" && state.retryAt && now() < state.retryAt) { schedule(state.retryAt - now()); return; }
    const active = new AbortController(); controller = active;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; active.abort(); }, options.timeoutMs ?? 35000);
    const slow = setTimeout(() => { if (controller === active) publish({ ...state, slow: true }); }, 10000);
    const data = retained();
    publish({ ...state, data, pending: true, slow: false, stale: Boolean(data && weatherStale(kind, data, state.fetchedAt, now())), retryAt: null });
    try {
      const payload = await request(kind, city, active.signal);
      if (controller !== active) return;
      if (active.signal.aborted) throw new WeatherRequestError("timeout");
      const data = parseWeather(kind, payload.body);
      if (!Number.isFinite(payload.fetchedAt) || payload.fetchedAt > now() + 60000
        || weatherAge(data, payload.fetchedAt, now()) >= maxAge || weatherTime(data.time) > now() + 15 * 60000) throw new WeatherRequestError("invalid");
      try { storage()?.setItem(weatherCacheKey(kind, city), JSON.stringify(payload)); } catch { /* In-memory readings still work. */ }
      failures = 0;
      publish({ data, fetchedAt: payload.fetchedAt, pending: false, slow: false, stale: weatherStale(kind, data, payload.fetchedAt, now()), error: null, retryAt: null });
      schedule(freshness);
    } catch (error) {
      if (controller !== active) return;
      const issue = timedOut ? "timeout" : error instanceof WeatherRequestError ? error.issue : "invalid";
      const delay = Math.max(error instanceof WeatherRequestError ? error.retryAfter : 0, [5000, 15000, 60000, 300000][Math.min(failures++, 3)]);
      publish({ ...state, data: retained(), pending: false, slow: false, stale: true, error: issue, retryAt: now() + delay });
      schedule(delay);
    } finally { clearTimeout(timeout); clearTimeout(slow); if (controller === active) controller = null; }
  }
  function wake() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!state.data || state.error || weatherAge(state.data, state.fetchedAt, now()) >= freshness) void refresh();
  }
  return {
    getSnapshot: () => state,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const cache = readWeatherCache(kind, city, storage(), now());
        if (cache) {
          const data = parseWeather(kind, cache.body);
          state = { data, fetchedAt: cache.fetchedAt, pending: false, slow: false, stale: weatherStale(kind, data, cache.fetchedAt, now()), error: null, retryAt: null };
          schedule(Math.max(0, freshness - (now() - cache.fetchedAt)));
        } else { state = { ...initialWeather }; schedule(0); }
        if (typeof window !== "undefined") { window.addEventListener("online", wake); window.addEventListener("sesasi-cloud-auth", wake); }
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          const previous = controller; controller = null; previous?.abort();
          if (typeof window !== "undefined") { window.removeEventListener("online", wake); window.removeEventListener("sesasi-cloud-auth", wake); }
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
        }
      };
    },
  };
}
const resources = new Map<string, ReturnType<typeof createWeatherResource>>();
export function weatherResource(kind: WeatherKind, city: City) {
  const key = `${kind}:${city}`;
  let resource = resources.get(key);
  if (!resource) { resource = createWeatherResource(kind, city); resources.set(key, resource); }
  return resource;
}
