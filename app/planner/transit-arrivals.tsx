import { useEffect, useState } from "react";
import { stationArrivals, type TransitArrival } from "./transit";

export function ArrivalInfo({ city, node, route }: { city: string; node: string; route: string }) {
  const key = JSON.stringify([city, node, route]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; items: TransitArrival[]; checkedAt: string; error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.hidden || controller.signal.aborted) return;
      busy = true;
      try {
        const all = await stationArrivals(city, node);
        const items = all.filter(item => item.routeId === route);
        if (!controller.signal.aborted) setState({ key, items, checkedAt: items[0]?.checkedAt ?? new Date().toISOString(), error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, items: [], checkedAt: "", error: error instanceof Error ? error.message : "도착 정보를 불러오지 못했어요." });
      } finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [city, node, route, key, attempt]);
  const current = state?.key === key ? state : undefined;
  return <div className="db-arrivals" aria-label="버스 도착 정보" aria-live="polite">
    {!current ? <p>도착 정보를 불러오는 중이에요…</p> : current.error ? <><p>{current.error}</p><button type="button" className="db-text-action" onClick={() => setAttempt(value => value + 1)}>다시 조회</button></> : <>
      {current.items.length ? <div className="db-arrival-times">{current.items.slice(0, 2).map((item, index) => <div key={index}><strong>{item.seconds < 60 ? "곧 도착" : `${Math.ceil(item.seconds / 60)}분`}</strong><span>{item.stopsAway}정류장 전 · {item.vehicle}</span></div>)}</div> : <p>현재 제공되는 도착 정보가 없어요.</p>}
      <small>{new Date(current.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} 조회 · 30초마다 갱신</small>
    </>}
  </div>;
}
