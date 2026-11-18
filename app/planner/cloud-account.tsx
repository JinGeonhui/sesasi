'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { cloudClient, cloudConfigured, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from './cloud';

export function CloudNotice() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  if (!cloudConfigured || !auth.ready || auth.session) return null;
  return <div className="daybook db-cloud-notice"><p>날씨·교통·디스코드 연결을 사용하려면 <Link href="/planner/settings/">개인 계정으로 로그인</Link>해 주세요.</p></div>;
}
export default function CloudAccount() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  if (!cloudConfigured) return null;
  async function signIn() {
    const client = cloudClient(); if (!client) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/planner/settings/` } });
      if (error) { setMessage('로그인 메일을 보내지 못했어요. 등록된 이메일인지 확인하고 잠시 후 다시 시도해 주세요.'); return; }
      setMessage('이메일의 로그인 링크를 이 브라우저에서 열어 주세요.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '로그인하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <section className="db-cloud-account" aria-label="개인 계정">
    <h2>개인 계정</h2>
    {!auth.ready ? <p>로그인 확인 중…</p> : auth.session ? <>
      <p>{auth.session.user.email}</p><p>날씨·교통 조회와 디스코드 전송에 연결된 계정입니다.</p>
      <button disabled={busy} onClick={async () => {
        setBusy(true);
        try { const result = await cloudClient()?.auth.signOut({ scope: 'local' }); setMessage(result?.error ? '로그아웃하지 못했어요. 다시 시도해 주세요.' : '로그아웃했어요.'); }
        catch { setMessage('로그아웃하지 못했어요.'); }
        finally { setBusy(false); }
      }}>로그아웃</button>
    </> : <form onSubmit={event => { event.preventDefault(); void signIn(); }}>
      <p>등록한 이메일로 로그인 링크를 받아 연결하세요.</p>
      <label>이메일<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
      <button disabled={busy} type="submit">{busy ? '메일 전송 중…' : '로그인 링크 받기'}</button>
    </form>}
    <p role="status">{message}</p>
  </section>;
}
