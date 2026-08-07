import { AUTH_FILE, launch } from '../src/browser.js';
const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.on('response', async (response) => {
  if (response.request().method() !== 'GET') console.log('RESP', response.status(), response.url(), (await response.text().catch(() => '')).slice(0, 1500));
});
page.on('request', (request) => {
  if (request.url().includes('saveTourDailyDetail')) console.log('PAYLOAD', request.postData()?.slice(0, 5000));
});
try {
  await page.goto('https://vbooking.ctrip.com/ivbk/vendor/tourdays?productid=76727209&from=vbk', { waitUntil: 'domcontentloaded' });
  const title = page.locator('textarea[placeholder*="请输入标题"]').first();
  await title.waitFor();
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('厦门集合-接站-入住酒店');
  await page.keyboard.press('Tab');
  console.log('BEFORE', await title.inputValue());
  await page.getByRole('button', { name: '存为草稿', exact: true }).click({ force: true });
  await page.waitForTimeout(1_000);
  console.log('MODALS', await page.locator('.ant-modal:visible,.ant-popover:visible').allInnerTexts());
  const confirm = page.locator('.ant-modal:visible button,.ant-popover:visible button').last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click({ force: true });
  await page.waitForTimeout(5_000);
  console.log('MESSAGES', await page.locator('.ant-message,.ant-notification').allInnerTexts());
  console.log('ERRORS', await page.locator('.ant-form-explain,.ant-message-error').allInnerTexts());
} finally { await browser.close(); }
