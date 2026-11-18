import { cities, freshness, parseWeather, weatherAge, weatherTime, weatherURL, type City, type WeatherKind } from "./weather-data.ts";

export class WeatherProviderError extends Error {
  code: string; retryAfter: number;
  constructor(code: string, retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
export function createWeatherProvider(fetchImpl = fetch, now = Date.now) {
  type Payload = { body: unknown; fetchedAt: number };
  const cache = new Map<string, Payload>(), pending = new Map<string, Promise<Payload>>();
  async function read(kind: string, city: string) {
    if (!["weather", "air"].includes(kind) || !Object.hasOwn(cities, city)) throw new WeatherProviderError("INVALID_REQUEST");
    const key = `${kind}:${city}`;
    const saved = cache.get(key);
    if (saved && now() - saved.fetchedAt < freshness) return saved;
    if (pending.has(key)) return pending.get(key)!;
    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetchImpl(weatherURL(kind as WeatherKind, city as City), { signal: controller.signal });
        if (response.status === 429) {
          const value = response.headers.get("retry-after");
          const seconds = value ? /^\d+(\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - now()) / 1000 : 60;
          throw new WeatherProviderError("WEATHER_RATE_LIMITED", Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 60);
        }
        if (!response.ok) throw new WeatherProviderError("WEATHER_UNAVAILABLE");
        const body = await response.json();
        const data = parseWeather(kind as WeatherKind, body);
        if (weatherTime(data.time) > now() + 15 * 60000 || weatherAge(data, now(), now()) >= 6 * 60 * 60000) throw new WeatherProviderError("WEATHER_UNAVAILABLE");
        const result = { body, fetchedAt: now() };
        cache.set(key, result);
        return result;
      } catch (error) {
        if (error instanceof WeatherProviderError) throw error;
        throw new WeatherProviderError(controller.signal.aborted ? "WEATHER_TIMEOUT" : "WEATHER_UNAVAILABLE");
      } finally { clearTimeout(timer); pending.delete(key); }
    })();
    pending.set(key, task);
    return task;
  }
  return { read };
}
