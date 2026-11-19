'use client';
import { useState, useSyncExternalStore } from 'react';
import { cloudClient, passwordVerifier, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from '../../cloud';

export default function PasswordForm() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(form: HTMLFormElement) {
    const values = new FormData(form);
    const password = String(values.get("password") ?? "");
    const confirmation = String(values.get("password-confirmation") ?? "");
    if (busy) return;
    setMessage('');
    if (password.length < 8) { setMessage('8자 이상 입력해 주세요.'); return; }
    if (password !== confirmation) { setMessage('입력한 비밀번호가 서로 다릅니다.'); return; }
    const client = cloudClient();
    if (!client || !auth.session) { setMessage('로그인이 필요합니다.'); return; }
    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error && error.code !== 'same_password') {
        setMessage(error.code === 'same_password' ? '현재 비밀번호와 다른 비밀번호를 입력해 주세요.'
          : error.code === 'weak_password' ? '더 긴 비밀번호나 문자·숫자를 조합한 비밀번호를 사용해 주세요.'
          : error.code === 'reauthentication_needed' ? '최근 로그인 인증이 필요합니다. 다시 로그인한 뒤 시도해 주세요.'
          : '비밀번호를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const email = auth.session.user.email;
      if (!email) { setMessage('계정 이메일을 확인하지 못했습니다.'); return; }
      const verifier = passwordVerifier();
      const check = await verifier.auth.signInWithPassword({ email, password });
      if (check.error || !check.data.session || check.data.user?.id !== auth.session.user.id) {
        setMessage('비밀번호 저장 요청은 처리됐지만 새 비밀번호의 로그인 검증을 완료하지 못했습니다. 다시 시도해 주세요.'); return;
      }
      await verifier.auth.signOut({ scope: 'local' });
      form.reset();
      setMessage('비밀번호 저장과 로그인 검증을 완료했습니다. 위 이메일로 로그인해 주세요.');
    } catch { setMessage('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(event.currentTarget); }}>
    <label>이메일<input name="username" type="email" autoComplete="username" value={auth.session?.user.email ?? ''} readOnly/></label>
    <label>새 비밀번호<input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required disabled={busy}/></label>
    <small>8자 이상 입력해 주세요.</small>
    <label>새 비밀번호 확인<input name="password-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required disabled={busy}/></label>
    <label><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)}/>비밀번호 표시</label>
    <button type="submit" disabled={busy || !auth.session}>{busy ? '저장 중…' : '비밀번호 저장'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
