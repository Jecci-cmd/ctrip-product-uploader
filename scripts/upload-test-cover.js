import { chromium } from 'playwright-core';
import path from 'node:path';
import { AUTH_FILE, CHROME, ROOT } from '../src/browser.js';

const productId = process.argv[2] || '76727209';
const imagePath = process.argv[3] || path.join(ROOT, 'assets/test-product/bcc65e0801c21d1031dc203d909e4b10.jpg');
const browser = await chromium.launch({ executablePath: CHROME, headless: process.env.HEADLESS !== '0', args: ['--no-sandbox'] });
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

try {
  page.on('request', (request) => {
    if (/upload|image|pic/i.test(request.url()) && request.method() !== 'GET') {
      console.log('REQUEST', request.method(), request.url());
    }
  });
  page.on('response', async (response) => {
    if (/upload|image|pic/i.test(response.url()) && response.request().method() !== 'GET') {
      console.log('RESPONSE', response.status(), response.url(), (await response.text().catch(() => '')).slice(0, 1000));
    }
  });

  await page.goto(`https://vbooking.ctrip.com/product/input/productImageText?productId=${productId}&pattern=1&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3_000);
  await page.locator('span.add-image-section-text').filter({ hasText: '上传图片' }).first().click({ force: true });
  const uploadEntry = page.locator('.uploadpic-modal-addpictext:visible').last();
  await uploadEntry.waitFor();
  const modal = uploadEntry.locator('xpath=ancestor::*[contains(@class,"g-layer") or contains(@class,"ant-modal")][1]');
  const chooserPromise = page.waitForEvent('filechooser');
  await uploadEntry.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(imagePath);
  await page.waitForTimeout(1_500);

  const district = modal.locator('#District');
  await district.fill('厦门');
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await dropdown.getByText('厦门', { exact: false }).first().click();
  await modal.locator('#description').fill('厦门海滨椰树与沙滩风景');
  const license = modal.locator('#knowlicense');
  if (!(await license.isChecked())) await license.check({ force: true });

  await modal.getByRole('button', { name: '同意并上传', exact: true }).click();
  await page.waitForTimeout(500);
  const confirm = page.locator('.ant-popover:visible button').last();
  if (await confirm.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)) {
    await confirm.click({ force: true });
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(8_000);
  console.log('ERRORS', JSON.stringify(await modal.locator('.ant-form-explain,.ant-message-error,.error,.tips').allInnerTexts().catch(() => [])));
  console.log('MODAL_VISIBLE', await modal.isVisible().catch(() => false));
  console.log('MESSAGES', JSON.stringify(await page.locator('.ant-message,.ant-notification').allInnerTexts()));
  await page.screenshot({ path: path.join(ROOT, 'artifacts/upload-cover-result.png'), fullPage: true });
} finally {
  await browser.close();
}
