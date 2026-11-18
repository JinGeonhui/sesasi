"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import MemoryDial from "./memory-dial";
import { saveBackup } from "../lib/native";
import { hasChronologicalDates, imageData, readStories, sampleStories, sortStories, validateStories, writeStories, type Story } from "../lib/archive";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7M4 12h12" />,
    back: <path d="m12 5-7 7 7 7M5 12h15" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7v4H6"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15z"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    check: <path d="m5 12 4 4L19 6" />,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.plus}</svg>;
}

function Modal({ children, onClose, label, small = false, wide = false }: { children: ReactNode; onClose: () => void; label: string; small?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`modal ${small ? "modal-small" : ""} ${wide ? "modal-editor" : ""}`} aria-label={label} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose(); } }}>
    {children}
  </dialog>;
}

type EditorState = { story?: Story; parentId?: string };
function Editor({ state, stories, onSave, onClose }: { state: EditorState; stories: Story[]; onSave: (story: Story) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState(state.story?.title ?? "");
  const [date, setDate] = useState(state.story?.date ?? new Date().toLocaleDateString("en-CA"));
  const [hasDate, setHasDate] = useState(state.story ? Boolean(state.story.date) : true);
  const [body, setBody] = useState(state.story?.body ?? "");
  const [summary, setSummary] = useState(state.story?.summary ?? "");
  const [facts, setFacts] = useState<NonNullable<Story["facts"]>>(state.story?.facts ?? []);
  const [category, setCategory] = useState<Story["category"]>(state.story?.category ?? "life");
  const [parentId, setParentId] = useState(state.story?.parentId ?? state.parentId ?? "");
  const [images, setImages] = useState<string[]>(state.story?.images ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const descendants = new Set<string>(state.story ? [state.story.id] : []);
  let changed = true;
  while (changed) { changed = false; for (const s of stories) if (s.parentId && descendants.has(s.parentId) && !descendants.has(s.id)) { descendants.add(s.id); changed = true; } }
  const candidates = stories.filter(s => !descendants.has(s.id));
  return <Modal wide onClose={() => { if (!busy) onClose(); }} label={state.story ? "기록 수정" : "새로운 기록"}>
    <div className="modal-head"><div><h2>{state.story ? "기록 수정" : parentId ? "분기 추가" : "기록 추가"}</h2></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="닫기"><Icon name="close"/></button></div>
    <form onSubmit={async e => {
      e.preventDefault(); setError("");
      const record: Story = {
        id: state.story?.id ?? crypto.randomUUID(),
        title: title.trim(),
        date: hasDate ? date : "",
        category,
        body: body.trim(),
        summary: summary.trim(),
        facts: facts.map(fact => ({ label: fact.label.trim(), value: fact.value.trim() })).filter(fact => fact.label && fact.value),
        images,
        parentId: parentId || null,
      };
      const next = [...stories.filter(story => story.id !== record.id), record];
      if (!hasChronologicalDates(next)) {
        setError("연결된 앞 기록보다 이르거나, 뒤 기록보다 늦은 날짜는 선택할 수 없습니다.");
        return;
      }
      setBusy(true);
      try { await onSave(record); } catch { setError("저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요."); setBusy(false); }
    }}>
      <div className="editor-intro">
      <section className="editor-art" aria-labelledby="editor-art-label"><h3 id="editor-art-label">이 기록의 아트</h3><p className="field-hint">대표 아트가 상세 화면의 중심에 크게 놓입니다.</p>
      <div className="image-editor">{images.map((src, i) => <div className={`upload-preview${i === 0 ? " upload-cover" : ""}`} key={`${i}-${src.slice(-20)}`}><img src={src} alt={`첨부 아트 ${i + 1}`} /><button className="remove-image" type="button" disabled={busy} aria-label={`아트 ${i + 1} 삭제`} onClick={() => setImages(images.filter((_, index) => i !== index))}><Icon name="close" size={14}/></button>{i === 0 ? <span>대표 아트</span> : <button className="choose-cover" type="button" disabled={busy} aria-label={`아트 ${i + 1}을 대표로 선택`} onClick={() => setImages([src, ...images.filter((_, index) => i !== index)])}>대표로</button>}</div>)}
        <label className={`upload-zone ${images.length ? "compact" : ""}`}><Icon name="image" size={25}/><strong>{busy ? "처리 중…" : "아트 추가"}</strong>{!images.length && <span>JPG, PNG, WebP · 투명 배경 지원</span>}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={async e => {
          const files = Array.from(e.target.files ?? []); e.target.value = ""; if (!files.length) return;
          setBusy(true); setError("");
          try { if (images.length + files.length > 12) throw new Error("한 기록에 사진을 12장까지 추가할 수 있어요."); const data = await Promise.all(files.map(imageData)); setImages(prev => [...prev, ...data]); } catch (err) { setError(err instanceof Error ? err.message : "사진을 읽을 수 없습니다."); } finally { setBusy(false); }
        }}/></label>
      </div>
      </section>
      <div className="editor-basics">
      <label className="field">기록의 제목<input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="제목"/></label>
      <label className="field summary-field">짧은 소개 <span className="optional-label">선택</span><textarea rows={3} maxLength={240} value={summary} onChange={e => setSummary(e.target.value)} placeholder="이 아트와 연결된 나의 경험을 짧게 소개해 주세요."/></label>
      <div className="field-row"><div className="date-field">
        <div className="date-field-heading"><label htmlFor="story-date">날짜</label><label className="date-none"><input type="checkbox" checked={!hasDate} onChange={e => setHasDate(!e.target.checked)} />선택하지 않음</label></div>
        <input id="story-date" aria-label="날짜" type="date" required={hasDate} disabled={!hasDate} min="1900-01-01" max="2200-12-31" value={hasDate ? date : ""} onChange={e => setDate(e.target.value)} />
      </div><label className="field">이야기의 종류<select value={category} onChange={e => setCategory(e.target.value as Story["category"])}><option value="life">삶의 순간</option><option value="work">작업과 도전</option></select></label></div>
      <label className="field">어디에서 이어지나요?<select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">나의 필름에 추가</option>{candidates.map(s => <option key={s.id} value={s.id}>{s.date ? `${s.date.slice(0, 4)} · ` : ""}{s.title}</option>)}</select></label>
      </div>
      </div>
      <fieldset className="facts-editor"><legend>경험 · 역량 <span className="optional-label">선택</span></legend><p className="field-hint">역할, 사용 기술, 성과, 자격 등 원하는 항목을 적어 주세요.</p>
        {facts.map((fact, index) => <div className="fact-input-row" key={index}>
          <input aria-label={`항목 ${index + 1} 이름`} placeholder="예: 사용 기술" maxLength={32} required value={fact.label} onChange={e => setFacts(facts.map((item, i) => i === index ? {...item, label: e.target.value} : item))}/>
          <input aria-label={`항목 ${index + 1} 내용`} placeholder="예: Figma, React" maxLength={160} required value={fact.value} onChange={e => setFacts(facts.map((item, i) => i === index ? {...item, value: e.target.value} : item))}/>
          <button className="icon-button" type="button" aria-label={`항목 ${index + 1} 삭제`} onClick={() => setFacts(facts.filter((_, i) => i !== index))}><Icon name="close" size={16}/></button>
        </div>)}
        <button className="text-button add-fact" type="button" disabled={facts.length >= 6} onClick={() => setFacts([...facts, {label: "", value: ""}])}><Icon name="plus" size={16}/>항목 추가 <span>{facts.length} / 6</span></button>
      </fieldset>
      <label className="field">이 아트에 담긴 이야기<textarea rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="어떤 경험이었는지, 무엇을 했고 느꼈는지 자유롭게 남겨 주세요."/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-footer"><span>이 브라우저에 저장됩니다.</span><button className="primary-button" disabled={busy || !title.trim()} type="submit"><Icon name="check"/>{busy ? "처리 중…" : "기록 저장"}</button></div>
    </form>
  </Modal>;
}

export default function Archive() {
  const [stories, setStories] = useState<Story[]>(sampleStories);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [pendingImport, setPendingImport] = useState<Story[] | null>(null);
  const [mutating, setMutating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const readRoute = () => window.location.hash.startsWith("#story/") ? window.location.hash.slice(7) : null;
    readStories().then(items => {
      const id = readRoute();
      setStories(items);
      setActiveId(id);
      if (id && items.some(story => story.id === id)) setSelectedId(id);
      setReady(true);
    }).catch(() => {
      setActiveId(readRoute());
      setToast("브라우저 저장소를 열 수 없습니다. 브라우저 설정을 확인해 주세요.");
    });
    let transition: ViewTransition | undefined;
    const route = () => {
      const id = readRoute();
      const update = () => { setActiveId(id); if (id) setSelectedId(id); setMenu(false); };
      transition?.skipTransition();
      if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        update();
        return;
      }
      transition = document.startViewTransition(() => { flushSync(update); });
      // A skipped animation must not interrupt navigation.
      void transition.ready.catch(() => {});
    };
    window.addEventListener("hashchange", route);
    return () => { window.removeEventListener("hashchange", route); transition?.skipTransition(); };
  }, []);
  useEffect(() => {
    if (activeId) {
      window.scrollTo(0, 0);
      detailHeading.current?.focus({ preventScroll: true });
    }
  }, [activeId]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  const sorted = sortStories(stories);
  const active = stories.find(s => s.id === activeId);
  // Record hashes stay within this one statically exported page, not another Next page.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const openStory = (id: string) => { setSelectedId(id); setMenu(false); window.location.assign(`#story/${id}`); };
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  const closeStory = () => { setMenu(false); window.location.assign("#"); };
  const persist = async (next: Story[]) => { await writeStories(next); setStories(next); };
  const save = async (story: Story) => { await persist(stories.some(s => s.id === story.id) ? stories.map(s => s.id === story.id ? story : s) : [...stories, story]); setEditor(null); setToast("저장했습니다."); openStory(story.id); };
  const download = async () => {
    setExporting(true);
    try {
      const saved = await saveBackup(JSON.stringify({ version: 1, stories }, null, 2), `sesasi-${new Date().toISOString().slice(0, 10)}.json`);
      if (saved) { setMenu(false); setToast("사진과 글을 담은 백업 파일을 저장했어요."); }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "백업 파일을 저장하지 못했어요.");
    } finally { setExporting(false); }
  };

  return <div className="archive-app">
    <input ref={importInput} className="hidden" type="file" accept=".json,application/json" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      try { if (file.size > 150 * 1024 * 1024) throw new Error(); const data = JSON.parse(await file.text()); if (data.version !== 1 || !validateStories(data.stories)) throw new Error(); setPendingImport(data.stories); } catch { setToast("올바른 세사시 백업 파일을 선택해 주세요. (최대 150MB)"); }
    }}/>

    {activeId ? active ? <main className="detail-page">
      <div className="detail-toolbar"><button className="text-button" onClick={closeStory}><Icon name="back"/>필름으로 돌아가기</button><div><button className="text-button" disabled={!ready} onClick={() => setEditor({ story: active })}><Icon name="edit"/>수정</button><button className="icon-button danger" disabled={!ready} aria-label="기록 삭제" onClick={() => setDeleting(true)}><Icon name="trash"/></button></div></div>
      <article className="story-detail">
        <div className="art-spread">
          <figure className={`spread-art${active.images[0] ? "" : " spread-art-empty"}`}>
            {active.images[0] ? <div className="art-mount"><img src={active.images[0]} alt={`${active.title} — 대표 아트`} /></div> : <div className="no-image"><Icon name="image" size={40}/><p>이 기록을 보여 주는 아트를 담아 보세요.</p><button className="text-button" disabled={!ready} onClick={() => setEditor({ story: active })}>아트 추가하기 <Icon name="plus"/></button></div>}
          </figure>
          <div className="spread-copy">
            <header className="spread-intro">
              <div className="spread-meta"><span className={`category-tag ${active.category}`}>{active.category === "life" ? "삶의 순간" : "작업과 도전"}</span>{active.date && <time dateTime={active.date}>{active.date.replaceAll("-", ". ")}</time>}</div>
              <h1 ref={detailHeading} tabIndex={-1}>{active.title}</h1>
              {active.summary && <p className="art-summary">{active.summary}</p>}
            </header>
            {active.body && <section className="story-writing" aria-label="이 아트에 담긴 이야기"><div className="story-body">{active.body}</div></section>}
            {Boolean(active.facts?.length) && <dl className="art-facts">{active.facts!.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
          </div>
        </div>
        {active.images.length > 1 && <section className="detail-gallery" aria-label="함께 남긴 아트">{active.images.slice(1).map((src, i) => <figure key={i}><img loading="lazy" src={src} alt={`${active.title} — 함께 남긴 아트 ${i + 1}`} /></figure>)}</section>}
        <nav className="story-connections" aria-label="이어지는 기록">
          {active.parentId && <button className="parent-link" onClick={() => openStory(active.parentId!)}><Icon name="branch"/><span>이 이야기가 시작된 곳<strong>{stories.find(s => s.id === active.parentId)?.title}</strong></span><Icon name="arrow"/></button>}
          <button className="outline-button" disabled={!ready} onClick={() => setEditor({ parentId: active.id })}><Icon name="branch"/>이 순간에서 분기 추가</button>
        </nav>
      </article>
      {stories.some(s => s.parentId === active.id) && <section className="related"><h2>이 순간에서 이어진 이야기</h2><div>{sorted.filter(s => s.parentId === active.id).map(s => <button key={s.id} onClick={() => openStory(s.id)}>{s.images[0] && <img src={s.images[0]} alt=""/>}<span>{s.date && <small>{s.date.slice(0, 4)}</small>}{s.title}</span><Icon name="arrow"/></button>)}</div></section>}
    </main> : <main className="missing"><h1>{ready ? "이 기록을 찾을 수 없어요." : "기록을 불러오고 있어요."}</h1><button className="text-button" onClick={closeStory}><Icon name="back"/>필름으로 돌아가기</button></main> : (
      <MemoryDial
        stories={sorted}
        selectedId={selectedId}
        onSelect={id => { setSelectedId(id); setMenu(false); }}
        onOpen={openStory}
        onAdd={() => { setMenu(false); setEditor({}); }}
        ready={ready}
        management={<div className="menu-wrap">
          <button className="icon-button" aria-label="기록 관리" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
          {menu && <>
            <button className="menu-dismiss" aria-label="메뉴 닫기" onClick={() => setMenu(false)} />
            <div className="dropdown">
              <button onClick={download} disabled={!ready || exporting}><Icon name="download" />{exporting ? "저장 중…" : "백업"}</button>
              <button onClick={() => { importInput.current?.click(); setMenu(false); }} disabled={!ready}><Icon name="upload" />백업 불러오기</button>
            </div>
          </>}
        </div>}
      />
    )}
    {editor && <Editor state={editor} stories={stories} onSave={save} onClose={() => setEditor(null)}/>}
    {deleting && active && <Modal label="기록 삭제 확인" small onClose={() => {if (!mutating) setDeleting(false);}}><h2>이 기록을 지울까요?</h2><p>‘{active.title}’의 사진과 글이 삭제됩니다. 이어진 분기는 남아 있고, 연결만 정리됩니다.</p><div className="confirm-actions"><button className="outline-button" disabled={mutating} onClick={() => setDeleting(false)}>남겨 두기</button><button className="primary-button delete-button" disabled={mutating} onClick={async () => { setMutating(true); try { await persist(stories.filter(s => s.id !== active.id).map(s => s.parentId === active.id ? {...s, parentId:active.parentId} : s)); setDeleting(false); closeStory(); setToast("기록을 삭제했어요."); } catch { setToast("삭제하지 못했어요. 다시 시도해 주세요."); } finally { setMutating(false); } }}>기록 삭제</button></div></Modal>}
    {pendingImport && <Modal label="백업 불러오기 확인" small onClose={() => {if (!mutating) setPendingImport(null);}}><h2>{pendingImport.length}개의 순간을 불러올까요?</h2><p>현재 기록을 백업 파일의 사진과 글로 교체합니다. 필요한 기록은 먼저 백업해 주세요.</p><div className="confirm-actions"><button className="outline-button" disabled={mutating} onClick={() => setPendingImport(null)}>취소</button><button className="primary-button" disabled={mutating} onClick={async () => { setMutating(true); try { await persist(pendingImport); setPendingImport(null); closeStory(); setToast("기록을 모두 불러왔어요."); } catch { setToast("백업을 저장하지 못했어요. 저장 공간을 확인해 주세요."); } finally { setMutating(false); } }}>불러오기</button></div></Modal>}
    {toast && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}<button onClick={() => setToast("")} aria-label="알림 닫기"><Icon name="close" size={14}/></button></div>}
  </div>;
}
