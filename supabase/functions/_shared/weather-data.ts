export const cities = { 서울: [37.5665, 126.978], 부산: [35.18, 129.08], 인천: [37.46, 126.71], 대구: [35.87, 128.60], 대전: [36.35, 127.38], 광주: [35.16, 126.85], 울산: [35.54, 129.31], 제주: [33.50, 126.53] };
export type City = keyof typeof cities;
export type ForecastNotice = { label: string; hour: number; tomorrow: boolean; at: string };
export type Weather = { temp: number; code: number; humidity: number | null; high: number | null; low: number | null; time: string; outlook: ForecastNotice[] };
export type Air = { coarse: number | null; fine: number | null; time: string };

export function condition(code: number) {
  if (code <= 1) return "맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if ([45, 48].includes(code)) return "안개";
  if (code >= 95) return "뇌우";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈";
  if ([56, 57, 66, 67].includes(code)) return "어는 비";
  if ([51, 53, 55].includes(code)) return "이슬비";
  if ([80, 81, 82].includes(code)) return "소나기";
  if ([61, 63, 65].includes(code)) return "비";
  return "날씨 정보 없음";
}
function rounded(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}
export function dustLevel(value: number, fine: boolean) {
  const [good, moderate, poor] = fine ? [15, 35, 75] : [30, 80, 150];
  return value <= good ? "좋음" : value <= moderate ? "보통" : value <= poor ? "나쁨" : "매우 나쁨";
}
function nextWeather(times: string[], codes: number[], now: string): ForecastNotice[] {
  const next = times.findIndex(t => t > now);
  if (next < 0) return [];
  const notices: ForecastNotice[] = [];
  for (let i = next; i < Math.min(next + 6, times.length); i++) {
    const code = codes[i];
    if (!Number.isFinite(code) || code < 45) continue;
    const label = condition(code);
    if (label === "날씨 정보 없음" || notices.some(notice => notice.label === label)) continue;
    notices.push({ label, at: times[i], hour: Number(times[i].slice(11, 13)), tomorrow: times[i].slice(0, 10) !== now.slice(0, 10) });
  }
  return notices;
}

export type WeatherKind = "weather" | "air";
export type WeatherData = Weather | Air;
export const freshness = 15 * 60 * 1000;
export const maxAge = 6 * 60 * 60 * 1000;

export function weatherTime(time: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time) ? Date.parse(time + ":00+09:00") : NaN;
}
export function weatherAge(data: WeatherData, fetchedAt: number, now: number) {
  return now - Math.min(weatherTime(data.time), fetchedAt);
}
export function weatherStale(kind: WeatherKind, data: WeatherData, fetchedAt: number, now: number) {
  // Air estimates are hourly; weather estimates are updated every 15 minutes.
  return now - fetchedAt >= freshness || now - weatherTime(data.time) >= (kind === "air" ? 90 : 30) * 60000;
}
export function parseWeather(kind: "weather", raw: unknown): Weather;
export function parseWeather(kind: "air", raw: unknown): Air;
export function parseWeather(kind: WeatherKind, raw: unknown): WeatherData;
export function parseWeather(kind: WeatherKind, raw: unknown): WeatherData {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_RESPONSE");
  const obj = raw as Record<string, unknown>;
  const current = obj.current as Record<string, unknown> | undefined;
  if (!current || typeof current.time !== "string" || !Number.isFinite(weatherTime(current.time))) throw new Error("INVALID_RESPONSE");
  if (kind === "air") {
    const coarse = rounded(current.pm10), fine = rounded(current.pm2_5);
    if (coarse === null && fine === null) throw new Error("INVALID_RESPONSE");
    return { coarse, fine, time: current.time };
  }
  const temp = rounded(current.temperature_2m);
  if (temp === null || typeof current.weather_code !== "number" || !Number.isFinite(current.weather_code)) throw new Error("INVALID_RESPONSE");
  const daily = obj.daily as Record<string, unknown> | undefined;
  const hourly = obj.hourly as Record<string, unknown> | undefined;
  const times = Array.isArray(hourly?.time) && hourly.time.every(t => typeof t === "string") ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  return { temp, code: current.weather_code, humidity: rounded(current.relative_humidity_2m),
    high: rounded(Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max[0] : null),
    low: rounded(Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min[0] : null),
    time: current.time, outlook: nextWeather(times, codes, current.time) };
}
export function weatherURL(kind: WeatherKind, city: City) {
  const [lat, lon] = cities[city];
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), timezone: "Asia/Seoul" });
  if (kind === "air") {
    params.set("current", "pm10,pm2_5");
    return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
  }
  params.set("current", "temperature_2m,relative_humidity_2m,weather_code");
  params.set("hourly", "weather_code");
  params.set("daily", "temperature_2m_max,temperature_2m_min");
  params.set("forecast_days", "2");
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
