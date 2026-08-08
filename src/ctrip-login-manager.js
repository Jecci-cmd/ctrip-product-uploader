import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AUTH_FILE, ensurePrivateDir, launch } from './browser.js';

const LOGIN_URL = 'https://vbooking.ctrip.com/ivbk/accountV2/login';
const CODE_INPUT = 'input:visible[placeholder*="验证码"], input:visible[placeholder*="校验码"], input:visible[name*="code" i], input:visible[id*="code" i]';
const VERIFY_BUTTONS = ['验证', '确定', '提交', '登录'];
const SEND_CODE_TEXT = /发送验证码|获取验证码|获取短信验证码|发送短信|重新发送/;

export class CtripLoginManager {
  constructor({ launchBrowser = launch, authFile = AUTH_FILE, ttlMs = 10 * 60 * 1000 } = {}) {
    this.launchBrowser = launchBrowser;
    this.authFile = authFile;
    this.ttlMs = ttlMs;
    this.tasks = new Map();
  }

  publicTask(task) {
    return { id: task.id, status: task.status, message: task.message, requiresCode: task.status === 'verification_required', createdAt: task.createdAt };
  }

  async start(username, password) {
    if (!String(username || '').trim() || !String(password || '')) {
      const error = new Error('请输入携程账号和密码'); error.status = 400; throw error;
    }
    await this.cancelAll();
    const browser = await this.launchBrowser({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const task = { id: randomUUID(), browser, context, page, status: 'starting', message: '正在连接携程', createdAt: new Date().toISOString() };
    this.tasks.set(task.id, task);
    task.timer = setTimeout(() => this.cancel(task.id, '登录任务已超时，请重新开始').catch(() => {}), this.ttlMs);
    task.timer.unref?.();

    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.getByPlaceholder('请输入用户名/手机号/邮箱').fill(String(username).trim());
      await page.getByPlaceholder('请输入密码').fill(String(password));
      const consent = page.locator('input[type="checkbox"]').first();
      if (await consent.count() && !(await consent.isChecked())) await consent.check({ force: true });
      await page.getByRole('button', { name: '登 录', exact: true }).click();
      await page.waitForTimeout(3_000);
      await this.evaluate(task);
      return this.publicTask(task);
    } catch (error) {
      task.status = 'failed';
      task.message = `携程登录启动失败：${error.message}`;
      await this.closeTask(task, false);
      error.status ||= 502;
      throw error;
    }
  }

  async evaluate(task) {
    if (!task.page.url().includes('/login')) return this.complete(task);
    const codeCount = await task.page.locator(CODE_INPUT).count();
    const bodyText = await task.page.locator('body').innerText().catch(() => '');
    if (codeCount || /验证码|短信验证|安全验证|滑块|拖动/.test(bodyText)) {
      task.status = 'verification_required';
      task.message = codeCount ? '请输入携程页面显示或手机收到的验证码' : '携程要求交互式安全验证，请查看验证画面';
    } else {
      task.status = 'failed';
      task.message = /密码|账号|用户名/.test(bodyText) ? '携程未接受账号或密码，请核对后重试' : '携程仍停留在登录页，请核对账号信息或稍后重试';
    }
    return this.publicTask(task);
  }

  async submitCode(id, code) {
    const task = this.getActive(id);
    if (!String(code || '').trim()) { const error = new Error('请输入验证码'); error.status = 400; throw error; }
    const input = task.page.locator(CODE_INPUT).first();
    if (!(await input.count())) { const error = new Error('当前验证不是文本验证码，请按验证画面提示人工完成'); error.status = 409; throw error; }
    await input.fill(String(code).trim());
    let clicked = false;
    for (const name of VERIFY_BUTTONS) {
      const button = task.page.locator('button:visible').filter({ hasText: name }).last();
      if (await button.count()) { await button.click(); clicked = true; break; }
    }
    if (!clicked) await input.press('Enter');
    await task.page.waitForTimeout(3_000);
    return this.evaluate(task);
  }

  async sendCode(id) {
    const task = this.getActive(id);
    const candidates = task.page.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: SEND_CODE_TEXT });
    const count = await candidates.count();
    if (!count) { const error = new Error('未找到“发送验证码”按钮，请直接点击下方验证画面中的对应位置'); error.status = 409; throw error; }
    const button = candidates.first();
    if (typeof button.isDisabled === 'function' && await button.isDisabled().catch(() => false)) { const error = new Error('发送验证码按钮暂不可用，请稍后再试'); error.status = 409; throw error; }
    await button.click();
    await task.page.waitForTimeout(1_500);
    task.status = 'verification_required';
    task.message = '已点击发送验证码，请查看手机短信；如出现图片验证，请直接点击下方验证画面';
    return this.publicTask(task);
  }

  async clickAt(id, x, y) {
    const task = this.getActive(id);
    const point = { x: Number(x), y: Number(y) };
    const viewport = task.page.viewportSize();
    if (!viewport || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
      const error = new Error('验证画面点击位置无效，请刷新后重试'); error.status = 400; throw error;
    }
    await task.page.mouse.click(point.x, point.y);
    await task.page.waitForTimeout(1_000);
    if (!task.page.url().includes('/login')) return this.complete(task);
    task.status = 'verification_required';
    task.message = '已点击验证画面，请按画面提示继续操作或刷新状态';
    return this.publicTask(task);
  }

  async refresh(id) {
    const task = this.getActive(id);
    return this.evaluate(task);
  }

  async screenshot(id) {
    const task = this.getActive(id);
    return task.page.screenshot({ type: 'png', fullPage: false });
  }

  getActive(id) {
    const task = this.tasks.get(id);
    if (!task || !task.page) { const error = new Error('登录任务不存在或已结束'); error.status = 404; throw error; }
    return task;
  }

  async complete(task) {
    await ensurePrivateDir(path.dirname(this.authFile));
    await task.context.storageState({ path: this.authFile });
    await fs.chmod(this.authFile, 0o600);
    task.status = 'success';
    task.message = '携程登录成功';
    const result = this.publicTask(task);
    await this.closeTask(task, false);
    return result;
  }

  async closeTask(task, keepRecord) {
    clearTimeout(task.timer);
    await task.browser?.close().catch(() => {});
    delete task.browser; delete task.context; delete task.page; delete task.timer;
    if (!keepRecord) this.tasks.delete(task.id);
  }

  async cancel(id, message = '登录任务已取消') {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'cancelled'; task.message = message;
    await this.closeTask(task, false);
  }

  async cancelAll() {
    await Promise.all([...this.tasks.values()].filter((task) => task.page).map((task) => this.cancel(task.id)));
  }
}
