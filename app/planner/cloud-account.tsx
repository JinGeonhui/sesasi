'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { cloudClient, cloudConfigured, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from './cloud';

export default function CloudAccount() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  if (!cloudConfigured || !auth.session) return null;
  return <section className="db-cloud-account" aria-label="개인 계정">
    <h2>개인 계정</h2>
    <p>{auth.session.user.email}</p>
    <div className="db-account-actions">
      <Link href="/planner/settings/password/">비밀번호 설정·변경</Link>
      <button disabled={busy} onClick={async () => {
        setBusy(true); setMessage('');
        try { const result = await cloudClient()?.auth.signOut({ scope: 'local' }); if (result?.error) setMessage('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
        catch { setMessage('로그아웃하지 못했습니다.'); }
        finally { setBusy(false); }
      }}>로그아웃</button>
    </div>
    <p role="status">{message}</p>
  </section>;
}
