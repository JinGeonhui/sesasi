import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { todoCategory, uncategorized, type Todo } from "./data";

type Props = {
  categories: string[];
  todos: Todo[];
  onAdd: (name: string) => Promise<unknown>;
  onDelete: (name: string) => Promise<unknown>;
  onClose?: () => void;
  embedded?: boolean;
};

export default function CategoryManager({ categories, todos, onAdd, onDelete, onClose, embedded = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (embedded) return;
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, [embedded]);
  const counts = new Map<string, number>();
  for (const todo of todos) {
    const category = todoCategory(todo);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onAdd(name.trim());
      setName(""); setError("");
    } catch (err) {
      setError(err instanceof DOMException ? "서버 연결을 확인해 주세요." : (err as Error).message);
    } finally { setBusy(false); }
  }
  async function remove(category: string) {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete(category);
      setPending(null); setError("");
    } catch {
      setError("카테고리를 삭제할 수 없어요. 서버 연결을 확인해 주세요.");
    } finally { setBusy(false); }
  }

  const content = <fieldset className="db-saving-fields" disabled={busy}>
    {!embedded && <header><h2 id="db-manage-title">카테고리 관리</h2><button onClick={onClose} aria-label="닫기"><Icon name="close"/></button></header>}
    <form className="db-category-create" onSubmit={add}>
      <label>새 카테고리 이름<input required maxLength={40} placeholder="예: 운동" value={name} onChange={e => setName(e.target.value)}/></label>
      <button className="db-primary" disabled={!name.trim()}>추가</button>
    </form>
    {error && <p className="db-error" role="alert">{error}</p>}
    <ul className="db-managed-categories">{categories.map(category => {
      const count = counts.get(category) ?? 0;
      return <li key={category}>
        <div><strong>{category}</strong><small>메모 {count}개</small></div>
        {category !== uncategorized && pending !== category && <button className="db-text-action" aria-label={`${category} 삭제`} onClick={() => { setPending(category); setError(""); }}>삭제</button>}
        {pending === category && <div className="db-category-confirm">
          <p>{count ? `삭제하면 메모 ${count}개가 미분류로 이동해요.` : "비어 있는 카테고리를 삭제할까요?"}</p>
          <button onClick={() => setPending(null)}>취소</button><button className="db-danger" onClick={() => remove(category)}>삭제하기</button>
        </div>}
      </li>;
    })}</ul>
  </fieldset>;
  return embedded
    ? <section className="db-dialog db-category-settings" aria-label="메모 카테고리 관리">{content}</section>
    : <dialog ref={dialog} className="db-dialog" aria-labelledby="db-manage-title" onCancel={onClose}>{content}</dialog>;
}
