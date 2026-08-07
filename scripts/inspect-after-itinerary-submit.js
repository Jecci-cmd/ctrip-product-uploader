import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ROOT, launch } from '../src/browser.js';

const productId = process.argv[2] || '76727209';
const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const results = [];

async function snapshot(name) {
  await page.waitForTimeout(2_000);
  const data = await page.evaluate((label) => ({
    name: label, url: location.href, text: document.body.innerText.slice(0, 25000),
    buttons: [...document.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean),
    tabs: [...document.querySelectorAll('[role=tab]')].map((x) => ({ text: x.innerText.trim(), disabled: x.getAttribute('aria-disabled') })),
    inputs: [...document.querySelectorAll('input,textarea,select')].filter((x) => x.offsetParent).map((x) => ({ id: x.id, name: x.name, type: x.type, placeholder: x.placeholder, value: x.value })),
  }), name);
  results.push(data);
  await page.screenshot({ path: path.join(ROOT, 'artifacts', `stage2-${name}.png`), fullPage: true });
}

try {
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/tourdays?productid=${productId}&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const title = await page.locator('body').innerText();
  if (!title.includes('自动化测试勿售')) throw new Error('安全保护：仅允许对“自动化测试勿售”产品执行检查');
  await snapshot('before-submit');
  const submit = page.getByRole('button', { name: '提交审核并下一步', exact: true });
  if (await submit.count()) {
    await submit.click({ force: true });
    await page.waitForTimeout(800);
    const confirm = page.locator('.ant-modal:visible button,.ant-popover:visible button').filter({ hasText: /确 定|确定|提交/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click({ force: true });
    await page.waitForTimeout(4_000);
  }
  await snapshot('after-submit');
  for (const name of ['套餐管理', '价格库存班期', '资源配置', '条款维护', '线路及交通', '高级设置']) {
    const tab = page.getByRole('tab', { name, exact: true });
    if (await tab.count() && await tab.getAttribute('aria-disabled') !== 'true') {
      await tab.click();
      await snapshot(name);
    }
  }
  await fs.writeFile(path.join(ROOT, 'artifacts', 'stage2-tabs.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ name, url, buttons, tabs, inputs }) => ({ name, url, buttons, tabs, inputCount: inputs.length })), null, 2));
} finally { await browser.close(); }
