import { useEffect, useRef, useState } from "react";
import { todoCategory, type Todo } from "./data";

export default function DeleteMemoDialog({ todo, onClose, onDelete }: {
  todo: Todo; onClose: () => void; onDelete: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await onDelete(); }
    catch (err) { setError(err instanceof Error ? err.message : "메모를 삭제하지 못했어요. 다시 시도해 주세요."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="db-dialog db-delete-memo-dialog" aria-labelledby="db-delete-memo-title" aria-describedby="db-delete-memo-description"
    onCancel={event => { if (pending.current) event.preventDefault(); else onClose(); }}>
    <header><h2 id="db-delete-memo-title">메모를 삭제할까요?</h2></header>
    <p className="db-delete-memo-preview">[{todoCategory(todo)}] {todo.title}</p>
    <p id="db-delete-memo-description" className="db-field-hint">{todo.date}의 메모가 홈과 할 일 목록에서 삭제됩니다.</p>
    {error && <p role="alert" className="db-error">{error}</p>}
    <footer><button type="button" onClick={onClose} disabled={busy} autoFocus>취소</button>
      <button type="button" className="db-danger" onClick={() => void remove()} disabled={busy}>{busy ? "삭제 중…" : "삭제하기"}</button></footer>
  </dialog>;
}
