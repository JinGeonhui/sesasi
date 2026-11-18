import type { Metadata } from 'next';
import LoginForm from './login-form';
import './login.css';

export const metadata: Metadata = { title: '로그인 | 세사시' };
export default function LoginPage() {
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title">
    <p className="login-brand">세사시</p>
    <h1 id="login-title">로그인</h1>
    <p className="login-description">나의 일상과 기록을 이어 가세요.</p>
    <LoginForm/>
  </section></main>;
}
