import type { Metadata } from "next";
import Planner from "../planner";

export const metadata: Metadata = { title: "할 일 — 작업 페이지 | 세사시" };

export default function TodosPage() {
  return <Planner tab="todo" />;
}
