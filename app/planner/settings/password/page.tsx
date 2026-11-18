import type { Metadata } from 'next';
import Link from 'next/link';
import PlannerNavigation from '../../navigation';
import PasswordForm from './password-form';

export const metadata: Metadata = { title: '비밀번호 설정 — 작업 페이지 | 세사시' };
export default function PasswordPage() {
  return <div className="daybook">
    <PlannerNavigation active="settings"/>
    <main className="db-main">
      <Link href="/planner/settings/" className="db-category-back">← 설정</Link>
      <header className="db-heading"><h1>비밀번호 설정</h1></header>
      <section className="db-cloud-account">
        <p>이 계정으로 로그인할 때 사용할 비밀번호를 설정하세요.</p>
        <PasswordForm/>
      </section>
    </main>
  </div>;
}
