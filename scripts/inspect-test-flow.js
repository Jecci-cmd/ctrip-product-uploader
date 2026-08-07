import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_FILE, ROOT, launch } from '../src/browser.js';

const productId = process.argv[2] || '76727209';
const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const output = [];

async function snapshot(name) {
  await page.waitForTimeout(2_000);
  const data = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 20000),
    buttons: [...document.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean),
    tabs: [...document.querySelectorAll('[role=tab]')].map((x) => ({ text: x.innerText.trim(), disabled: x.getAttribute('aria-disabled') })),
    inputs: [...document.querySelectorAll('input,textarea,select')].filter((x) => x.offsetParent).map((x) => ({ id: x.id, name: x.name, type: x.type, placeholder: x.placeholder, value: x.value })),
  }));
  output.push({ name, ...data });
  await page.screenshot({ path: path.join(ROOT, 'artifacts', `flow-${name}.png`), fullPage: true });
}

try {
  await page.goto(`https://vbooking.ctrip.com/product/input/productImageText?productId=${productId}&pattern=1&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await snapshot('images-before-next');
  const recommendation = page.locator('#pmRcmdItems_0_rcmdDesc');
  if (await recommendation.count() && !(await recommendation.inputValue())) {
    await page.locator('#pmRcmdItems_0_pmRcmdCategoryId').click({ force: true });
    await page.locator('.ant-select-dropdown:visible').last().getByText('特色美食', { exact: true }).click();
    await recommendation.fill('品尝当地海鲜特色餐，体验厦门风味');
    await page.getByRole('button', { name: '保 存', exact: true }).click();
    await page.waitForTimeout(2_000);
  }
  const next = page.getByRole('button', { name: '下一步', exact: true });
  if (await next.isEnabled()) {
    await next.click();
    await page.waitForTimeout(3_000);
  }
  await snapshot('after-images-next');
  for (const tabName of ['行程描述', '套餐管理', '价格库存班期', '资源配置', '条款维护', '线路及交通', '高级设置']) {
    const tab = page.getByRole('tab', { name: tabName, exact: true });
    if (await tab.count() && (await tab.getAttribute('aria-disabled')) !== 'true') {
      await tab.click();
      await snapshot(tabName);
    }
  }
  await fs.writeFile(path.join(ROOT, 'artifacts', 'test-flow.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output.map(({ name, url, tabs, buttons }) => ({ name, url, tabs, buttons })), null, 2));
} finally {
  await browser.close();
}
