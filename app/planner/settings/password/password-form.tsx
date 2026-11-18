'use client';
import { useState, useSyncExternalStore } from 'react';
import { cloudClient, getCloudAuth, getServerCloudAuth, subscribeCloudAuth } from '../../cloud';

export default function PasswordForm() {
  const auth = useSyncExternalStore(subscribeCloudAuth, getCloudAuth, getServerCloudAuth);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (busy) return;
    setMessage('');
    if (password !== confirmation) { setMessage('입력한 비밀번호가 서로 다릅니다.'); return; }
    const client = cloudClient();
    if (!client || !auth.session) { setMessage('로그인이 필요합니다.'); return; }
    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setMessage(error.code === 'same_password' ? '현재 비밀번호와 다른 비밀번호를 입력해 주세요.'
          : error.code === 'weak_password' ? '더 긴 비밀번호나 문자·숫자를 조합한 비밀번호를 사용해 주세요.'
          : error.code === 'reauthentication_needed' ? '최근 로그인 인증이 필요합니다. 다시 로그인한 뒤 시도해 주세요.'
          : '비밀번호를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setPassword(''); setConfirmation('');
      setMessage('비밀번호가 저장되었습니다. 다른 기기에서도 같은 이메일과 비밀번호로 로그인할 수 있습니다.');
    } catch { setMessage('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <label>이메일<input name="username" type="email" autoComplete="username" value={auth.session?.user.email ?? ''} readOnly/></label>
    <label>새 비밀번호<input name="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
    <small>8자 이상 입력해 주세요.</small>
    <label>새 비밀번호 확인<input name="password-confirmation" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></label>
    <button type="submit" disabled={busy || !auth.session}>{busy ? '저장 중…' : '비밀번호 저장'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
