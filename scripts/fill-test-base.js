import { chromium } from 'playwright-core';
import { AUTH_FILE, CHROME } from '../src/browser.js';

const productId = process.argv[2];
if (!productId) throw new Error('缺少产品ID');
const browser = await chromium.launch({ executablePath: CHROME, headless: process.env.HEADLESS !== '0', args: ['--no-sandbox'] });
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

async function searchSelect(box, query, match, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await box.click({ force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.type(query);
      const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
      const option = dropdown.getByText(match, { exact: false }).first();
      await option.waitFor({ state: 'visible', timeout: 8_000 });
      await option.click({ force: true });
      return;
    } catch (error) {
      await page.keyboard.press('Escape');
      if (attempt === 2) throw new Error(`${label}选择失败：${error.message}`);
      await page.waitForTimeout(800);
    }
  }
}

try {
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/baseInfoMerge?productId=${productId}&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);
  const numbers = page.locator('.ant-input-number-input');
  await numbers.nth(0).fill('3');
  await numbers.nth(1).fill('2');
  await page.locator('[id="baseInfo.subName"]').fill('自动化测试勿售 厦门鼓浪屿+赶海+海鲜体验');
  await page.locator('[id="baseInfo.providerProductName"]').fill('自动化测试勿售 厦门3日游');
  const boxes = page.locator('[role=combobox]');
  await searchSelect(boxes.nth(0), '中国', '中国', '国家');
  await searchSelect(boxes.nth(1), '福建', '福建', '省份');
  await searchSelect(boxes.nth(2), '厦门', '厦门', '城市');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await searchSelect(page.locator('input[id="baseInfo.masterDepartureCityId"]').locator('xpath=ancestor::*[@role="combobox"][1]'), '厦门', '厦门', '集合城市');
  await searchSelect(page.locator('input[id="baseInfo.destinationCityID"]').locator('xpath=ancestor::*[@role="combobox"][1]'), '厦门', '厦门', '目的城市');
  await page.waitForTimeout(1_500);
  await page.locator('div[id="baseInfo.productLineID"] [role=combobox]').click({ force: true });
  const lineDropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await lineDropdown.getByText('厦门+鼓浪屿', { exact: true }).waitFor({ state: 'visible' });
  await lineDropdown.getByText('厦门+鼓浪屿', { exact: true }).click({ force: true });
  const advance = page.locator('.ant-form-item').filter({ has: page.locator('label[for="bookingControls.advanceBooking"]') });
  await advance.locator('.ant-input-number-input').fill('1');
  await advance.locator('.ant-time-picker-input').click();
  const timeColumns = page.locator('.ant-time-picker-panel-select');
  await timeColumns.nth(0).getByText('22', { exact: true }).click();
  await timeColumns.nth(1).getByText('00', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('div[id="bookingControls.localInfoIds"] [role=combobox]').click({ force: true });
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last().getByText('深圳市职旅国际旅行社有限公司中山分公司', { exact: true }).click({ force: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存', exact: true }).click({ force: true });
  await page.waitForTimeout(2_000);
  const errors = await page.locator('.ant-form-explain,.ant-message-error').allInnerTexts();
  const errorDetails = await page.locator('.ant-form-explain').evaluateAll((nodes) => nodes.map((node) => ({
    error: node.innerText,
    field: node.closest('.ant-form-item')?.querySelector('label')?.innerText || '',
  })));
  const messages = await page.locator('.ant-message,.ant-notification').allInnerTexts();
  console.log(JSON.stringify({ productId, errors, errorDetails, messages }, null, 2));
  if (errors.length) process.exitCode = 2;
} finally {
  await browser.close();
}
