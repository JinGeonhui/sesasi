import type { Metadata } from "next";
import Planner from "../../planner";

export const metadata: Metadata = { title: "카테고리 관리 — 설정 | 세사시" };

export default function CategoriesPage() {
  return <Planner tab="categories" />;
}
