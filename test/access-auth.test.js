import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessAuth } from '../src/access-auth.js';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; },
  };
}

test('员工访问密码错误时拒绝登录', () => {
  const auth = createAccessAuth({ password: 'correct-password' });
  const res = response();
  auth.login({ body: { password: 'wrong-password' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
test('员工登录后使用 HttpOnly 会话访问 API', () => {
  const auth = createAccessAuth({ password: 'correct-password', secure: true });
  const loginResponse = response();
  auth.login({ body: { password: 'correct-password' } }, loginResponse);
  assert.match(loginResponse.headers['Set-Cookie'], /HttpOnly/);
  assert.match(loginResponse.headers['Set-Cookie'], /Secure/);
  const cookie = loginResponse.headers['Set-Cookie'].split(';')[0];
  assert.equal(auth.authenticated({ headers: { cookie } }), true);

  let allowed = false;
  auth.requireAccess({ headers: { cookie } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('未登录员工访问 API 时返回 401', () => {
  const auth = createAccessAuth({ password: 'correct-password' });
  const res = response();
  auth.requireAccess({ headers: {} }, res, () => assert.fail('不应放行'));
  assert.equal(res.statusCode, 401);
});
