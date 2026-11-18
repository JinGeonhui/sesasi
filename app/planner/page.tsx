import type { Metadata } from "next";
import Planner from "./planner";

export const metadata: Metadata = {
  title: "홈 — 작업 페이지 | 세사시",
  description: "일정과 할 일, 자주 이용하는 교통 노선과 작업 메모를 한곳에서 관리하세요.",
};

export default function PlannerPage() {
  return <Planner tab="overview" />;
}
