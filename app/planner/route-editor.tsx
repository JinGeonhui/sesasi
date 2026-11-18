import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TransitRoute } from "./data";
import { Icon } from "./icons";
import { useTransit } from "./use-transit";
import { ArrivalInfo } from "./transit-arrivals";
import { transitPick, type TransitCity, type TransitLine, type TransitSelection, type TransitStation, type TransitConnection } from "./transit";

type LoadState = { error: string; loading: boolean; retry: () => void };
function LoadMessage({ state }: { state: LoadState }) {
  if (state.loading) return <p role="status" className="db-field-hint">교통정보를 불러오는 중이에요…</p>;
  if (state.error) return <div className="db-transit-error"><p role="alert">{state.error}</p><button type="button" className="db-text-action" onClick={state.retry}>다시 시도</button></div>;
  return null;
}
type Pick = { title: string; from: string; to: string; transit: TransitSelection };
type PickerProps = { onPick: (value: Pick | null) => void };

function BusPicker({ onPick }: PickerProps) {
  const cities = useTransit<TransitCity>("cities", {});
  const [cityId, setCity] = useState("");
  const city = cities.items.find(item => item.id === cityId) ?? cities.items.find(item => item.name === "광주광역시") ?? cities.items[0];
  return <><LoadMessage state={cities}/>{!cities.loading && !cities.error && (city ? <>
    <label>지역<select value={city.id} onChange={e => { setCity(e.target.value); onPick(null); }}>{cities.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <BusJourney key={city.id} city={city} onPick={onPick}/>
  </> : <p role="status" className="db-field-hint">검색 가능한 지역이 아직 없어요.</p>)}</>;
}
function StationSearch({ label, city, selected, onSelect }: { label: string; city: TransitCity; selected: TransitStation | null; onSelect: (station: TransitStation | null) => void }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const state = useTransit<TransitStation>("stations", { city: city.id, q: search }, Boolean(search) && !selected);
  function run() {
    if (!query.trim()) return;
    if (search === query.trim()) state.retry();
    setSearch(query.trim());
  }
  return <section className="db-station-search" aria-label={label}>
    {selected ? <div className="db-transit-selected"><div><small>{label}</small><strong>{selected.name}</strong><small>정류장 번호 {selected.number || selected.id}</small></div><button type="button" className="db-text-action" onClick={() => onSelect(null)}>변경</button></div> : <>
      <label>{label}<div className="db-transit-search"><input aria-label={label} value={query} maxLength={30} placeholder="정류장 이름 또는 번호" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); run(); } }}/><button type="button" className="db-primary" aria-label={`${label} 검색`} disabled={!query.trim()} onClick={run}>검색</button></div></label>
      <LoadMessage state={state}/>
      {search && !state.loading && !state.error && <div className="db-transit-results" aria-label={`${label} 검색 결과`}>
        <p className="db-field-hint" role="status">{state.items.length ? "같은 이름의 정류장은 번호로 구분해 주세요." : "일치하는 정류장이 없어요. 이름이나 번호를 확인해 주세요."}</p>
        {state.items.map(item => <button type="button" className="db-transit-result" key={item.id} onClick={() => onSelect(item)}><strong>{item.name}</strong><span>정류장 번호 {item.number || item.id}</span></button>)}
      </div>}
    </>}
  </section>;
}
function BusJourney({ city, onPick }: PickerProps & { city: TransitCity }) {
  const [from, setFrom] = useState<TransitStation | null>(null);
  const [to, setTo] = useState<TransitStation | null>(null);
  const [selected, setSelected] = useState("");
  const state = useTransit<TransitConnection>("connections", { city: city.id, from: from?.id ?? "", to: to?.id ?? "" }, Boolean(from && to && from.id !== to.id));
  function change(which: "from" | "to", value: TransitStation | null) {
    if (which === "from") setFrom(value); else setTo(value);
    setSelected(""); onPick(null);
  }
  return <>
    <p className="db-field-hint">자주 다니는 구간을 선택하면 탈 수 있는 버스를 찾아드려요.</p>
    <StationSearch label="승차 정류장" city={city} selected={from} onSelect={value => change("from", value)}/>
    <StationSearch label="하차 정류장" city={city} selected={to} onSelect={value => change("to", value)}/>
    {from && to && from.id === to.id && <p role="status" className="db-field-hint">서로 다른 정류장을 선택해 주세요.</p>}
    <LoadMessage state={state}/>
    {from && to && from.id !== to.id && !state.loading && !state.error && <section aria-label="이 구간의 버스" className="db-transit-results">
      <p role="status" className="db-field-hint">{state.items.length ? `${state.items.length}개 구간 · 저장할 버스를 선택하세요` : "선택한 방향으로 한 번에 가는 버스가 없어요. 맞은편 정류장을 선택했는지 확인해 주세요."}</p>
      {state.items.map(item => <div key={item.key} className="db-connection"><button type="button" className="db-transit-result" aria-pressed={selected === item.key} onClick={() => { setSelected(item.key); onPick(transitPick(item, [item.from, item.to], item.from.key, item.to.key, true, city)); }}>
        <strong>{item.name}</strong><span>{item.type} · {item.next} 방면</span><span>{item.from.name} → {item.to.name}</span>
      </button><ArrivalInfo city={city.id} node={from.id} route={item.id}/></div>)}
    </section>}
    <p className="db-field-hint">환승 없는 버스 구간을 검색해요.</p>
  </>;
}
function RailStationSearch({ label, lines, selected, onSelect }: { label: string; lines: TransitLine[]; selected: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const stations = lines.flatMap(line => (line.stops ?? []).map(stop => ({ ...stop, line: line.name })));
  const chosen = stations.find(stop => stop.id === selected);
  const matches = stations.filter(stop => query.trim() && stop.name.includes(query.trim()));
  return <section className="db-station-search" aria-label={label}>{chosen ? <div className="db-transit-selected"><div><small>{label}</small><strong>{chosen.name}</strong><small>{chosen.line}</small></div><button type="button" className="db-text-action" onClick={() => onSelect("")}>변경</button></div> : <>
    <label>{label}<input aria-label={label} value={query} maxLength={40} placeholder="역 이름을 입력하세요" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}/></label>
    {query.trim() && <div className="db-transit-results" aria-label={`${label} 검색 결과`}>{!matches.length && <p className="db-field-hint">일치하는 역이 없어요.</p>}{matches.map(stop => <button type="button" className="db-transit-result" key={stop.id} onClick={() => onSelect(stop.id)}><strong>{stop.name}</strong><span>{stop.line}</span></button>)}</div>}
  </>}</section>;
}
function RailPicker({ onPick }: PickerProps) {
  const state = useTransit<TransitLine>("rail", {});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState("");
  const matches = from && to && from !== to ? state.items.filter(line => line.stops?.some(stop => stop.id === from) && line.stops.some(stop => stop.id === to)) : [];
  function change(which: "from" | "to", id: string) {
    if (which === "from") setFrom(id); else setTo(id);
    setSelected(""); onPick(null);
  }
  return <><LoadMessage state={state}/>{!state.loading && !state.error && <>
    <RailStationSearch label="승차역" lines={state.items} selected={from} onSelect={id => change("from", id)}/>
    <RailStationSearch label="하차역" lines={state.items} selected={to} onSelect={id => change("to", id)}/>
    {from && to && <section className="db-transit-results" aria-label="이 구간의 지하철"><p className="db-field-hint" role="status">{from === to ? "서로 다른 역을 선택해 주세요." : matches.length ? "저장할 노선을 선택하세요." : "선택한 역의 호선이 달라요. 현재는 같은 노선의 구간만 저장할 수 있어요."}</p>
      {matches.map(line => <button type="button" className="db-transit-result" key={line.id} aria-pressed={selected === line.id} onClick={() => { setSelected(line.id); onPick(transitPick(line, line.stops ?? [], from, to, false)); }}><strong>{line.name}</strong><span>{line.stops?.find(stop => stop.id === from)?.name} → {line.stops?.find(stop => stop.id === to)?.name}</span></button>)}
    </section>}
    <p className="db-field-hint">현재 지하철은 역·노선 정보만 제공해요. 실시간 도착 정보는 아직 연결되지 않았어요.</p>
  </>}</>;
}

export default function RouteEditor({ entry, initialMode, onClose, onChange }: {
  entry?: TransitRoute; initialMode: "버스" | "지하철"; onClose: () => void; onChange: (entry: TransitRoute, remove?: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState(entry?.mode ?? initialMode);
  const [replacing, setReplacing] = useState(!entry);
  const [pick, setPick] = useState<Pick | null>(null);
  const [alias, setAlias] = useState(entry?.alias ?? "");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  function commit(value: TransitRoute, remove = false) {
    try { onChange(value, remove); onClose(); }
    catch { setError("저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요."); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!replacing && entry) { commit({ ...entry, alias: alias.trim() }); return; }
    if (!pick) { setError("노선과 승하차 지점을 목록에서 선택해 주세요."); return; }
    commit({ id: entry?.id ?? crypto.randomUUID(), kind: "route", mode, alias: alias.trim(), ...pick });
  }
  return <dialog className="db-dialog db-transit-dialog" ref={dialog} aria-labelledby="db-route-editor-title" onCancel={onClose}>
    <header><h2 id="db-route-editor-title">교통 노선 {entry ? "수정" : "추가"}</h2><button type="button" aria-label="닫기" onClick={onClose}><Icon name="close"/></button></header>
    <form onSubmit={submit}>
      {!replacing && entry ? <div className="db-transit-selected"><div><strong>{entry.title}</strong><small>{entry.from} → {entry.to}</small></div><button className="db-text-action" type="button" onClick={() => setReplacing(true)}>노선 변경</button></div> : <>
        <div className="db-segments" role="group" aria-label="교통수단">{(["버스", "지하철"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { if (value !== mode) { setMode(value); setPick(null); setError(""); } }}>{value}</button>)}</div>
        {mode === "버스" ? <BusPicker onPick={setPick}/> : <RailPicker onPick={setPick}/>}
        {entry && <button type="button" className="db-text-action" onClick={() => { setReplacing(false); setPick(null); setMode(entry.mode); setError(""); }}>기존 노선 유지</button>}
      </>}
      <label>별칭 <small>선택</small><input maxLength={50} value={alias} onChange={e => setAlias(e.target.value)} placeholder="예: 아침 출근길"/></label>
      {pick && <p className="db-transit-summary" aria-live="polite">{pick.title} · {pick.from} → {pick.to}</p>}
      {error && <p role="alert" className="db-error">{error}</p>}
      {confirmDelete ? <footer><span>삭제할까요?</span><button type="button" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" className="db-danger" onClick={() => entry && commit(entry, true)}>삭제하기</button></footer> :
        <footer>{entry && <button type="button" className="db-delete" onClick={() => setConfirmDelete(true)}>삭제</button>}<button type="button" onClick={onClose}>취소</button><button className="db-primary" type="submit" disabled={replacing && !pick}>저장</button></footer>}
      <p className="db-transit-source">교통정보: <a href={mode === "버스" ? "https://www.data.go.kr/data/15098529/openapi.do" : "https://www.data.go.kr/data/15098554/openapi.do"} target="_blank" rel="noreferrer">국토교통부 TAGO</a> · 제공 지역과 노선 기준</p>
    </form>
  </dialog>;
}
