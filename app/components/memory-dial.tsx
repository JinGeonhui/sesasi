"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Story } from "../lib/archive";

type Props = {
  stories: Story[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  ready: boolean;
  management: ReactNode;
};

function Arrow({ direction }: { direction: "up" | "down" | "right" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d={direction === "up" ? "m6 15 6-6 6 6" : direction === "down" ? "m6 9 6 6 6-6" : "M4 12h15m-6-6 6 6-6 6"}/></svg>;
}

function wrapIndex(index: number, count: number) {
  return count ? ((index % count) + count) % count : 0;
}

export default function MemoryDial({ stories, selectedId, onSelect, onOpen, onAdd, ready, management }: Props) {
  const selectedIndex = Math.max(0, stories.findIndex(story => story.id === selectedId));
  const selected = stories[selectedIndex];
  // Keep travelling in the same direction when the displayed number wraps.
  const [position, setPosition] = useState(selectedIndex);
  const reelPosition = wrapIndex(position, stories.length) === selectedIndex ? position : selectedIndex;
  const root = useRef<HTMLElement>(null);
  const indexRef = useRef(selectedIndex);
  const positionRef = useRef(reelPosition);
  const wheel = useRef({ amount: 0, last: 0, direction: 0 });
  const gesture = useRef<{ pointerId: number; startY: number; previous: number; amount: number; moved: boolean; rotary: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    indexRef.current = selectedIndex;
    positionRef.current = reelPosition;
    if (root.current?.contains(document.activeElement) && document.activeElement?.classList.contains("film-frame")) {
      root.current.querySelector<HTMLButtonElement>(".film-frame.is-selected")?.focus({ preventScroll: true });
    }
  }, [selectedIndex, reelPosition]);
  const choose = useCallback((index: number) => {
    if (stories.length < 2) return;
    const next = wrapIndex(index, stories.length);
    if (next === indexRef.current) return;
    positionRef.current += index - indexRef.current;
    indexRef.current = next;
    setPosition(positionRef.current);
    onSelect(stories[next].id);
  }, [stories, onSelect]);
  const move = useCallback((direction: number) => choose(indexRef.current + direction), [choose]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const turn = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || stories.length < 2) return;
      if ((event.target as Element).closest(".dial-tools")) return;
      event.preventDefault();
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const direction = Math.sign(amount);
      if (wheel.current.direction !== direction) wheel.current.amount = 0;
      wheel.current.direction = direction;
      wheel.current.amount += amount;
      const now = performance.now();
      if (Math.abs(wheel.current.amount) >= 40 && now - wheel.current.last >= 280) {
        move(direction);
        wheel.current = { amount: 0, last: now, direction };
      }
    };
    element.addEventListener("wheel", turn, { passive: false });
    return () => element.removeEventListener("wheel", turn);
  }, [move, stories.length]);

  const angleAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) * 180 / Math.PI;
  };
  const begin = (event: PointerEvent<HTMLElement>, rotary = false) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { pointerId: event.pointerId, startY: event.clientY, previous: rotary ? angleAt(event) : event.clientY, amount: 0, moved: false, rotary };
    if (rotary) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const position = current.rotary ? angleAt(event) : event.clientY;
    let delta = current.rotary ? position - current.previous : current.previous - position;
    if (current.rotary && Math.abs(delta) > 180) delta += delta > 0 ? -360 : 360;
    current.previous = position;
    current.amount += delta;
    if (Math.abs(current.amount) > (current.rotary ? 4 : 8) || Math.abs(event.clientY - current.startY) > 8) {
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const threshold = current.rotary ? 22 : 64;
    if (Math.abs(current.amount) >= threshold) {
      move(Math.sign(current.amount));
      current.amount = 0;
    }
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    suppressClick.current = gesture.current.moved;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <main className="film-dial" ref={root} tabIndex={0} aria-label="기억의 필름 다이얼. 위아래 방향키로 고르고 Enter로 엽니다." onKeyDown={event => {
    const control = (event.target as Element).closest("button, a, input");
    const navigationKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (control && (!control.classList.contains("film-frame") || !navigationKeys.includes(event.key))) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") move(1);
    if (event.key === "Home") choose(0);
    if (event.key === "End") choose(stories.length - 1);
    if (event.key === "Enter" && selected) onOpen(selected.id);
  }}>
    {selected ? <>
      <div className="film-stage" onPointerDown={event => begin(event)} onPointerMove={drag} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }} onClickCapture={event => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
      }}>
        <div className="film-reel">
          {(stories.length === 1 ? [0] : [-3, -2, -1, 0, 1, 2, 3]).map(offset => {
            const virtualIndex = reelPosition + offset;
            const index = wrapIndex(virtualIndex, stories.length);
            const story = stories[index];
            return <button key={`${virtualIndex}-${story.id}`} className={`film-frame${offset === 0 ? " is-selected" : ""}`} style={{ "--slot": offset, "--depth": Math.abs(offset) } as CSSProperties} tabIndex={offset === 0 ? 0 : -1} aria-label={offset === 0 ? `${story.title} 기록 열기` : `${story.title} 선택`} aria-current={offset === 0 ? "true" : undefined} onClick={() => offset === 0 ? onOpen(story.id) : choose(indexRef.current + offset)}>
              <span className="frame-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}{story.date && <span>{story.date.replaceAll("-", ".")}</span>}</span>
              <span className="frame-image">{story.images[0] ? <img src={story.images[0]} alt={story.title} draggable={false} style={offset === 0 ? { viewTransitionName: "memory-art" } : undefined}/> : <span className="frame-empty">{story.title}</span>}</span>
              <span className="frame-edge" aria-hidden="true"/>
            </button>;
          })}
        </div>
      </div>
      <div className="dial-caption" key={selected.id}>
        {selected.date && <span className="dial-year" aria-hidden="true">{selected.date.slice(0, 4)}</span>}
        <h1>{selected.title}</h1>
        {(selected.summary || selected.body) && <p>{selected.summary || selected.body.split("\n")[0]}</p>}
        <button className="dial-open" onClick={() => onOpen(selected.id)}>이 기억 펼치기 <Arrow direction="right"/></button>
      </div>
      <div className="dial-controller">
        <button className="dial-step" disabled={stories.length < 2} onClick={() => move(-1)} aria-label="이전 기억"><Arrow direction="up"/></button>
        <div className="dial-wheel" role="slider" tabIndex={0} aria-label="기억 선택 다이얼" aria-orientation="vertical" aria-valuemin={1} aria-valuemax={stories.length} aria-valuenow={selectedIndex + 1} aria-valuetext={`${selectedIndex + 1}번째 기억, ${selected.title}`} onPointerDown={event => begin(event, true)} onPointerMove={drag} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; }}>
          <svg className="dial-ticks" style={{ transform: `rotate(${reelPosition * 22}deg)` }} viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="65"/>
            {Array.from({length:48}, (_, index) => <path key={index} d={`M80 ${index % 4 === 0 ? 5 : 10}v${index % 4 === 0 ? 12 : 5}`} transform={`rotate(${index * 7.5} 80 80)`} className={index % 4 === 0 ? "major" : ""}/>)}
          </svg>
          <span className="dial-needle" aria-hidden="true"/>
          <span className="dial-count" aria-hidden="true">{String(selectedIndex + 1).padStart(2, "0")}<small>/ {String(stories.length).padStart(2, "0")}</small></span>
        </div>
        <button className="dial-step" disabled={stories.length < 2} onClick={() => move(1)} aria-label="다음 기억"><Arrow direction="down"/></button>
      </div>
      <p className="dial-hint">휠 · 드래그로 기억 넘기기</p>
      <p className="sr-only" role="status">{selectedIndex + 1} / {stories.length}, {selected.title}</p>
    </> : <div className="dial-empty"><span className="empty-frame" aria-hidden="true"/><p>{ready ? "첫 번째 기억을 담아 보세요." : "기억을 불러오고 있어요."}</p><button className="dial-open" disabled={!ready} onClick={onAdd}>기록 추가 <Arrow direction="right"/></button></div>}
    <Link href="/planner" className="dial-planner">일정 관리</Link>
    <div className="dial-tools"><button className="icon-button" disabled={!ready} onClick={onAdd} aria-label="기록 추가" title="기록 추가"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>{management}</div>
  </main>;
}
