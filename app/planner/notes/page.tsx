import type { Metadata } from "next";
import Planner from "../planner";

export const metadata: Metadata = { title: "작업 메모 — 작업 페이지 | 세사시" };

export default function NotesPage() {
  return <Planner tab="note" />;
}
