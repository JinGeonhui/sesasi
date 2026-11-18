import CloudAccount from "../cloud-account";
import type { Metadata } from "next";
import PlannerNavigation from "../navigation";
import FeatureLink from "../feature-link";

export const metadata: Metadata = { title: "설정 — 작업 페이지 | 세사시" };

export default function SettingsPage() {
  return <div className="daybook">
    <PlannerNavigation active="settings" />
    <main className="db-main">
      <header className="db-heading"><h1>설정</h1></header>
      <CloudAccount/>
      <div className="db-shortcuts db-settings-links">
        <FeatureLink href="/planner/settings/history/" icon="history" title="기록" description="날짜별 일정과 메모를 돌아보세요."/>
        <FeatureLink href="/planner/settings/categories/" icon="tag" title="카테고리 관리" description="메모 카테고리를 추가하거나 삭제하세요."/>
      </div>
    </main>
  </div>;
}
