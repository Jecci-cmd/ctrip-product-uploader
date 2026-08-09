import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'ctrip_uploader_session';

function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((item) => item.trim().split(/=(.*)/s)).filter(([key]) => key));
}

export function createAccessAuth({ password = process.env.APP_ACCESS_PASSWORD, secure = process.env.COOKIE_SECURE === '1', ttlMs = 12 * 60 * 60 * 1000 } = {}) {
  const sessions = new Map();
  const enabled = Boolean(password);

  function purge() {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(token);
  }

  function authenticated(req) {
    if (!enabled) return true;
    purge();
    const token = cookies(req.headers.cookie)[COOKIE_NAME];
    return Boolean(token && sessions.get(token) > Date.now());
  }

  function requireAccess(req, res, next) {
    if (authenticated(req)) return next();
    return res.status(401).json({ error: '请先登录员工系统' });
  }

  function verifyPassword(candidate) {
    return !enabled || equalSecret(candidate, password);
  }

  function login(req, res) {
    if (!enabled) return res.json({ ok: true, authenticationRequired: false });
    if (!equalSecret(req.body?.password, password)) return res.status(401).json({ error: '访问密码错误' });
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + ttlMs);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`);
    return res.json({ ok: true, authenticationRequired: true });
  }

  function logout(req, res) {
    const token = cookies(req.headers.cookie)[COOKIE_NAME];
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  }

  return { enabled, authenticated, requireAccess, verifyPassword, login, logout };
}
