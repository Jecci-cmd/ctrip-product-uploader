import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ROOT, launch } from '../src/browser.js';

const productId = process.argv[2] || '74576479';
const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const results = [];
try {
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/baseInfoMerge?productId=${productId}&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  for (const name of ['套餐管理', '价格库存班期', '资源配置', '条款维护', '线路及交通', '高级设置']) {
    const tab = page.getByRole('tab', { name, exact: true });
    if (!await tab.count() || await tab.getAttribute('aria-disabled') === 'true') continue;
    await tab.click();
    await page.waitForTimeout(2_000);
    const item = await page.evaluate((tabName) => ({
      name: tabName, url: location.href, text: document.body.innerText.slice(0, 18000),
      buttons: [...document.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean),
      inputs: [...document.querySelectorAll('input,textarea,select')].filter((x) => x.offsetParent).map((x) => ({ id: x.id, name: x.name, type: x.type, placeholder: x.placeholder, value: x.value })),
    }), name);
    results.push(item);
  }
  await fs.writeFile(path.join(ROOT, 'artifacts', 'existing-tabs.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ name, url, buttons, inputs }) => ({ name, url, buttons, inputCount: inputs.length })), null, 2));
} finally { await browser.close(); }
