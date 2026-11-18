import { createClient } from '@supabase/supabase-js';
import { HttpError, type Authenticate } from './http.ts';
export const env = (key: string) => Deno.env.get(key);
function required(key: string) { const value = env(key); if (!value) throw new HttpError(503, 'SETUP_REQUIRED'); return value; }
export function adminClient() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
}
export const authenticate: Authenticate = async token => {
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email, confirmed: Boolean(data.user.email_confirmed_at) };
};
