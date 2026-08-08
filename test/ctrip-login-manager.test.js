import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CtripLoginManager } from '../src/ctrip-login-manager.js';

class FakeLocator {
  constructor(page, kind) { this.page = page; this.kind = kind; }
  async fill(value) { this.page.filled[this.kind] = value; }
  first() { return this; }
  last() { return this; }
  filter(options = {}) { return options.hasText instanceof RegExp ? new FakeLocator(this.page, 'send') : this; }
  async count() { return this.kind === 'code' ? Number(this.page.needsCode) : 1; }
  async isChecked() { return false; }
  async check() { this.page.checked = true; }
  async isDisabled() { return false; }
  async click() {
    if (this.kind === 'login' && !this.page.needsCode) this.page.currentUrl = 'https://vbooking.ctrip.com/ivbk/vendor/home';
    if (this.kind === 'button') this.page.currentUrl = 'https://vbooking.ctrip.com/ivbk/vendor/home';
    if (this.kind === 'send') this.page.sentCode = true;
  }
  async press() { this.page.currentUrl = 'https://vbooking.ctrip.com/ivbk/vendor/home'; }
  async innerText() { return this.page.needsCode ? '请输入短信验证码' : ''; }
}

class FakePage {
  constructor(needsCode) { this.needsCode = needsCode; this.currentUrl = ''; this.filled = {}; this.mouse = { click: async (x, y) => { this.clicked = { x, y }; } }; }
  async goto(url) { this.currentUrl = url; }
  getByPlaceholder(text) { return new FakeLocator(this, text.includes('密码') ? 'password' : 'username'); }
  getByRole() { return new FakeLocator(this, 'login'); }
  locator(selector) {
    if (selector === 'body') return new FakeLocator(this, 'body');
    if (selector.includes('placeholder*="验证码"')) return new FakeLocator(this, 'code');
    if (selector === 'button:visible') return new FakeLocator(this, 'button');
    return new FakeLocator(this, 'other');
  }
  async waitForTimeout() {}
  viewportSize() { return { width: 1280, height: 720 }; }
  url() { return this.currentUrl; }
  async screenshot() { return Buffer.from('png'); }
}

function fakeLauncher(needsCode, captured) {
  return async () => {
    const page = new FakePage(needsCode);
    const context = { newPage: async () => page, storageState: async ({ path: output }) => fs.writeFile(output, '{"cookies":[]}') };
    const browser = { newContext: async () => context, close: async () => { captured.closed = true; } };
    Object.assign(captured, { page });
    return browser;
  };
}

test('账号密码正确时保存携程会话且不保存密码', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrip-login-'));
  const authFile = path.join(dir, 'auth', 'ctrip.json');
  const captured = {};
  const manager = new CtripLoginManager({ launchBrowser: fakeLauncher(false, captured), authFile });
  const result = await manager.start('employee', 'secret-password');
  assert.equal(result.status, 'success');
  assert.equal(captured.closed, true);
  assert.equal(await fs.readFile(authFile, 'utf8'), '{"cookies":[]}');
  assert.doesNotMatch(JSON.stringify([...manager.tasks.values()]), /secret-password/);
});
test('需要验证码时等待员工输入，验证成功后保存会话', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrip-code-'));
  const authFile = path.join(dir, 'auth', 'ctrip.json');
  const captured = {};
  const manager = new CtripLoginManager({ launchBrowser: fakeLauncher(true, captured), authFile });
  const pending = await manager.start('employee', 'secret-password');
  assert.equal(pending.status, 'verification_required');
  const result = await manager.submitCode(pending.id, '123456');
  assert.equal(result.status, 'success');
  assert.equal(captured.page.filled.code, '123456');
  assert.equal(captured.closed, true);
});
test('员工可以发送短信验证码并点击图片验证画面', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctrip-interaction-'));
  const captured = {};
  const manager = new CtripLoginManager({ launchBrowser: fakeLauncher(true, captured), authFile: path.join(dir, 'ctrip.json') });
  const pending = await manager.start('employee', 'secret-password');
  const sent = await manager.sendCode(pending.id);
  assert.equal(sent.status, 'verification_required');
  assert.equal(captured.page.sentCode, true);
  const clicked = await manager.clickAt(pending.id, 640, 360);
  assert.equal(clicked.status, 'verification_required');
  assert.deepEqual(captured.page.clicked, { x: 640, y: 360 });
});
