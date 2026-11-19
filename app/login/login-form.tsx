'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { credentials, loginError } from './credentials';
import { useRouter } from 'next/navigation';
import { cloudClient, cloudConfigured, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from '../planner/cloud';

export default function LoginForm() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (auth.ready && auth.session) router.replace('/planner/');
  }, [auth.ready, auth.session, router]);
  async function signIn(form: HTMLFormElement) {
    const submitted = credentials(new FormData(form));
    const client = cloudClient();
    if (!client || busy) return;
    setBusy(true); setMessage('');
    try {
      const { data, error } = await client.auth.signInWithPassword(submitted);
      if (error) { setMessage(loginError(error)); return; }
      if (!data.session) { setMessage('로그인을 완료하지 못했습니다. 다시 시도해 주세요.'); return; }
      form.reset(); router.replace('/planner/');
    } catch { setMessage('로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  async function recover(form: HTMLFormElement | null) {
    if (!form) return;
    const { email } = credentials(new FormData(form));
    const client = cloudClient();
    if (!client || busy || !email.trim()) { setMessage('계정 이메일을 먼저 입력해 주세요.'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: new URL('/planner/settings/password/', window.location.origin).href });
      setMessage(error ? (error.status === 429 ? '메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '재설정 메일을 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.') : '등록된 계정이라면 비밀번호 재설정 메일이 발송됩니다. 메일의 링크에서 새 비밀번호를 설정해 주세요.');
    } catch { setMessage('서버에 연결하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  if (!cloudConfigured) return <p role="alert">로그인 서버가 설정되지 않았습니다. 관리자에게 문의해 주세요.</p>;
  return <form className="login-form" onSubmit={event => { event.preventDefault(); void signIn(event.currentTarget); }}>
    <label htmlFor="login-email">이메일</label>
    <input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy}/>
    <label htmlFor="login-password">비밀번호</label>
    <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required disabled={busy}/>
    <label><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)}/>비밀번호 표시</label>
    <p className="login-message" role="status" aria-live="polite">{message}</p>
    <button type="submit" disabled={busy || !auth.ready || Boolean(auth.session)}>{busy ? '로그인 중…' : '로그인'}</button>
    <button type="button" disabled={busy} onClick={e => void recover(e.currentTarget.form)}>비밀번호 재설정 메일 받기</button>
  </form>;
}
