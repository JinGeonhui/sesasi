import type { Metadata } from "next";
import Planner from "../planner";

export const metadata: Metadata = { title: "교통 노선 — 작업 페이지 | 세사시" };

export default function RoutesPage() {
  return <Planner tab="route" />;
}
