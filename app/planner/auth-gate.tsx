'use client';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cloudConfigured, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from './cloud';

export default function AuthGate({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const router = useRouter();
  useEffect(() => {
    if (cloudConfigured && auth.ready && !auth.session) router.replace('/login/');
  }, [auth.ready, auth.session, router]);
  if (!cloudConfigured) return <main role="alert">서버가 설정되지 않았습니다. 서버 설정을 확인해 주세요.</main>;
  if (!auth.ready || !auth.session) {
    return <main className="daybook db-auth-loading" role="status">로그인 확인 중…</main>;
  }
  return <div key={auth.session.user.id} style={{ display: "contents" }}>{children}</div>;
}
