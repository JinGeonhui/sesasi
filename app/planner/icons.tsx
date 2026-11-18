import type { ReactNode } from "react";

const paths = {
  next: <path d="m9 5 7 7-7 7"/>, prev: <path d="m15 5-7 7 7 7"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><rect x="7" y="4" width="3" height="4" rx="1" fill="currentColor"/><rect x="14" y="10" width="3" height="4" rx="1" fill="currentColor"/><rect x="7" y="16" width="3" height="4" rx="1" fill="currentColor"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3m-10 4h3"/></>,
  todo: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/></>,
  route: <><rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 15h.01M16 15h.01M8 19l-2 2m10-2 2 2M9 6h6"/></>,
  note: <><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M14 3v7h7M14 3l7 7M7 14h10M7 17h6"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2"/></>,
  tag: <><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
