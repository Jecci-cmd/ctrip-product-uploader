import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCtripCookies, normalizeCtripOrigins, importCtripSession } from '../src/ctrip-session-importer.js';

const cookie = { name: 'session', value: 'abc', domain: '.ctrip.com', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 2_000_000_000 };

test('将浏览器扩展 Cookie 转换为 Playwright storageState 格式', () => {
  assert.deepEqual(normalizeCtripCookies([cookie]), [{ name: 'session', value: 'abc', domain: '.ctrip.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: 2_000_000_000 }]);
  assert.throws(() => normalizeCtripCookies([{ ...cookie, domain: '.example.com' }]), /无效/);
});

test('只接受携程供应商域名的本地会话', () => {
  const origins = [{ origin: 'https://vbooking.ctrip.com', localStorage: [{ name: 'token', value: 'value' }] }];
  assert.deepEqual(normalizeCtripOrigins(origins), origins);
  assert.throws(() => normalizeCtripOrigins([{ ...origins[0], origin: 'https://example.com' }]), /无效/);
});

test('验证通过后才原子保存携程会话', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrip-import-'));
  const authFile = path.join(dir, '.auth', 'ctrip.json');
  const page = { goto: async () => {}, url: () => 'https://vbooking.ctrip.com/ivbk/vendor/home' };
  const context = { newPage: async () => page, storageState: async () => ({ cookies: [cookie], origins: [] }), close: async () => {} };
  const launchBrowser = async () => ({ newContext: async () => context, close: async () => {} });
  await importCtripSession([cookie], { authFile, launchBrowser });
  const saved = JSON.parse(await fs.readFile(authFile, 'utf8'));
  assert.equal(saved.cookies[0].name, 'session');
});

test('仍在登录页时拒绝保存会话', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrip-import-'));
  const authFile = path.join(dir, 'ctrip.json');
  const page = { goto: async () => {}, url: () => 'https://vbooking.ctrip.com/ivbk/accountV2/login' };
  const context = { newPage: async () => page, storageState: async () => ({ cookies: [] }), close: async () => {} };
  const launchBrowser = async () => ({ newContext: async () => context, close: async () => {} });
  await assert.rejects(importCtripSession([cookie], { authFile, launchBrowser }), /会话无效/);
  await assert.rejects(fs.access(authFile));
});
