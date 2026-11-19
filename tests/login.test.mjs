import test from 'node:test';
import assert from 'node:assert/strict';
import { credentials, loginError } from '../app/login/credentials.ts';

test('submits actual autofilled controls and preserves password whitespace and Unicode', () => {
  const form = new FormData();
  form.set('email', '  User@Example.COM ');
  form.set('password', '  암호１２3!  ');
  assert.deepEqual(credentials(form), { email: 'user@example.com', password: '  암호１２3!  ' });
});
test('network and rate limit errors are not misreported as an incorrect password', () => {
  assert.match(loginError({ status: 429 }), /시도가 많/);
  assert.match(loginError({ status: 503 }), /서버/);
  assert.match(loginError({ code: 'invalid_credentials' }), /이메일/);
  assert.match(loginError({ code: 'email_not_confirmed' }), /이메일 인증/);
});
