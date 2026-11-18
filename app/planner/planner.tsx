"use client";

import Link from "next/link";
import CategoryManager from "./category-manager";
import { addCategory, categoryPrefix, categoryVersion, deleteCategory, readCategories, resolveCategory } from "./categories";
import { useEffect, useState } from "react";
import Calendar, { weekdays } from "./calendar";
import { compareTodos, todoCategory, uncategorized, type Todo, dateKey, formatDay, kindNames, localDate, onDay, prefix, readEntries, shift, type Entry, type Kind } from "./data";
import { EventAgenda, RoutesView, TodoList, TodosView } from "./entry-lists";
import EntryEditor from "./entry-editor";
import WeatherCard from "./weather";
import PlannerNavigation from "./navigation";
import FeatureLink from "./feature-link";
import { Icon } from "./icons";
import { DiscordMemoStatus } from "./discord-sync";

type Tab = "overview" | "history" | "categories" | Kind;
const tabs: Record<Tab, string> = { overview: "홈", event: "캘린더", todo: "할 일", route: "교통 노선", note: "작업 메모", history: "기록", categories: "카테고리 관리" };
const tabPaths: Record<Tab, string> = {
  overview: "/planner/",
  event: "/planner/calendar/",
  todo: "/planner/todos/",
  route: "/planner/routes/",
  note: "/planner/notes/",
  history: "/planner/settings/history/",
  categories: "/planner/settings/categories/",
};
function WeekPicker({ day, today, onSelect }: { day: string; today: string; onSelect: (day: string) => void }) {
  const date = localDate(day);
  const monday = shift(date, -((date.getDay() + 6) % 7));
  return <div className="db-week" role="group" aria-label="주간 날짜 선택">{weekdays.map((w, i) => {
    const item = shift(monday, i), key = dateKey(item);
    return <button key={w} aria-label={key} aria-current={key === today ? "date" : undefined} aria-pressed={key === day} onClick={() => onSelect(key)}>
      <span>{key === today ? "오늘" : w}</span><b>{item.getDate()}</b>
    </button>;
  })}</div>;
}

export default function Planner({ tab }: { tab: Tab }) {
  const [today, setToday] = useState("");
  const [selectedDay, setDay] = useState("");
  const day = tab === "overview" ? today : selectedDay;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editor, setEditor] = useState<{kind: Kind; entry?: Entry; after?: Todo} | null>(null);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState(new Map<string, string>());
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState("전체");
  const [eventFilter, setEventFilter] = useState("선택한 날짜");
  function loadPlanner() {
    const stored = readEntries();
    const nextCatalog = readCategories(stored);
    setCatalog(nextCatalog);
    setEntries(stored.map(entry => entry.kind === "todo" ? resolveCategory(entry, nextCatalog) : entry));
  }

  useEffect(() => {
    const updateDay = () => setToday(dateKey(new Date()));
    updateDay();
    setDay(dateKey(new Date()));
    const timer = setInterval(updateDay, 60000);
    const load = () => {
      try { loadPlanner(); setError(""); }
      catch { setError("저장된 항목을 불러오지 못했어요. 브라우저 저장소를 확인해 주세요."); }
    };
    const sync = (e: StorageEvent) => { if (!e.key || e.key.startsWith(prefix) || e.key.startsWith(categoryPrefix)) load(); };
    load();
    window.addEventListener("storage", sync);
    return () => { clearInterval(timer); window.removeEventListener("storage", sync); };
  }, []);

  function save(entry: Entry, remove = false, customCategory = false) {
    if (!remove && entry.kind === "todo") {
      const name = todoCategory(entry);
      if (name !== uncategorized) {
        let version = catalog.get(name);
        if (!version && customCategory) version = addCategory(name);
        if (!version || categoryVersion(name) !== version) throw new Error("카테고리가 변경됐어요. 다시 선택해 주세요.");
        entry = { ...entry, categoryVersion: version };
      }
    }
    if (remove) localStorage.removeItem(prefix + entry.id);
    else localStorage.setItem(prefix + entry.id, JSON.stringify(entry));
    loadPlanner();
    window.dispatchEvent(new Event("sesasi-planner-change"));
  }
  function toggle(entry: Entry) {
    if (entry.kind !== "todo") return;
    try { save({ ...entry, done: !entry.done }); }
    catch { setError("완료 상태를 저장하지 못했어요."); }
  }
  const events = entries.filter(e => e.kind === "event").sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const todos = entries.filter(e => e.kind === "todo").sort(compareTodos);
  const notes = entries.filter(e => e.kind === "note").sort((a,b) => b.date.localeCompare(a.date));
  const routes = entries.filter(e => e.kind === "route").sort((a,b) => a.title.localeCompare(b.title, "ko"));
  const pickedEvents = events.filter(e => onDay(e, day));
  const longEvents = events.filter(e => e.end > e.date);
  const addKind = tab === "history" || tab === "overview" || tab === "categories" ? null : tab;
  const edit = (entry: Entry) => setEditor({ kind: entry.kind, entry });
  const todoActions = { edit, toggle, insert: (after: Todo) => setEditor({ kind: "todo", after }) };
  const categories = [...catalog.keys()].sort((a,b) => a.localeCompare(b, "ko")).concat(uncategorized);

  const selectedCategory = tab === "todo" && categoryFilter && categories.includes(categoryFilter) ? categoryFilter : null;
  const categoryControls = { categories, selected: selectedCategory, onSelect: setCategoryFilter };
  const overview = tab === "overview";
  const history = tab === "history";
  const dayTodos = todos.filter(e => e.date === day);
  const heading = overview && day ? day.replaceAll("-", ".") : tabs[tab];

  return <div className="daybook">
    <PlannerNavigation active={history || tab === "categories" ? "settings" : "home"} />
    <main className="db-main">
      <header className="db-heading">
        <h1 className={overview ? "db-date-heading" : undefined}>{heading}</h1>
        {addKind && <button className="db-primary" disabled={!day} onClick={() => setEditor({ kind: addKind })}>{kindNames[addKind]} 추가</button>}
      </header>
      {error && <p className="db-error" role="alert">{error}</p>}
      {!day ? <p role="status">플래너를 여는 중…</p> : <>
        {(overview || history) && <div className={overview ? "db-overview" : "db-history"}>
          <div className="db-agenda">
            {history && <section className="db-history-picker" aria-label="기록 날짜 선택">
              <Link href="/planner/settings/" className="db-text-action">설정으로 돌아가기</Link>
              <div className="db-history-controls">
                <label>날짜<input type="date" value={day} onInput={e => { if (e.currentTarget.value) setDay(e.currentTarget.value); }} onChange={e => { if (e.target.value) setDay(e.target.value); }}/></label>
                <div><button className="db-text-action" onClick={() => setDay(dateKey(shift(localDate(day), -7)))}>이전 주</button>
                  <button className="db-text-action" onClick={() => setDay(today)}>오늘</button>
                  <button className="db-text-action" onClick={() => setDay(dateKey(shift(localDate(day), 7)))}>다음 주</button></div>
              </div>
              <WeekPicker day={day} today={today} onSelect={setDay}/>
              <p>{formatDay(day, { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</p>
            </section>}
            {history && <EventAgenda title="일정" day={day} events={pickedEvents} edit={edit}/>}
            <section className="db-list-panel" aria-label="메모"><div className="db-section-head">
              <h2>메모</h2><button className="db-memo-add" aria-label="메모 추가" title="메모 추가" onClick={() => setEditor({ kind: "todo" })}><Icon name="plus" size={22}/></button>
            </div><TodoList items={dayTodos} itemName="메모" compact {...todoActions}/><DiscordMemoStatus/></section>
          </div>
          {overview && <aside className="db-context" aria-label="날씨와 바로가기">
            <WeatherCard/>
            <nav className="db-shortcuts" aria-label="작업 바로가기">{(["event", "todo", "route", "note"] as const).map(k => <FeatureLink key={k} href={tabPaths[k]}
              icon={k === "event" ? "calendar" : k} title={tabs[k]}
              description={k === "event" ? `등록한 일정 ${events.length}개` : k === "todo" ? `남은 할 일 ${todos.filter(t => !t.done).length}개` : k === "route" ? `저장한 노선 ${routes.length}개` : `작성한 메모 ${notes.length}개`}/>)}</nav>
          </aside>}
        </div>}
        {tab === "event" && <><Calendar day={day} today={today} entries={events} onSelect={d => { setDay(d); setEventFilter("선택한 날짜"); }}/><div className="db-segments">{["선택한 날짜", "장기 일정"].map(f => <button key={f} aria-pressed={eventFilter === f} onClick={() => setEventFilter(f)}>{f}</button>)}</div><EventAgenda title={eventFilter === "장기 일정" ? "장기 일정" : "일정"} day={eventFilter === "장기 일정" ? undefined : day} events={eventFilter === "장기 일정" ? longEvents : pickedEvents} edit={edit} add={eventFilter === "장기 일정" ? undefined : () => setEditor({kind: "event"})}/></>}
        {tab === "categories" && <>
          <Link href="/planner/settings/" className="db-text-action db-category-back">설정으로 돌아가기</Link>
          <CategoryManager embedded categories={categories} todos={todos}
            onAdd={name => { addCategory(name); loadPlanner(); }}
            onDelete={name => {
              const version = catalog.get(name);
              if (!version) throw new Error();
              deleteCategory(name, version);
              loadPlanner();
            }}/>
        </>}
        {tab === "todo" && <TodosView items={todos} {...categoryControls} {...todoActions}/>}
        {tab === "route" && <RoutesView routes={routes} edit={edit} mode={routeMode} setMode={setRouteMode}/>}
        {tab === "note" && <section className="db-list-panel" aria-label="작업 기록">{notes.length ? <ul className="db-list">{notes.map(note =>
          <li key={note.id}><button className="db-entry" onClick={() => edit(note)}><strong>{note.title}</strong><small>{note.date}</small>{note.body && <p>{note.body}</p>}</button></li>
        )}</ul> : <p className="db-empty">첫 작업 메모를 남겨 보세요.</p>}</section>}
      </>}
    </main>
    {editor && <EntryEditor kind={editor.kind} kindLabel={(overview || history) && editor.kind === "todo" ? "메모" : undefined} longTerm={tab === "event" && eventFilter === "장기 일정"} day={editor.after?.date ?? day} after={editor.after} categories={categories} selectedCategory={selectedCategory} routeMode={routeMode === "지하철" ? "지하철" : "버스"} entry={editor.entry} onClose={() => setEditor(null)} onChange={(entry, remove, customCategory) => {
      save(entry, remove, customCategory);
      if (!remove && entry.kind === "todo" && selectedCategory) setCategoryFilter(todoCategory(entry));
      if (!remove && entry.kind === "route" && routeMode !== "전체") setRouteMode(entry.mode);
      if (!remove && entry.kind === "event" && tab === "event") setDay(entry.date);
    }}/>}
  </div>;
}
