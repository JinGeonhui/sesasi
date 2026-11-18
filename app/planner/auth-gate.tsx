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
  if (cloudConfigured && (!auth.ready || !auth.session)) {
    return <main className="daybook db-auth-loading" role="status">로그인 확인 중…</main>;
  }
  return children;
}
