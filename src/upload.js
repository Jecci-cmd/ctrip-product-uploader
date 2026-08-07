import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AUTH_FILE, ROOT, launch } from './browser.js';

const args = new Set(process.argv.slice(2));
const file = process.argv.slice(2).find((x) => !x.startsWith('--'));
const fillMode = args.has('--fill') || args.has('--save-draft');
const saveDraft = args.has('--save-draft');
const testMode = args.has('--test');
if (!file) {
  console.error('用法：npm run upload -- product.yaml [--fill] [--save-draft] [--test]');
  process.exit(2);
}

const product = YAML.parse(await fs.readFile(file, 'utf8'));
const errors = [];
for (const [field, value] of Object.entries({
  'basic.title': product.basic?.title,
  'basic.days': product.basic?.days,
  'basic.destination': product.basic?.destination,
  itinerary: product.itinerary?.length,
  packages: product.packages?.length,
})) if (!value) errors.push(`缺少 ${field}`);
if (product.safety?.submit_for_review || product.safety?.publish) errors.push('安全设置禁止提交审核或发布');
if (testMode) {
  const floor = product.safety?.test_price_floor || 99999;
  for (const p of product.packages || []) {
    p.adult_price = Math.max(p.adult_price || 0, floor);
    p.child_price = Math.max(p.child_price || 0, floor);
    p.single_room_supplement = Math.max(p.single_room_supplement || 0, floor);
  }
  product.basic.title = `【自动化测试-勿售】${product.basic.title}`;
}
if (errors.length) {
  console.error(errors.map((x) => `- ${x}`).join('\n'));
  process.exit(2);
}

console.log(`校验通过：${product.basic.title}`);
console.log(`行程 ${product.itinerary.length} 天，套餐 ${product.packages.length} 个。`);
if (testMode) console.log(`测试保护已启用：所有套餐价格不低于 ${product.safety?.test_price_floor || 99999} 元。`);
if (!fillMode) {
  console.log('当前为安全预检模式，没有登录，也没有改动携程。加 --fill 才会打开后台并填表。');
  process.exit(0);
}

await fs.access(AUTH_FILE).catch(() => {
  console.error('没有登录会话，请先运行 npm run login。');
  process.exit(2);
});
const browser = await launch();
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
const artifacts = path.join(ROOT, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });

async function fillByText(names, value) {
  if (value === undefined || value === null || value === '') return false;
  for (const name of names) {
    const byLabel = page.getByLabel(name, { exact: false }).first();
    if (await byLabel.count() && await byLabel.isVisible().catch(() => false)) {
      await byLabel.fill(String(value));
      return true;
    }
    const label = page.locator('label', { hasText: name }).first();
    if (await label.count()) {
      const box = label.locator('xpath=following::*[self::input or self::textarea or @contenteditable="true"][1]');
      if (await box.count() && await box.isVisible().catch(() => false)) {
        await box.fill(String(value));
        return true;
      }
    }
  }
  return false;
}

try {
  await page.goto('https://vbooking.ctrip.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (page.url().includes('/login')) throw new Error('登录会话已过期，请重新登录。');
  await page.getByText('产品管理', { exact: true }).first().click();
  await page.waitForTimeout(1_500);
  const create = page.getByText(/新增产品|新建产品|创建产品/).first();
  if (!(await create.count())) throw new Error('找不到“新增产品”入口，后台界面可能已更新。请运行 inspect 并提供 artifacts。');
  await create.click();
  await page.waitForTimeout(1_500);

  const results = {};
  results.days = await fillByText(['天数', '行程天数'], product.basic.days);
  results.subtitle = await fillByText(['副标题'], product.basic.subtitle);
  results.merchantName = await fillByText(['商家产品名称', '供应商产品名称'], product.basic.merchant_name);
  results.destination = await fillByText(['目的地'], product.basic.destination);
  results.departureCity = await fillByText(['出发城市', '出发地'], product.basic.departure_city);
  results.overview = await fillByText(['推荐概述', '产品概述'], product.overview);
  for (let i = 0; i < Math.min(3, product.highlights?.length || 0); i++) {
    results[`highlight${i + 1}`] = await fillByText([`推荐理由${i + 1}`, `卖点${i + 1}`], product.highlights[i]);
  }
  await page.screenshot({ path: path.join(artifacts, 'filled-draft.png'), fullPage: true });
  await fs.writeFile(path.join(artifacts, 'fill-report.json'), JSON.stringify({ url: page.url(), results }, null, 2));

  if (saveDraft) {
    const button = page.getByRole('button', { name: /保存(草稿)?$/, exact: false }).first();
    if (!(await button.count())) throw new Error('没有找到明确的“保存草稿/保存”按钮，因此未点击任何按钮。');
    const label = (await button.innerText()).trim();
    if (/提交|审核|发布|上线/.test(label)) throw new Error(`拒绝点击高风险按钮：${label}`);
    await button.click();
    console.log('已点击保存草稿；没有提交审核、发布或上线。');
  } else {
    console.log('已填入可识别字段并生成截图；未保存、未提交、未发布。');
  }
  console.log(`字段报告：${path.join(artifacts, 'fill-report.json')}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'upload-error.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
