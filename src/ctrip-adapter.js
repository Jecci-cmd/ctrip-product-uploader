import fs from 'node:fs/promises';
import { AUTH_FILE, launch } from './browser.js';

const SAFE_BUTTON = /^(保存|保 存|存为草稿|下一步)$/;

function ctripPlainText(value = '') {
  return String(value)
    .replace(/[【】『』「」《》“”]/g, '')
    .replace(/[，,。.!！?？:：;；_—–~～·&＆]/g, '、')
    .replace(/[^\p{L}\p{N}\s|+◇/（）()、-]/gu, '')
    .replace(/、{2,}/g, '、')
    .trim();
}

function ctripUrl(productId, page = 'base') {
  const urls = {
    base: `https://vbooking.ctrip.com/ivbk/vendor/baseInfoMerge?productId=${productId}&from=vbk`,
    images: `https://vbooking.ctrip.com/product/input/productImageText?productId=${productId}&pattern=1&from=vbk`,
    itinerary: `https://vbooking.ctrip.com/ivbk/vendor/tourdays?productid=${productId}&from=vbk`,
  };
  return urls[page];
}

function zhDateTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

async function configureUnlockedStages(page, productId, onProgress) {
  const steps = [];
  onProgress('保存套餐配置');
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/packageManage?productid=${productId}&istab=1&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: '保存', exact: true }).waitFor({ timeout: 30_000 });
  const supplierCode = page.locator('input[placeholder="请输入供应商服务编号"]');
  if (!(await supplierCode.inputValue()).trim()) await supplierCode.fill(`AUTO-${productId}`);
  const intro = page.locator('textarea:visible').first();
  if (await intro.count() && !(await intro.inputValue()).trim()) await intro.fill('跟团游标准套餐');
  const hotelNo = page.locator('.ant-form-item').filter({ hasText: '是否含有酒店' }).first().locator('input[type=radio][value="F"]');
  if (!await hotelNo.isChecked()) await hotelNo.locator('xpath=ancestor::label[1]').click();
  await page.getByRole('button', { name: '保存', exact: true }).click({ force: true });
  await page.getByText('保存成功', { exact: false }).waitFor({ timeout: 20_000 });
  steps.push('套餐配置');

  onProgress('设置测试价格库存班期');
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/priceInventory?productid=${productId}&istab=1&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3_000);
  if (!(await page.locator('body').innerText()).includes('799')) {
    await page.getByRole('button', { name: '设置价格/库存', exact: true }).click({ force: true });
    const modal = page.locator('.ant-modal:visible').last();
    const start = new Date(); start.setDate(start.getDate() + 13);
    const end = new Date(); end.setDate(end.getDate() + 44);
    await modal.locator('input[placeholder="开始日期"]').first().click({ force: true });
    await page.locator(`.ant-calendar:visible td[title="${zhDateTitle(start)}"]`).first().click({ force: true });
    await page.locator(`.ant-calendar:visible td[title="${zhDateTitle(end)}"]`).last().click({ force: true });
    await modal.locator('input[type=checkbox][value="all"]').locator('xpath=ancestor::label[1]').click();
    const numbers = modal.locator('input[type=number]:not([disabled])');
    for (const [index, value] of ['799', '20', '499'].entries()) if (index < await numbers.count()) await numbers.nth(index).fill(value);
    const send = modal.getByRole('button', { name: '发送审核', exact: true });
    await send.scrollIntoViewIfNeeded();
    const box = await send.boundingBox();
    if (!box) throw new Error('价格库存提交按钮不可见');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await modal.waitFor({ state: 'hidden', timeout: 30_000 });
  }
  steps.push('价格库存班期');

  onProgress('保存条款与高级设置');
  await page.goto(`https://vbooking.ctrip.com/ivbk/vendor/newResourceClause?productid=${productId}&from=vbk&isTab=1`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);
  for (const value of ['10096', '3016']) {
    const radio = page.locator(`input[type=radio][value="${value}"]`);
    if (!await radio.isChecked()) await radio.locator('xpath=ancestor::label[1]').click();
  }
  await page.getByRole('button', { name: '保存', exact: true }).click({ force: true });
  await page.waitForTimeout(1_000);
  steps.push('费用条款');
  await page.goto(`https://vbooking.ctrip.com/product/input/advancedSettings?productId=${productId}&from=vbk`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);
  for (const text of ['不支持', '不赠送', '否', '不展示']) {
    const option = page.getByText(text, { exact: true }).last();
    if (await option.count()) await option.click({ force: true });
  }
  await page.getByRole('button', { name: '保 存', exact: true }).click({ force: true });
  await page.waitForTimeout(1_000);
  steps.push('高级设置');
  return steps;
}

async function selectSearch(page, box, query, match = query, fieldName = match) {
  const selected = await box.evaluate((node) => (node.closest('.ant-select') || node).innerText || '').catch(() => '');
  if (selected.includes(match)) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    // These searchable Ant Selects need the real mouse sequence. A forced
    // click can bypass the component's open handler (notably for meeting and
    // destination city) while still reporting a successful click.
    await box.click();
    const search = box.locator('input').first();
    if (await search.count()) await search.fill(query);
    else {
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(query);
    }
    const dropdown = page.locator('.ant-select-dropdown:visible').last();
    const option = dropdown.getByText(match, { exact: false }).first();
    if (await option.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false)) {
      await option.click({ force: true });
      if (await box.evaluate((node, expected) => ((node.closest('.ant-select') || node).innerText || '').includes(expected), match).catch(() => false)) return;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
  throw new Error(`携程未正确选择${fieldName}“${match}”`);
}

async function safeClick(page, name) {
  if (!SAFE_BUTTON.test(name)) throw new Error(`安全策略拒绝点击：${name}`);
  const button = page.getByRole('button', { name, exact: true }).last();
  if (!await button.count()) throw new Error(`找不到按钮：${name}`);
  await button.click({ force: true });
  if (name === '存为草稿') {
    const confirmation = page.locator('.ant-popover:visible button').filter({ hasText: /确 定|确定/ }).last();
    if (await confirmation.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)) {
      await confirmation.click({ force: true });
      await page.waitForTimeout(1_000);
    }
  }
}

async function chooseCreationOption(page, combo, requested, fieldName, { fallback = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await combo.click({ force: true });
    const dropdown = page.locator('.ant-select-dropdown:visible').last();
    if (!await dropdown.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(700);
      continue;
    }
    const requestedOption = dropdown.getByText(requested, { exact: false }).first();
    if (await requestedOption.count()) {
      await requestedOption.click({ force: true });
      return requested;
    }
    if (fallback) {
      const first = dropdown.locator('[role=option],.ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled)').first();
      if (await first.count()) {
        const selected = (await first.innerText()).trim();
        await first.click({ force: true });
        return selected;
      }
    }
    throw new Error(`${fieldName}“${requested}”不在当前携程账号的可选项中`);
  }
  throw new Error(`携程没有展开“${fieldName}”下拉框，请稍后重试`);
}

async function createProduct(page, product) {
  const creation = product.creation || {};
  if (!creation.contract || !creation.product_type || !creation.product_form || !creation.brand) {
    throw new Error('创建新产品前必须确认合同、产品类型、产品形态和线路品牌');
  }
  await page.goto('https://vbooking.ctrip.com/ivbk/vendor/saleControlMerge?producttype=0&from=vbk', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const contract = page.locator(`input[type=radio][value="${creation.contract}"]`);
  await contract.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  if (!await contract.count()) throw new Error(`当前账号没有合同 ${creation.contract}`);
  // The contract table is populated asynchronously after DOMContentLoaded and
  // may render again once account data arrives. Wait for that initial update,
  // then re-resolve and retry the controlled Ant Design radio when necessary.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
  for (let attempt = 0; attempt < 3 && !await contract.isChecked(); attempt++) {
    await contract.locator('xpath=ancestor::label[1]').click();
    await contract.waitFor({ state: 'attached' });
    await page.waitForFunction(
      (value) => document.querySelector(`input[type="radio"][value="${value}"]`)?.checked === true,
      creation.contract,
      { timeout: 2_000 },
    ).catch(() => {});
    if (!await contract.isChecked()) await page.waitForTimeout(800);
  }
  if (!await contract.isChecked()) throw new Error(`携程未接受合同选择：${creation.contract}，请刷新登录状态后重试`);
  await page.waitForTimeout(1_200);
  const combos = page.locator('[role=combobox]');
  await chooseCreationOption(page, combos.nth(0), creation.product_type, '产品类型');
  await page.waitForTimeout(500);
  await chooseCreationOption(page, combos.nth(1), creation.product_form, '产品形态');
  // This account's creation page represents domestic distribution as CN;
  // city/province names belong to the later basic-information form.
  const region = page.locator('input[type=checkbox][value="CN"]');
  if (await region.count() && !await region.isChecked()) await region.check({ force: true });
  const brandBox = combos.last();
  creation.brand = await chooseCreationOption(page, brandBox, creation.brand, '线路品牌', { fallback: true });
  await safeClick(page, '下一步');
  await page.waitForURL(/productId=|productid=/, { timeout: 30_000 });
  return new URL(page.url()).searchParams.get('productId') || new URL(page.url()).searchParams.get('productid');
}

async function fillBasic(page, product) {
  const b = product.basic;
  await page.goto(ctripUrl(product.ctrip_product_id, 'base'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const numbers = page.locator('.ant-input-number-input');
  await numbers.nth(0).fill(String(b.days));
  await numbers.nth(1).fill(String(b.nights));
  await page.locator('[id="baseInfo.subName"]').fill(ctripPlainText(b.subtitle || b.title).slice(0, 80));
  await page.locator('[id="baseInfo.providerProductName"]').fill(ctripPlainText(b.supplier_name || b.title).slice(0, 400));
  if (!await page.getByText(new RegExp(`${b.cities?.[0] || b.destination_city}\\(中国`)).count()) {
    const boxes = page.locator('[role=combobox]');
    await selectSearch(page, boxes.nth(0), b.countries?.[0] || '中国');
    if (b.provinces?.[0]) await selectSearch(page, boxes.nth(1), b.provinces[0]);
    await selectSearch(page, boxes.nth(2), b.cities?.[0] || b.destination_city);
    await page.getByRole('button', { name: '添加', exact: true }).click({ force: true });
  }
  const meeting = page.locator('input[id="baseInfo.masterDepartureCityId"]').locator('xpath=ancestor::*[@role="combobox"][1]');
  const destination = page.locator('input[id="baseInfo.destinationCityID"]').locator('xpath=ancestor::*[@role="combobox"][1]');
  if (b.meeting_city) await selectSearch(page, meeting, b.meeting_city, b.meeting_city, '集合城市');
  if (b.destination_city) await selectSearch(page, destination, b.destination_city, b.destination_city, '目的城市');
  const line = page.locator('div[id="baseInfo.productLineID"] [role=combobox]');
  if (await line.count() && (await line.innerText()).includes('请选择')) {
    await line.click();
    const first = page.locator('.ant-select-dropdown:visible').last().locator('.ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled),[role=option]:not([aria-disabled=true])').first();
    if (await first.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) await first.click();
    else await page.keyboard.press('Escape');
    if ((await line.innerText()).includes('请选择')) throw new Error('携程未正确选择产品线路');
  }
  const advance = page.locator('.ant-form-item').filter({ has: page.locator('label[for="bookingControls.advanceBooking"]') });
  if (await advance.count()) {
    await advance.locator('.ant-input-number-input').fill('1');
    const time = advance.locator('.ant-time-picker-input');
    if (await time.count() && !await time.inputValue()) {
      await time.click();
      const panel = page.locator('.ant-time-picker-panel:visible');
      const columns = panel.locator('.ant-time-picker-panel-select');
      await columns.nth(0).getByText('22', { exact: true }).click();
      await columns.nth(1).getByText('00', { exact: true }).click();
      await page.keyboard.press('Escape');
    }
  }
  const agency = page.locator('div[id="bookingControls.localInfoIds"] [role=combobox]');
  if (await agency.count() && (await agency.innerText()).includes('请输入')) {
    await agency.click();
    const option = page.locator('.ant-select-dropdown:visible').last().locator('.ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled),[role=option]:not([aria-disabled=true])').first();
    if (await option.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) await option.click();
    else await page.keyboard.press('Escape');
    if ((await agency.innerText()).includes('请输入')) throw new Error('携程未正确选择地接社名称');
  }
  await safeClick(page, '保存');
  await page.waitForTimeout(1_500);
  const errors = await page.locator('.ant-form-explain,.ant-message-error').evaluateAll((nodes) => nodes.map((node) => {
    const label = node.closest('.ant-form-item')?.querySelector('label')?.innerText?.trim();
    return label ? `${label}：${node.innerText}` : node.innerText;
  }));
  if (errors.length) throw new Error(`产品信息保存失败：${errors.join('；')}`);
  await safeClick(page, '下一步');
  await page.waitForTimeout(1_500);
}

async function fillImagesText(page, product) {
  await page.goto(ctripUrl(product.ctrip_product_id, 'images'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const saveButton = page.getByRole('button', { name: '保 存', exact: true }).last();
  const editReadyDeadline = Date.now() + 30_000;
  while (await saveButton.isDisabled().catch(() => true)) {
    if (Date.now() >= editReadyDeadline) throw new Error('携程图文真实表单等待启用超时');
    await page.waitForTimeout(500);
  }
  await page.locator('iframe#ueditor_0').waitFor({ state: 'visible', timeout: 20_000 });
  // One concise recommendation is sufficient for the first-stage draft.
  const descriptions = product.highlights?.slice(0, 1) || [];
  for (let i = 0; i < descriptions.length; i++) {
    const desc = page.locator(`#pmRcmdItems_${i}_rcmdDesc`).first();
    if (!await desc.count()) break;
    const category = page.locator(`#pmRcmdItems_${i}_pmRcmdCategoryId`).first();
    const selected = await category.evaluate((node) => node.closest('.ant-select')?.innerText || '');
    if (!selected || selected.trim() === '空') {
      await category.locator('xpath=ancestor::*[contains(@class,"ant-select-selector")][1]').click().catch((error) => { throw new Error(`打开推荐理由分类失败：${error.message}`); });
      const dropdown = page.locator('.ant-select-dropdown:visible').last();
      const options = dropdown.locator('.ant-select-item-option:not(.ant-select-item-option-disabled)');
      const preferredName = i === 0 ? '特色美食' : '服务保障';
      const preferred = dropdown.locator(`.ant-select-item-option:not(.ant-select-item-option-disabled)[title="${preferredName}"]`).first();
      if (await preferred.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
        await preferred.click().catch((error) => { throw new Error(`选择推荐理由分类失败：${error.message}`); });
      } else {
        const fallback = options.filter({ hasText: '服务保障' }).first();
        await fallback.waitFor({ state: 'visible', timeout: 5_000 });
        await fallback.click().catch((error) => { throw new Error(`选择推荐理由备用分类失败：${error.message}`); });
      }
    }
    await desc.fill(ctripPlainText(descriptions[i]).slice(0, 84));
  }
  if (await saveButton.isDisabled()) throw new Error('推荐理由未被携程接受，请人工检查分类与内容');
  await safeClick(page, '保 存').catch((error) => { throw new Error(`保存产品图文失败：${error.message}`); });
  await page.waitForTimeout(1_500);
  await safeClick(page, '下一步').catch((error) => { throw new Error(`进入每日行程失败：${error.message}`); });
  await page.waitForTimeout(1_500);
}

async function uploadCover(page, productId, coverPath, city) {
  await fs.access(coverPath);
  await page.goto(ctripUrl(productId, 'images'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_500);
  const hasCover = await page.locator('script').evaluateAll((nodes) => nodes.some((node) => node.textContent?.includes('"alreadyHasCoverType":true')));
  const replaceCover = page.getByText('替换封面', { exact: false }).first();
  const coverImage = page.locator('.image-category-container').first().locator('img.cover-effect-image').first();
  const renderedCover = await Promise.race([
    replaceCover.waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false),
    coverImage.waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false),
  ]);
  if (hasCover || renderedCover) return 'already_present';
  const uploadedCandidate = page.locator('.picture-card-wrapper').filter({ hasText: city }).filter({ hasText: '设为封面' }).first();
  if (await uploadedCandidate.count()) {
    // Card actions are intentionally hidden until hover; forcing a click on
    // the hidden link does not trigger the platform action.
    await uploadedCandidate.hover();
    await uploadedCandidate.getByText('设为封面', { exact: true }).click();
    const confirm = page.locator('.ant-popover:visible button,.ant-modal:visible button').filter({ hasText: /确 定|确定/ }).last();
    if (await confirm.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) await confirm.click({ force: true });
    await page.getByText('操作成功', { exact: false }).waitFor({ timeout: 30_000 }).catch(() => {});
    return 'promoted_existing_upload';
  }
  await page.locator('span.add-image-section-text').filter({ hasText: '上传图片' }).first().click({ force: true });
  const entry = page.locator('.uploadpic-modal-addpictext:visible').last();
  await entry.waitFor();
  await entry.scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent('filechooser');
  await entry.click({ force: true });
  await (await chooserPromise).setFiles(coverPath);
  await page.waitForTimeout(1_000);
  const modal = entry.locator('xpath=ancestor::*[contains(@class,"g-layer") or contains(@class,"ant-modal")][1]');
  await modal.locator('#District').fill(city);
  await page.locator('.ant-select-dropdown:visible').last().getByText(city, { exact: false }).first().click({ force: true });
  await modal.locator('#description').fill(`${city}行程实拍风景`);
  if (!await modal.locator('#knowlicense').isChecked()) await modal.locator('#knowlicense').check({ force: true });
  await modal.getByRole('button', { name: '同意并上传', exact: true }).click({ force: true });
  await page.locator('.ant-popover:visible button').last().click({ force: true });
  await page.getByText('操作成功', { exact: false }).waitFor({ timeout: 30_000 });
  return 'uploaded';
}

async function fillItineraryDraft(page, product) {
  await page.goto(ctripUrl(product.ctrip_product_id, 'itinerary'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (await page.getByRole('tab', { name: '行程描述', exact: true }).getAttribute('aria-disabled') === 'true') return { locked: true };
  const draftEdition = page.getByText('草稿', { exact: true });
  await draftEdition.waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await draftEdition.getAttribute('class')).includes('active')) {
    await draftEdition.click({ force: true });
    await page.waitForTimeout(2_000);
  }
  const titles = page.locator('textarea[placeholder*="请输入标题"]');
  await titles.first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(5_000);
  for (let i = 0; i < Math.min(await titles.count(), product.itinerary.length); i++) {
    await titles.nth(i).fill(product.itinerary[i].title.slice(0, 100));
    const day = page.locator(`#td-day-wrap-${i}`);
    const cards = day.locator('[class*="td-day-card--"]');
    let mealIndex = 0;
    for (let j = 0; j < await cards.count(); j++) {
      const card = cards.nth(j);
      const type = (await card.innerText()).split('\n')[0].trim();
      if (type === '集合' || type === '解散') {
        const choices = card.locator('input[type=checkbox]');
        if (await choices.count() && !(await choices.evaluateAll((nodes) => nodes.some((x) => x.checked)))) {
          // Ant Design's hidden checkbox does not reliably dispatch the React
          // change handler when force-clicked. Click its visible option text.
          await card.getByText(type === '集合' ? '集合点' : '解散点', { exact: true }).click();
          await page.waitForTimeout(300);
        }
        const location = card.locator('.ant-select-enabled [role=combobox]').first();
        if (await location.count()) await selectSearch(page, location, '厦门站', '厦门', type === '集合' ? '集合地点' : '解散地点');
        const address = card.locator('input[placeholder="请输入"]:not([disabled])').first();
        if (await address.count() && !await address.inputValue()) await address.fill('厦门站');
      } else if (type === '餐饮') {
        await card.getByText('不限', { exact: true }).first().click({ force: true });
        const mealTypes = ['早餐', '午餐', '晚餐'];
        const title = product.itinerary[i].title || '';
        const explicitlyNone = /不含餐|餐自理/.test(title);
        const compact = title.replace(/早餐/g, '早').replace(/午餐|中餐/g, '中').replace(/晚餐/g, '晚');
        await card.getByText(mealTypes[mealIndex], { exact: true }).first().click({ force: true });
        let radios = card.locator('input[type=radio]');
        let status = await radios.evaluateAll((nodes) => nodes.slice(-4).map((node) => ({ checked: node.checked })));
        const included = (!explicitlyNone && compact.includes(['早', '中', '晚'][mealIndex])) || status[0]?.checked;
        if (status.length === 4) {
          if (!status[0].checked && !status[1].checked) {
            const count = await radios.count();
            await radios.nth(count - (included ? 4 : 3)).click({ force: true });
          }
          radios = card.locator('input[type=radio]');
          status = await radios.evaluateAll((nodes) => nodes.slice(-4).map((node) => ({ checked: node.checked })));
          const count = await radios.count();
          await radios.nth(count - (status[0]?.checked ? 2 : 1)).click({ force: true });
        }
        const notes = card.locator('textarea[placeholder="请输入补充说明"]');
        if (await notes.count() && !await notes.inputValue()) await notes.fill(included ? `${mealTypes[mealIndex]}按行程安排` : `${mealTypes[mealIndex]}费用自理`);
        mealIndex++;
      } else if (type === '酒店') {
        await card.getByText('不限', { exact: true }).first().click({ force: true });
        await card.getByText('使用携程平台酒店', { exact: true }).click({ force: true });
        const hotelCard = product.itinerary[i].cards?.find((x) => x.type === '住宿');
        const hotelName = hotelCard?.name || `${product.basic.destination_city || '当地'}悦华酒店`;
        const combo = card.locator('[role=combobox]').last();
        if (await combo.count()) {
          await combo.click({ force: true });
          await page.keyboard.type(hotelName);
          const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden),.ant-select-dropdown:visible').last();
          const option = dropdown.locator('.ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled),[role=option]').first();
          if (await option.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) await option.click({ force: true });
          else await page.keyboard.press('Enter');
          await page.keyboard.press('Tab');
        }
        const notes = card.locator('textarea[placeholder="请输入补充说明"]');
        // Hotel level aliases such as “准四” and promises such as “或同级”
        // are rejected by Ctrip's audit. The concrete hotel is configured later.
        if (await notes.count()) await notes.fill('');
      }
    }
  }
  // A title/description mentioning attractions does not count as structured
  // sightseeing time. Add one representative POI card when the generated day
  // has none so Ctrip can validate the minimum play duration.
  if (product.itinerary.length > 1) {
    const daySelector = '#td-day-wrap-1';
    const cards = page.locator(`${daySelector} [class*="td-day-card--"]`);
    const types = await cards.evaluateAll((nodes) => nodes.map((node) => (node.innerText || '').split('\n')[0].trim()));
    if (!types.includes('景点')) {
      const day = page.locator(daySelector);
      await day.getByText('景点', { exact: true }).last().evaluate((node) => node.parentElement.click());
      await page.waitForTimeout(300);
      let scenic = page.locator(`${daySelector} [class*="td-day-card--"]`).last();
      await scenic.locator('input[type=radio][value="N"]').first().click({ force: true });
      const numbers = scenic.locator('.ant-input-number-input');
      await numbers.nth(3).fill('3');
      await numbers.nth(4).fill('0');
      await selectSearch(page, scenic.locator('[role=combobox]').nth(2), '鼓浪屿', '鼓浪屿', '景点');
      scenic = page.locator(`${daySelector} [class*="td-day-card--"]`).last();
      await scenic.locator('[role=combobox]').nth(3).click({ force: true });
      await page.locator('.ant-select-dropdown:visible').last().getByText('已含成人儿童门票', { exact: true }).click({ force: true });
      const notes = scenic.locator('textarea[placeholder="请输入补充说明"]');
      if (await notes.count()) await notes.fill('游览鼓浪屿核心景区');
    }
  }
  // The itinerary editor re-renders a whole day after many radio/checkbox
  // changes. Run a fresh-locator normalization pass so no later card is
  // skipped because a previous locator became stale.
  for (let i = 0; i < Math.min(await titles.count(), product.itinerary.length); i++) {
    const daySelector = `#td-day-wrap-${i}`;
    const cardCount = await page.locator(`${daySelector} [class*="td-day-card--"]`).count();
    for (let j = 0; j < cardCount; j++) {
      let card = page.locator(`${daySelector} [class*="td-day-card--"]`).nth(j);
      const type = (await card.innerText()).split('\n')[0].trim();
      if (type === '集合' || type === '解散') {
        const checks = card.locator('input[type=checkbox]');
        if (!(await checks.evaluateAll((nodes) => nodes.some((node) => node.checked)))) {
          await card.getByText(type === '集合' ? '集合点' : '解散点', { exact: true }).click();
          await page.waitForTimeout(300);
        }
        card = page.locator(`${daySelector} [class*="td-day-card--"]`).nth(j);
        const combo = card.locator('[role=combobox]').first();
        if (await combo.count() && !(await card.locator('.ant-select-selection-selected-value').allTextContents()).join('').trim()) {
          await selectSearch(page, combo, '厦门站', '厦门', type === '集合' ? '集合地点' : '解散地点');
        }
        card = page.locator(`${daySelector} [class*="td-day-card--"]`).nth(j);
        const time = card.locator('.ant-time-picker-input').first();
        if (await time.count() && !(await time.inputValue()).trim()) {
          await time.click();
          const panel = page.locator('.ant-time-picker-panel:visible').last();
          const columns = panel.locator('.ant-time-picker-panel-select');
          await columns.nth(0).getByText(type === '集合' ? '08' : '18', { exact: true }).click();
          await columns.nth(1).getByText('00', { exact: true }).click();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(100);
        }
      } else if (type === '景点') {
        const radios = card.locator('input[type=radio]');
        if (!(await radios.evaluateAll((nodes) => nodes.slice(0, 6).some((node) => node.checked)))) {
          await radios.first().click({ force: true });
          await page.waitForTimeout(100);
        }
        card = page.locator(`${daySelector} [class*="td-day-card--"]`).nth(j);
        const typeCombo = card.locator('[role=combobox]').nth(3);
        if ((await typeCombo.innerText()).includes('无需门票')) {
          await typeCombo.click({ force: true });
          await page.locator('.ant-select-dropdown:visible').last().getByText('已含成人儿童门票', { exact: true }).click({ force: true });
        }
      } else if (type === '餐饮') {
        const radios = card.locator('input[type=radio]');
        const timing = await radios.evaluateAll((nodes) => nodes.slice(0, 6).map((node) => node.checked));
        if (!timing.some(Boolean)) {
          await radios.first().click({ force: true });
          await page.waitForTimeout(100);
        }
        card = page.locator(`${daySelector} [class*="td-day-card--"]`).nth(j);
        const normalizedRadios = card.locator('input[type=radio]');
        const status = await normalizedRadios.evaluateAll((nodes) => nodes.slice(-4).map((node) => node.checked));
        if (status.length === 4 && status[0] !== status[2]) {
          const count = await normalizedRadios.count();
          await normalizedRadios.nth(count - (status[0] ? 2 : 1)).click({ force: true });
          await page.waitForTimeout(100);
        }
      } else {
        const radios = card.locator('input[type=radio]');
        if (await radios.count() >= 6 && !(await radios.evaluateAll((nodes) => nodes.slice(0, 6).some((node) => node.checked)))) {
          await radios.first().click({ force: true });
          await page.waitForTimeout(100);
        }
      }
    }
  }
  await safeClick(page, '存为草稿');
  await page.waitForTimeout(2_000);
  return { locked: false };
}

export async function saveCtripDraft({ product, productId, coverPath, onProgress = () => {}, onProductCreated = async () => {} }) {
  await fs.access(AUTH_FILE).catch(() => { throw new Error('携程登录会话不存在，请先运行 npm run login'); });
  const browser = await launch();
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const steps = [];
  const step = async (name, fn) => {
    onProgress(name);
    try { const detail = await fn(); steps.push({ name, status: 'done', detail }); return detail; }
    catch (error) { steps.push({ name, status: 'failed', error: error.message }); throw error; }
  };
  try {
    let id = productId;
    if (!id) {
      id = await step('创建携程未提交产品', () => createProduct(page, product));
      await onProductCreated(String(id));
    }
    product.ctrip_product_id = String(id);
    await step('保存产品基本信息', () => fillBasic(page, product));
    if (coverPath) await step('上传员工授权封面', () => uploadCover(page, id, coverPath, product.basic.destination_city || product.basic.cities?.[0]));
    await step('保存推荐理由和产品特色', () => fillImagesText(page, product));
    const itinerary = await step('保存每日行程草稿', () => fillItineraryDraft(page, product));
    const manualTodos = [];
    if (!coverPath) manualTodos.push('上传并确认封面图后，携程才会解锁行程模块');
    if (itinerary.locked) manualTodos.push('行程模块仍被携程锁定，请先人工确认产品图文并点击下一步');
    manualTodos.push('人工补充或核对推荐理由和产品特色');
    manualTodos.push('人工核对POI、酒店、交通、用餐卡片');
    manualTodos.push('审核无误后回到员工页面，勾选确认并点击“审核通过并继续填写”');
    return { productId: String(id), url: ctripUrl(id, 'base'), reviewUrl: ctripUrl(id, itinerary.locked ? 'images' : 'itinerary'), steps, manualTodos, safety: '未提交审核、未设有效、未开班、未上线' };
  } finally { await browser.close(); }
}

export async function submitItineraryReview({ productId, onProgress = () => {} }) {
  if (!productId) throw new Error('缺少携程产品ID');
  await fs.access(AUTH_FILE).catch(() => { throw new Error('携程登录会话不存在，请先重新登录'); });
  const browser = await launch();
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  try {
    onProgress('打开员工已审核的行程草稿');
    await page.goto(ctripUrl(productId, 'itinerary'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('#td-day-wrap-0').waitFor({ timeout: 30_000 });
    const draftEdition = page.getByText('草稿', { exact: true });
    if (!(await draftEdition.getAttribute('class')).includes('active')) {
      await draftEdition.click({ force: true });
      await page.waitForTimeout(2_000);
    }
    onProgress('代员工提交行程审核');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('无法获取携程页面尺寸');
    // This CTA is fixed at the bottom-right. Coordinate input returns
    // immediately even though Ctrip's async React handler remains pending.
    await page.mouse.click(viewport.width - 80, viewport.height - 24);
    // After server-side validation, no-shopping itineraries show a delayed
    // compliance confirmation whose CTA is “确认保存”.
    const confirm = page.getByRole('button', { name: /确认保存|确定|确认/, exact: true }).last();
    if (await confirm.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(6_000);
    const errors = await page.locator('.ant-form-explain,.ant-message-error').allInnerTexts();
    const uniqueErrors = [...new Set(errors.map((x) => x.trim()).filter(Boolean))];
    const packageTab = page.getByRole('tab', { name: '套餐管理', exact: true });
    const unlocked = await packageTab.count() && await packageTab.getAttribute('aria-disabled') !== 'true';
    if (!unlocked) throw new Error(uniqueErrors.length ? `携程拒绝提交：${uniqueErrors.join('；')}` : '携程尚未解锁套餐管理，请刷新后重试或查看行程审核状态');
    onProgress('行程已提交，第二阶段已解锁');
    const configuredSteps = await configureUnlockedStages(page, productId, onProgress);
    return {
      productId: String(productId),
      status: 'post_review_configured',
      url: page.url(),
      configuredSteps,
      safety: '行程已提交，后续配置已保存；套餐仍无效，产品仍下线',
    };
  } finally { await browser.close(); }
}
