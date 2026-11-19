import type { Metadata } from "next";
import AuthGate from "../planner/auth-gate";
import Archive from "../components/archive";

export const metadata: Metadata = { title: "필름 — 서사 페이지 | 세사시" };

export default function FilmPage() {
  return <AuthGate><Archive /></AuthGate>;
}
