import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const cloudConfigured = Boolean(url && publishableKey);
export class CloudError extends Error {
  code: string;
  constructor(code: string) { super(cloudMessage(code)); this.code = code; }
}
export function cloudMessage(code: string) {
  if (code === 'LOGIN_REQUIRED') return '개인 계정으로 로그인해 주세요.';
  if (code === 'OWNER_REQUIRED') return '등록된 개인 계정으로 로그인해 주세요.';
  return '서버 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
let client: SupabaseClient | null = null;
export function cloudClient() {
  if (!cloudConfigured || typeof window === 'undefined') return null;
  // Keep one auth client across development Fast Refresh cycles.
  const browser = window as Window & { __sesasiCloud?: { signature: string; client: SupabaseClient } };
  const signature = `${url}:${publishableKey}`;
  if (!client) {
    if (browser.__sesasiCloud?.signature === signature) client = browser.__sesasiCloud.client;
    else {
      client = createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'sesasi.cloud.auth.v1' } });
      browser.__sesasiCloud = { signature, client };
    }
  }
  return client;
}
export async function cloudRequest(name: 'weather' | 'transit' | 'discord-sync', params: Record<string, string>, init: RequestInit = {}) {
  const client = cloudClient();
  if (!client) throw new CloudError('LOGIN_REQUIRED');
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new CloudError('LOGIN_REQUIRED');
  const headers = new Headers(init.headers);
  headers.set('apikey', publishableKey); headers.set('Authorization', `Bearer ${data.session.access_token}`);
  // Seoul's route to Open-Meteo timed out in deployment checks; Frankfurt succeeded.
  if (name === 'weather') headers.set('x-region', 'eu-central-1');
  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/${name}?${new URLSearchParams(params)}`, { ...init, headers });
  if (response.status === 401 || response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    throw new CloudError(body?.code === 'OWNER_REQUIRED' ? 'OWNER_REQUIRED' : 'LOGIN_REQUIRED');
  }
  return response;
}

type AuthState = { ready: boolean; session: Session | null };
const initialAuth: AuthState = { ready: false, session: null };
let authState = initialAuth;
let unsubscribe: (() => void) | undefined;
const listeners = new Set<() => void>();
export const getCloudAuth = () => authState;
export const getServerCloudAuth = () => initialAuth;
export function subscribeCloudAuth(listener: () => void) {
  listeners.add(listener);
  if (!unsubscribe) {
    const client = cloudClient();
    if (client) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        authState = { ready: true, session };
        listeners.forEach(fn => fn());
        // Keep auth callbacks synchronous; start API work after the SDK releases its lock.
        setTimeout(() => window.dispatchEvent(new Event('sesasi-cloud-auth')), 0);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; }
  };
}
