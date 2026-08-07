import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ROOT, ensurePrivateDir, launch } from './browser.js';

const username = process.env.CTRIP_USERNAME;
const password = process.env.CTRIP_PASSWORD;
if (!username || !password) {
  console.error('请通过环境变量 CTRIP_USERNAME 和 CTRIP_PASSWORD 提供登录信息。');
  process.exit(2);
}

const artifacts = path.join(ROOT, 'artifacts');
await ensurePrivateDir(path.dirname(AUTH_FILE));
await fs.mkdir(artifacts, { recursive: true });

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto('https://vbooking.ctrip.com/ivbk/accountV2/login', {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.getByPlaceholder('请输入用户名/手机号/邮箱').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  const consent = page.locator('input[type="checkbox"]');
  if (!(await consent.isChecked())) await consent.check({ force: true });
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await page.waitForTimeout(4_000);

  if (page.url().includes('/login')) {
    if (process.env.HEADLESS === '0') {
      console.log('请在打开的浏览器中手动完成验证码；脚本最多等待 5 分钟。');
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 300_000 });
    }
  }

  if (page.url().includes('/login')) {
    await page.screenshot({ path: path.join(artifacts, 'login-blocked.png'), fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1000);
    throw new Error(`登录未完成，可能需要验证码或二次验证。当前页面：${text}`);
  }

  await context.storageState({ path: AUTH_FILE });
  await fs.chmod(AUTH_FILE, 0o600);
  console.log(`登录成功，会话已安全保存到 ${AUTH_FILE}`);
} finally {
  await browser.close();
}
