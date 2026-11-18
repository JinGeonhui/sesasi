import { useSyncExternalStore } from "react";
import { useWeatherMetrics, weatherMetrics, weatherViews, type WeatherMetric, type WeatherView } from "./weather-preferences";
import { cities, condition, dustLevel, weatherTime, type City } from "./weather-data";
import { getServerWeather, weatherResource, type WeatherSnapshot } from "./weather-resource";

const cityKey = "sesasi.weather.city", cityEvent = "sesasi-weather-city-change";
let fallbackCity: City = "광주", memoryOnly = false;
function citySnapshot(): City {
  if (memoryOnly) return fallbackCity;
  try {
    const saved = localStorage.getItem(cityKey);
    return saved && Object.hasOwn(cities, saved) ? saved as City : fallbackCity;
  } catch { return fallbackCity; }
}
function subscribeCity(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === cityKey) { fallbackCity = "광주"; memoryOnly = false; listener(); } };
  window.addEventListener("storage", onStorage);
  window.addEventListener(cityEvent, listener);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(cityEvent, listener); };
}
function selectCity(city: City) {
  fallbackCity = city;
  try { localStorage.setItem(cityKey, city); memoryOnly = false; } catch { memoryOnly = true; }
  window.dispatchEvent(new Event(cityEvent));
}
function emptyStatus(state: WeatherSnapshot) {
  if (state.data) return "제공되지 않음";
  if (state.error === "auth") return "개인 계정 로그인 필요";
  if (state.pending) return state.slow ? "연결이 늦어지고 있어요" : "불러오는 중";
  return state.error === "timeout" ? "날씨 연결 지연" : "정보를 불러오지 못했어요";
}
function statusMessage(state: WeatherSnapshot) {
  if (state.error === "auth") return "설정에서 개인 계정으로 로그인해 주세요";
  const prefix = state.data ? "이전 정보 표시 중 · " : "";
  if (state.pending) return state.data ? `${prefix}최신 정보 갱신 중` : state.slow ? "응답을 기다리고 있어요" : "";
  if (state.error) {
    const reason = { timeout: "응답 지연", network: "연결 실패", "rate-limit": "요청이 많아 잠시 대기", server: "조회 실패", invalid: "응답 확인 실패" }[state.error];
    return `${prefix}${reason} · 자동으로 다시 시도합니다`;
  }
  return state.stale ? "이전 정보 표시 중 · 기준 시각을 확인해 주세요" : "";
}
function readingTime(time: string) { return `${time.slice(5, 7)}/${time.slice(8, 10)} ${time.slice(11, 16)}`; }

export default function WeatherCard() {
  const { selected, view, selectView } = useWeatherMetrics();
  const city = useSyncExternalStore(subscribeCity, citySnapshot, () => "광주" as City);
  const weatherFeed = weatherResource("weather", city), airFeed = weatherResource("air", city);
  const weather = useSyncExternalStore(weatherFeed.subscribe, weatherFeed.getSnapshot, getServerWeather);
  const air = useSyncExternalStore(airFeed.subscribe, airFeed.getSnapshot, getServerWeather);
  const w = weather.data && "temp" in weather.data ? weather.data : null;
  const a = air.data && "coarse" in air.data ? air.data : null;
  const showAir = selected.includes("pm10") || selected.includes("pm25");
  const outlook = w && !weather.stale && !weather.error ? w.outlook.filter(notice => {
    const ahead = weatherTime(notice.at) - weather.fetchedAt;
    return ahead > 0 && ahead <= 6 * 60 * 60 * 1000;
  }) : [];
  const weatherStatus = emptyStatus(weather), airStatus = emptyStatus(air);
  const metrics: { key: WeatherMetric; value: number | null; unit: string; detail: string }[] = [
    { key: "humidity", value: w?.humidity ?? null, unit: "%", detail: w?.humidity != null ? "상대 습도" : weatherStatus },
    { key: "temperature", value: w?.temp ?? null, unit: "°", detail: w ? "현재 기온" : weatherStatus },
    { key: "pm10", value: a?.coarse ?? null, unit: "µg/m³", detail: a?.coarse != null ? dustLevel(a.coarse, false) : airStatus },
    { key: "pm25", value: a?.fine ?? null, unit: "µg/m³", detail: a?.fine != null ? dustLevel(a.fine, true) : airStatus },
  ];
  return <section className="db-weather" aria-label="현재 날씨">
    <div className="db-section-head"><h2>현재 날씨</h2><select className="db-city-select" aria-label="날씨 지역" value={city} onChange={e => {
      const next = e.target.value as City;
      selectCity(next);
    }}>{Object.keys(cities).map(name => <option key={name}>{name}</option>)}</select></div>
    <label className="db-weather-options">표시 항목
      <select value={view} onChange={e => selectView(e.target.value as WeatherView)}>
        {(Object.keys(weatherViews) as WeatherView[]).map(key => <option key={key} value={key}>{weatherViews[key].label}</option>)}
      </select>
    </label>
    <div className="db-weather-condition" aria-live="polite">
      <strong>{w ? condition(w.code) : weatherStatus}</strong>
    </div>
    <dl className="db-weather-metrics" aria-live="polite">
      {outlook.map(notice => <div key={notice.label} className="db-weather-forecast">
        <dt>{notice.label}</dt><dd><strong>{notice.hour}</strong><span className="db-weather-unit">시</span>
          <small>{notice.at.slice(0, 10) !== w?.time.slice(0, 10) ? "내일" : "오늘"} 예상 · 6시간 이내</small>
        </dd>
      </div>)}
      {metrics.filter(metric => selected.includes(metric.key)).map(metric =>
      <div key={metric.key} className={metric.key === "humidity" ? "db-weather-humidity" : undefined}><dt>{weatherMetrics[metric.key]}</dt><dd>
        <strong>{metric.value ?? "—"}</strong><span className={metric.key === "temperature" || metric.key === "humidity" ? "db-weather-unit" : "db-weather-unit db-weather-dust-unit"}>{metric.unit}</span>
        <small>{metric.detail}</small>
      </dd></div>
    )}</dl>
    {w && <p className="db-range">최고 {w.high ?? "–"}° · 최저 {w.low ?? "–"}°</p>}
    <div className="db-weather-status" role="status">
      {statusMessage(weather) && <p>날씨 · {statusMessage(weather)}</p>}
      {showAir && statusMessage(air) && <p>대기질 · {statusMessage(air)}</p>}
    </div>
    <div className="db-weather-foot"><small>{[w && `날씨 ${readingTime(w.time)}`, showAir && a && `대기질 ${readingTime(a.time)}`].filter(Boolean).join(" · ")}{(w || (showAir && a)) && " 기준"}</small>
      {(weather.error || (showAir && air.error)) && <button disabled={weather.pending && (!showAir || air.pending)} onClick={() => { void weatherFeed.refresh(); if (showAir) void airFeed.refresh(); }}>다시 불러오기</button>}
    </div>
    <p className="db-sources"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">CAMS</a></p>
  </section>;
}
