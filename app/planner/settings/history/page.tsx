import type { Metadata } from "next";
import Planner from "../../planner";

export const metadata: Metadata = { title: "기록 — 설정 | 세사시" };

export default function HistoryPage() {
  return <Planner tab="history" />;
}
