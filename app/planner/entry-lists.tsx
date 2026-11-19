import { useState } from "react";
import { ArrivalInfo } from "./transit-arrivals";
import { eventHours, todoCategory, type CalendarEvent, type Todo, type TransitRoute } from "./data";
import { memoRows } from "./discord-format";

type TodoActions = { edit: (todo: Todo) => void; insert: (todo: Todo) => void; toggle: (todo: Todo) => void; remove: (todo: Todo) => void };
export function TodoList({ items, compact, itemName = "할 일", edit, insert, toggle, remove }: TodoActions & { items: Todo[]; compact?: boolean; itemName?: string }) {
  if (!items.length) return <p className="db-empty">표시할 {itemName === "메모" ? "메모가" : "할 일이"} 없어요.</p>;
  const rows = memoRows(items);
  if (itemName === "메모") return <ul className="db-list db-todos">{rows.map(({ todo, marker }) =>
    <li key={todo.id} className="db-memo-row">
      <span className="db-memo-marker">{marker}</span>
      <span className="db-category-label">{todo.done ? <s>[{todoCategory(todo)}]</s> : <>[{todoCategory(todo)}]</>}</span>
      <button className="db-entry" onClick={() => edit(todo)}>
        <strong className={todo.done ? "done" : ""}>{todo.done ? <s>{todo.title}</s> : todo.title}</strong>
      </button>
      <label className="db-memo-complete">
        <input type="checkbox" checked={todo.done} aria-label={`${todo.title} 완료`} onChange={() => toggle(todo)}/>
      </label>
      <button type="button" className="db-memo-delete" aria-label={`${todo.title} 메모 삭제`} onClick={() => remove(todo)}>삭제</button>
    </li>
  )}</ul>;
  return <ul className="db-list db-todos">{rows.map(({ todo, marker }) =>
    <li key={todo.id} className={todo.inserted ? "db-inserted" : undefined}>
      <input type="checkbox" checked={todo.done} aria-label={`${todo.title} 완료`} onChange={() => toggle(todo)}/>
      <button className="db-entry" onClick={() => edit(todo)}>
        <strong><span className="db-memo-marker">{marker} </span><span className={todo.done ? "done" : ""}>{todo.done ? <s>{todo.title}</s> : todo.title}</span></strong>
        <span className="db-todo-meta"><span className="db-category-label">{todo.done ? <s>[{todoCategory(todo)}]</s> : <>[{todoCategory(todo)}]</>}</span>
          {(!compact || todo.inserted) && <small>{[!compact && todo.date, todo.inserted && "끼워 넣은 할 일"].filter(Boolean).join(" · ")}</small>}
        </span>
      </button>
      <button className="db-insert-action" aria-label={`${todo.title} 아래에 ${itemName} 추가`} onClick={() => insert(todo)}>아래에 추가</button>
      <button type="button" className="db-memo-delete" aria-label={`${todo.title} 할 일 삭제`} onClick={() => remove(todo)}>삭제</button>
    </li>
  )}</ul>;
}

export function CategoryFilter({ categories, selected, onSelect }: {
  categories: string[]; selected: string | null; onSelect: (name: string | null) => void;
}) {
  return <div className="db-category-filter" role="group" aria-label="카테고리">
    <div className="db-category-heading"><strong>카테고리</strong></div>
    <div className="db-category-options">
      <button aria-pressed={selected === null} onClick={() => onSelect(null)}>전체 카테고리</button>
      {categories.map(name => <button key={name} aria-pressed={selected === name} onClick={() => onSelect(name)}>{name}</button>)}
    </div>
  </div>;
}

export function TodosView({ items, categories, selected, onSelect, ...actions }: TodoActions & {
  items: Todo[]; categories: string[]; selected: string | null; onSelect: (name: string | null) => void;
}) {
  const [status, setStatus] = useState("전체");
  const [grouped, setGrouped] = useState(true);
  const shown = items.filter(todo => (!selected || todoCategory(todo) === selected) && (status === "전체" || todo.done === (status === "완료")));
  const groups = [...new Set(shown.map(todoCategory))].sort((a,b) => a.localeCompare(b, "ko"));
  return <section aria-label="할 일 목록" className="db-list-panel">
    <CategoryFilter categories={categories} selected={selected} onSelect={onSelect}/>
    <div className="db-list-tools"><div className="db-segments">{["전체", "미완료", "완료"].map(s =>
      <button key={s} aria-pressed={s === status} onClick={() => setStatus(s)}>{s}</button>)}</div>
      <label><select aria-label="할 일 보기 방식" value={grouped ? "category" : "date"} onChange={e => setGrouped(e.target.value === "category")}>
        <option value="date">날짜순 보기</option><option value="category">카테고리별 보기</option>
      </select></label>
    </div>
    {grouped && shown.length > 0 ? groups.map(cat => <section className="db-todo-group" key={cat}>
      <h2>{cat}</h2><TodoList items={shown.filter(t => todoCategory(t) === cat)} {...actions}/>
    </section>) : <TodoList items={shown} {...actions}/>}
  </section>;
}

export function EventAgenda({ title, events, day, edit, add }: {
  title: string; events: CalendarEvent[]; day?: string; edit: (event: CalendarEvent) => void; add?: () => void;
}) {
  const timed = events.filter(e => eventHours(e, day) !== "종일");
  if (day) timed.sort((a,b) => (a.date < day ? "" : a.time).localeCompare(b.date < day ? "" : b.time));
  const groups = day ? [
    { title: "종일", rows: events.filter(e => eventHours(e, day) === "종일") },
    { title: "시간별", rows: timed },
  ] : [{ title: "", rows: events }];
  return <section className="db-list-panel" aria-label={title}>
    <div className="db-section-head"><h2>{title}</h2>{add && <button className="db-text-action" onClick={add}>이 날짜에 추가</button>}</div>
    {!events.length && <p className="db-empty">등록된 일정이 없어요.</p>}
    {groups.filter(g => g.rows.length).map(group => <div key={group.title}>
      {group.title && <h3 className="db-agenda-label">{group.title}</h3>}
      <ul className="db-list">{group.rows.map(e => <li key={e.id}>
        {group.title !== "종일" && <span className="db-time">{eventHours(e, day)}</span>}
        <button className="db-entry" onClick={() => edit(e)}><strong>{e.title}</strong>
          {e.date !== e.end && <small>{e.date} ~ {e.end}</small>}
        </button>
      </li>)}</ul>
    </div>)}
  </section>;
}

export function RoutesView({ routes, edit, mode, setMode }: {
  routes: TransitRoute[]; edit: (route: TransitRoute) => void;
  mode: string; setMode: (mode: string) => void;
}) {
  const shown = routes.filter(r => mode === "전체" || r.mode === mode);
  return <section aria-label="자주 타는 노선" className="db-list-panel">
    <div className="db-segments">{["전체", "버스", "지하철"].map(m =>
      <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>)}</div>
    {shown.length ? <><p className="db-route-hint">승하차 지점을 누르면 카카오맵에서 열려요.</p><div className="db-route-grid">{shown.map(route => <article key={route.id} className="db-route-card">
      <div className="db-section-head"><span className={`db-mode ${route.mode === "버스" ? "bus" : "rail"}`}>{route.mode}</span>
        <button className="db-text-action" aria-label={`${route.title} 수정`} onClick={() => edit(route)}>수정</button></div>
      <h2>{route.title}</h2>{route.transit?.cityName && <p className="db-route-alias">{route.transit.cityName}</p>}{route.alias && <p className="db-route-alias">{route.alias}</p>}
      <dl className="db-stops">{[["승차", route.from], ["하차", route.to]].map(([label, stop]) =>
        <div key={label}><dt>{label}</dt><dd><a href={`https://map.kakao.com/link/search/${encodeURIComponent(stop)}`} target="_blank" rel="noreferrer" aria-label={`${stop} 카카오맵에서 보기`}>{stop}</a></dd></div>)}</dl>
      {route.mode === "버스" && route.transit?.cityCode ? <ArrivalInfo city={route.transit.cityCode} node={route.transit.fromId} route={route.transit.routeId}/> : <p className="db-field-hint">{route.mode === "지하철" ? "지하철 실시간 도착 정보는 아직 연결되지 않았어요." : "노선을 다시 선택하면 도착 정보를 확인할 수 있어요."}</p>}
    </article>)}</div></> : <p className="db-empty">저장한 {mode === "전체" ? "교통" : mode} 노선이 없어요.</p>}
  </section>;
}
