import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProduct } from '../src/product-schema.js';
import { validateProduct } from '../src/validate.js';

function validProduct() {
  const p = emptyProduct('test.txt');
  Object.assign(p.creation, { contract: '境内合同', product_type: '境内短途旅游', brand: '测试品牌' });
  Object.assign(p.basic, { title: '厦门3日跟团游', days: 3, nights: 2 });
  p.itinerary = [1, 2, 3].map((day) => ({ day, title: `第${day}天行程`, description: '真实行程', cards: [] }));
  p.packages = [{ name: '基础套餐', description: '', adult_price: 1000, child_price: 800, single_room_supplement: 300 }];
  p.schedule = { dates: ['2026-09-01'], inventory: 10 };
  return p;
}

test('完整草稿可以进入携程录入', () => {
  const result = validateProduct(validProduct());
  assert.equal(result.canCreateDraft, true);
  assert.equal(result.counts.blocker, 0);
});

test('联系方式和绝对承诺会阻止录入', () => {
  const p = validProduct();
  p.features = '保证入住，详情加微信13800138000';
  const result = validateProduct(p);
  assert.equal(result.canCreateDraft, false);
  assert.ok(result.issues.filter((x) => x.field === 'features' && x.severity === 'blocker').length >= 2);
});

test('行程天数不一致会阻止录入', () => {
  const p = validProduct();
  p.itinerary.pop();
  assert.ok(validateProduct(p).issues.some((x) => x.field === 'itinerary' && x.severity === 'blocker'));
});

test('班期库存待确认时仍可先保存携程草稿', () => {
  const p = validProduct();
  p.schedule = { dates: [], inventory: null };
  const result = validateProduct(p);
  assert.equal(result.canCreateDraft, true);
  assert.equal(result.readyForPublish, false);
  assert.equal(result.counts.confirm, 2);
});
