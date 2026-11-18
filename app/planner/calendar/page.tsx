import type { Metadata } from "next";
import Planner from "../planner";

export const metadata: Metadata = { title: "캘린더 — 작업 페이지 | 세사시" };

export default function CalendarPage() {
  return <Planner tab="event" />;
}
