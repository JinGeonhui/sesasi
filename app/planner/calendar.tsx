import { dateKey, formatDay, localDate, onDay, shift, type Entry } from "./data";
import { Icon } from "./icons";

export const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
export default function Calendar({ day, today, entries, onSelect }: { day: string; today: string; entries: Entry[]; onSelect: (d: string) => void }) {
  const chosen = localDate(day);
  const first = new Date(chosen.getFullYear(), chosen.getMonth(), 1, 12);
  const start = shift(first, -((first.getDay() + 6) % 7));
  const days = new Date(chosen.getFullYear(), chosen.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((days + (first.getDay() + 6) % 7) / 7) * 7;
  const moveMonth = (by: number) => onSelect(dateKey(new Date(first.getFullYear(), first.getMonth() + by, 1, 12)));
  return <section className="db-card db-calendar">
    <div className="db-month-head"><h2>{formatDay(day, { year: "numeric", month: "long" })}</h2><div><button onClick={() => onSelect(today)}>오늘</button><button aria-label="이전 달" onClick={() => moveMonth(-1)}><Icon name="prev" size={16}/></button><button aria-label="다음 달" onClick={() => moveMonth(1)}><Icon name="next" size={16}/></button></div></div>
    <div className="db-month-grid">{weekdays.map(w => <span className="db-weekday" key={w}>{w}</span>)}
      {Array.from({ length: cells }, (_, i) => {
        const date = shift(start, i), key = dateKey(date);
        const events = entries.filter(e => onDay(e, key));
        return <button key={key} className={`${key === day ? "selected " : ""}${date.getMonth() !== chosen.getMonth() ? "outside" : ""}`} aria-label={`${key} 일정 ${events.length}개`} aria-pressed={key === day} onClick={() => onSelect(key)}>
          <b className={key === today ? "is-today" : ""}>{date.getDate()}</b>{events.length > 0 && <small>{events[0].title}{events.length > 1 && ` +${events.length - 1}`}</small>}
        </button>;
      })}
    </div>
  </section>;
}
