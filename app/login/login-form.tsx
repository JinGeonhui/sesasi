'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { cloudClient, cloudConfigured, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from '../planner/cloud';

export default function LoginForm() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (auth.ready && auth.session) router.replace('/planner/');
  }, [auth.ready, auth.session, router]);
  async function signIn() {
    const client = cloudClient();
    if (!client || busy) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setMessage(error.status === 429 ? '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'
          : error.code === 'invalid_credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : error.code === 'email_not_confirmed' ? '이메일 인증이 완료되지 않은 계정입니다.'
          : '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setPassword(''); router.replace('/planner/');
    } catch { setMessage('로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  if (!cloudConfigured) return <p role="alert">로그인 서버가 설정되지 않았습니다. 관리자에게 문의해 주세요.</p>;
  return <form className="login-form" onSubmit={event => { event.preventDefault(); void signIn(); }}>
    <label htmlFor="login-email">이메일</label>
    <input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/>
    <label htmlFor="login-password">비밀번호</label>
    <input id="login-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/>
    <p className="login-message" role="status" aria-live="polite">{message}</p>
    <button type="submit" disabled={busy || !auth.ready || Boolean(auth.session)}>{busy ? '로그인 중…' : '로그인'}</button>
  </form>;
}
