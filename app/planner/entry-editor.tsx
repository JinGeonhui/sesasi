import { useEffect, useRef, useState, type FormEvent } from "react";
import { dateKey, localDate, shift, kindNames, newTodoOrder, todoOrder, todoCategory, uncategorized, type Todo, type Entry, type Kind } from "./data";
import { Icon } from "./icons";
import RouteEditor from "./route-editor";
import { memoCreatedOn, memoDay, memoType, type MemoType } from "./discord-format";

type Props = {
  kind: Kind;
  kindLabel?: string;
  day: string;
  longTerm: boolean;
  entry?: Entry;
  after?: Todo;
  categories: string[];
  selectedCategory: string | null;
  routeMode: "버스" | "지하철";
  onClose: () => void;
  onChange: (entry: Entry, remove?: boolean, customCategory?: boolean) => Promise<void>;
};

export default function EntryEditor(props: Props) {
  if (props.kind === "route") return <RouteEditor entry={props.entry?.kind === "route" ? props.entry : undefined} initialMode={props.routeMode} onClose={props.onClose} onChange={props.onChange}/>;
  return <GeneralEntryEditor {...props}/>;
}

function GeneralEntryEditor({ kind, kindLabel, day, longTerm, entry, after, categories, selectedCategory, onClose, onChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(entry && "date" in entry ? entry.date : day);
  const event = entry?.kind === "event" ? entry : undefined;
  const todo = entry?.kind === "todo" ? entry : undefined;
  const sourceTodo = todo ?? after;
  const [chosenMemoType, setChosenMemoType] = useState<MemoType | null>(todo?.memoType ?? null);
  const createdOn = todo ? memoCreatedOn(todo) : memoDay();
  const effectiveMemoType = chosenMemoType ?? memoType({ date, createdOn });
  const [category, setCategory] = useState<string | null>(sourceTodo ? todoCategory(sourceTodo) : selectedCategory ?? uncategorized);
  const [allDay, setAllDay] = useState(!event?.time);
  const multiDay = longTerm && kind === "event" && !entry;
  const minEnd = (start: string) => multiDay && start ? dateKey(shift(localDate(start), 1)) : start;
  const [end, setEnd] = useState(entry?.kind === "event" ? entry.end : minEnd(day));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  async function commit(value: Entry, remove = false) {
    if (busy) return;
    setBusy(true);
    try {
      await onChange(value, remove, kind === "todo" && category === null);
      onClose();
    } catch (err) {
      if (err instanceof Error && !(err instanceof DOMException)) { setError(err.message); return; }
      setError("저장하지 못했어요. 서버 연결을 확인하고 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const title = field("title");
    if (!title) { setError("제목을 입력해 주세요."); return; }
    const base = { id: entry?.id ?? crypto.randomUUID(), title };
    switch (kind) {
      case "event": {
        const startTime = field("startTime");
        const endTime = allDay ? "" : field("endTime");
        if (!allDay && date === end && endTime && endTime <= startTime) {
          setError("같은 날에는 종료 시간을 시작 시간보다 늦게 선택해 주세요.");
          return;
        }
        commit({ ...base, kind, date, end, time: allDay ? "" : startTime, endTime });
        break;
      }
      case "todo": {
        const name = category ?? field("customCategory");
        if (!name) { setError("새 카테고리 이름을 입력해 주세요."); return; }
        commit({
        ...base, kind, date, done: effectiveMemoType === "planned" && todo && memoType(todo) === "planned" ? todo.done : false,
        memoType: effectiveMemoType,
        category: name,
        order: todo ? todoOrder(todo) : newTodoOrder(base.id, after),
        inserted: todo?.inserted ?? Boolean(after),
        createdOn,
        });
        break;
      }
      case "note": commit({ ...base, kind, date, body: field("body") }); break;
    }
  }

  return <dialog className="db-dialog" ref={dialog} aria-labelledby="db-editor-name" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <header><h2 id="db-editor-name">{kindLabel ?? kindNames[kind]} {entry ? "수정" : after ? "끼워 넣기" : "추가"}</h2><button aria-label="닫기" onClick={onClose} disabled={busy}><Icon name="close"/></button></header>
    <form onSubmit={submit}><fieldset disabled={busy} className="db-saving-fields">
      {after && <p className="db-field-hint">‘{after.title}’ 다음에 추가해요.</p>}
      <label>제목<input name="title" required maxLength={120} autoFocus defaultValue={entry?.title} placeholder="제목 입력"/></label>
      {kind !== "route" && <div className="db-fields"><label>{kind === "event" ? "시작일" : "날짜"}<input type="date" required readOnly={Boolean(after)} value={date} onChange={e => { setDate(e.target.value); if (end === date || end < minEnd(e.target.value)) setEnd(minEnd(e.target.value)); }}/></label>
        {kind === "event" && <label>종료일<input type="date" required value={end} min={minEnd(date)} onChange={e => setEnd(e.target.value)}/></label>}</div>}
      {kind === "event" && <>
        <label className="db-all-day"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)}/>하루 종일</label>
        {!allDay && <div className="db-fields"><label>시작 시간<input type="time" name="startTime" required defaultValue={event?.time || "09:00"}/></label>
          <label>종료 시간<input type="time" name="endTime" required={!event?.time || Boolean(event.endTime)} defaultValue={event?.time ? event.endTime ?? "" : "10:00"}/></label></div>}
      </>}
      {kind === "todo" && <fieldset className="db-category-field">
        <legend>메모 유형</legend>
        <div className="db-category-options">
          <button type="button" aria-pressed={effectiveMemoType === "planned"} onClick={() => setChosenMemoType("planned")}>계획</button>
          <button type="button" aria-pressed={effectiveMemoType === "recorded"} onClick={() => setChosenMemoType("recorded")}>수행 기록</button>
        </div>
        <p className="db-field-hint">{effectiveMemoType === "planned" ? "앞으로 할 일이에요. 번호로 표시하고 완료하면 체크해요." : "이미 수행한 일이에요. -로 표시하고 완료 체크는 하지 않아요."}</p>
        <p className="db-field-hint">날짜에 따라 기본 선택돼요. 새벽에 적는 오늘의 할 일은 ‘계획’을 선택해 주세요.</p>
      </fieldset>}
      {kind === "todo" && <fieldset className="db-category-field">
        <legend>카테고리</legend>
        <div className="db-category-options">
          {categories.map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>직접 입력</button>
        </div>
        {category === null && <label>새 카테고리 이름<input name="customCategory" required maxLength={40} placeholder="예: 운동"/></label>}
      </fieldset>}
      {kind === "note" && <label>메모 내용<textarea name="body" rows={6} maxLength={20000} defaultValue={entry?.kind === "note" ? entry.body : ""} placeholder="작업 과정이나 기억할 내용을 남겨 보세요."/></label>}
      {error && <p role="alert" className="db-error">{error}</p>}
      {confirmDelete ? <footer><span>삭제할까요?</span><button type="button" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" className="db-danger" onClick={() => entry && commit(entry, true)}>삭제하기</button></footer> :
      <footer>{entry && <button type="button" className="db-delete" onClick={() => setConfirmDelete(true)}>삭제</button>}<button type="button" onClick={onClose} disabled={busy}>취소</button><button className="db-primary" type="submit">저장</button></footer>}
    </fieldset></form>
  </dialog>;
}
