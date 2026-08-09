import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ensurePrivateDir, launch } from './browser.js';

const CHECK_URL = 'https://vbooking.ctrip.com/ivbk/vendor/home';
const ALLOWED_SAME_SITE = new Set(['Strict', 'Lax', 'None']);

function normalizeSameSite(value) {
  const mapped = { strict: 'Strict', lax: 'Lax', no_restriction: 'None', none: 'None' }[String(value || '').toLowerCase()];
  return ALLOWED_SAME_SITE.has(mapped) ? mapped : 'Lax';
}

export function normalizeCtripCookies(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) {
    const error = new Error('没有读取到携程登录会话，请先在当前浏览器登录携程');
    error.status = 400;
    throw error;
  }
  const cookies = input.map((cookie) => {
    const domain = String(cookie?.domain || '').toLowerCase();
    const name = String(cookie?.name || '');
    const value = String(cookie?.value || '');
    if (!domain.match(/(^|\.)ctrip\.com$/) || !name || name.length > 256 || value.length > 8192) {
      const error = new Error('扩展提交了无效的携程会话数据');
      error.status = 400;
      throw error;
    }
    const normalized = {
      name,
      value,
      domain: domain.startsWith('.') ? domain : `.${domain}`,
      path: String(cookie.path || '/'),
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: normalizeSameSite(cookie.sameSite),
    };
    if (Number.isFinite(cookie.expirationDate) && cookie.expirationDate > 0) normalized.expires = cookie.expirationDate;
    return normalized;
  });
  const unique = new Map(cookies.map((cookie) => [`${cookie.domain}\n${cookie.path}\n${cookie.name}`, cookie]));
  return [...unique.values()];
}

export function normalizeCtripOrigins(input = []) {
  if (!Array.isArray(input) || input.length > 5) {
    const error = new Error('扩展提交了无效的携程本地会话数据'); error.status = 400; throw error;
  }
  return input.map((item) => {
    if (item?.origin !== 'https://vbooking.ctrip.com' || !Array.isArray(item.localStorage) || item.localStorage.length > 100) {
      const error = new Error('扩展提交了无效的携程本地会话数据'); error.status = 400; throw error;
    }
    return {
      origin: item.origin,
      localStorage: item.localStorage.map(({ name, value }) => {
        name = String(name || ''); value = String(value || '');
        if (!name || name.length > 512 || value.length > 65_536) {
          const error = new Error('扩展提交了过大的携程本地会话数据'); error.status = 400; throw error;
        }
        return { name, value };
      }),
    };
  });
}

export async function importCtripSession(rawCookies, { origins = [], authFile = AUTH_FILE, launchBrowser = launch } = {}) {
  const cookies = normalizeCtripCookies(rawCookies);
  origins = normalizeCtripOrigins(origins);
  const browser = await launchBrowser();
  let context;
  try {
    context = await browser.newContext({ storageState: { cookies, origins } });
    const page = await context.newPage();
    await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (new URL(page.url()).pathname.toLowerCase().includes('/login')) {
      const error = new Error('携程会话无效：请在本机完成登录后再点击同步');
      error.status = 401;
      throw error;
    }
    const state = await context.storageState();
    await ensurePrivateDir(path.dirname(authFile));
    const temporary = `${authFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(temporary, authFile);
    await fs.chmod(authFile, 0o600);
    return { ok: true, message: '携程登录会话已同步并验证成功' };
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
