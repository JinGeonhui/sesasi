import { useSyncExternalStore } from "react";

export const weatherMetrics = { temperature: "온도", humidity: "습도", pm10: "미세먼지", pm25: "초미세먼지" };
export type WeatherMetric = keyof typeof weatherMetrics;
const keys = Object.keys(weatherMetrics) as WeatherMetric[];
const defaults: WeatherMetric[] = ["humidity", "temperature"];
export const weatherViews = {
  core: { label: "날씨 · 습도 · 온도", metrics: defaults },
  pm10: { label: "미세먼지도 보기", metrics: [...defaults, "pm10"] },
  pm25: { label: "초미세먼지도 보기", metrics: [...defaults, "pm25"] },
  all: { label: "모두 보기", metrics: keys },
} satisfies Record<string, { label: string; metrics: WeatherMetric[] }>;
export type WeatherView = keyof typeof weatherViews;
const defaultSnapshot = JSON.stringify(defaults);
const storageKey = "sesasi.weather.metrics.v1";
const changeEvent = "sesasi-weather-metrics-change";
let fallback = defaultSnapshot;
let memoryOnly = false;

function snapshot() {
  if (memoryOnly) return fallback;
  try { return localStorage.getItem(storageKey) ?? fallback; }
  catch { return fallback; }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) {
      fallback = defaultSnapshot;
      memoryOnly = false;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useWeatherMetrics() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => defaultSnapshot);
  let selected = defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) selected = keys.filter(key => defaults.includes(key) || parsed.includes(key));
  } catch { /* Keep the core information when the saved preference is invalid. */ }
  const view: WeatherView = selected.includes("pm10") ? selected.includes("pm25") ? "all" : "pm10" : selected.includes("pm25") ? "pm25" : "core";

  function selectView(next: WeatherView) {
    fallback = JSON.stringify(weatherViews[next].metrics);
    try { localStorage.setItem(storageKey, fallback); memoryOnly = false; }
    catch { memoryOnly = true; }
    window.dispatchEvent(new Event(changeEvent));
  }
  return { selected, view, selectView };
}
