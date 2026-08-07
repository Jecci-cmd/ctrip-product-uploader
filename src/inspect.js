import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ROOT, launch } from './browser.js';

await fs.access(AUTH_FILE).catch(() => {
  console.error('没有登录会话，请先运行 npm run login。');
  process.exit(2);
});

const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
const artifacts = path.join(ROOT, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
try {
  await page.goto(process.env.CTRIP_TARGET || 'https://vbooking.ctrip.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (page.url().includes('/login')) throw new Error('登录会话已过期，请重新运行 npm run login。');
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    links: [...document.querySelectorAll('a')].map((a) => ({ text: a.innerText.trim(), href: a.href })).filter((x) => x.text),
    buttons: [...document.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
    labels: [...document.querySelectorAll('label')].map((l) => l.innerText.trim()).filter(Boolean),
    inputs: [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].map((e) => ({
      tag: e.tagName, type: e.type || '', placeholder: e.getAttribute('placeholder') || '', name: e.getAttribute('name') || '',
    })),
  }));
  await fs.writeFile(path.join(artifacts, 'page-inspection.json'), JSON.stringify(snapshot, null, 2));
  await page.screenshot({ path: path.join(artifacts, 'page-inspection.png'), fullPage: true });
  console.log(JSON.stringify(snapshot, null, 2));
} finally {
  await browser.close();
}
