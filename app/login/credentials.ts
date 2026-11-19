// Read the submitted controls, including values filled by password managers.
// Passwords are deliberately not trimmed or normalized.
export function credentials(data: FormData) {
  return { email: String(data.get('email') ?? '').trim().toLowerCase(), password: String(data.get('password') ?? '') };
}
export function loginError(error: { status?: number; code?: string }) {
  if (error.status === 429) return '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.';
  if (error.code === 'invalid_credentials') return '이메일과 비밀번호 조합을 확인해 주세요. 비밀번호를 설정한 계정의 이메일인지 확인하거나 비밀번호를 재설정해 주세요.';
  if (error.code === 'email_not_confirmed') return '이메일 인증이 완료되지 않은 계정입니다.';
  return '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
