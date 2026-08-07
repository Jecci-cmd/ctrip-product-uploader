import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const input = process.argv[2];
const output = process.argv[3] || 'product.yaml';
if (!input) {
  console.error('用法：npm run prepare-product -- 产品资料.txt [product.yaml]');
  process.exit(2);
}

const raw = (await fs.readFile(input, 'utf8')).replace(/\r\n?/g, '\n').trim();
const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
const title = lines[0].replace(/^【([^】]+)】/, '$1');
const dayMatches = [...raw.matchAll(/(?:^|\n)D(\d+)\s*([^\n]*)\n([\s\S]*?)(?=\nD\d+\s|\n服务标准|$)/g)];
const highlightsBlock = raw.match(/【行程特色及亮点】[：:]?([\s\S]*?)(?=\n(?:日期\s+行程安排|D1\s))/)?.[1] || '';
const highlights = [...highlightsBlock.matchAll(/亮点\s*\d+[：:]\s*([^\n]+)/g)].map((m) => m[1].trim());
const packages = [...raw.matchAll(/套餐([^：:\n]+)[：:]\s*([^\n]*?成人价格[：:]\s*(\d+)\s*元?\/人[^\n]*?儿童价格[：:]?\s*(\d+)[^\n]*?房差\s*(\d+))/g)].map((m) => ({
  name: `套餐${m[1].trim()}`,
  description: m[2].trim(),
  adult_price: Number(m[3]),
  child_price: Number(m[4]),
  single_room_supplement: Number(m[5]),
}));

const days = dayMatches.map((m) => {
  const heading = m[2].replace(/\s{2,}/g, ' ').trim();
  const body = m[3].trim();
  const stay = heading.match(/住[：:]\s*([^\s]+)/)?.[1] || '';
  const meals = heading.match(/(不含餐|早中晚餐|早中餐|早晚餐|中晚餐|早餐|中餐|晚餐)/)?.[1] || '';
  return { day: Number(m[1]), title: heading, meals, accommodation: stay, description: body };
});

const serviceStandards = raw.match(/服务标准\s*([\s\S]*?)(?=\n(?:温馨提示|厦门参考酒店|备\s*注|特别说明))/)?.[1]?.trim() || '';
const notices = raw.match(/(?:特别说明|温馨提示)[：:]?\s*([\s\S]*?)(?=\n套餐一[：:]|$)/)?.[1]?.trim() || '';
const daysCount = days.length || Number(title.match(/(\d+)日游/)?.[1] || 0);

const product = {
  meta: {
    source_file: path.resolve(input),
    generated_at: new Date().toISOString(),
    status: 'needs_review',
  },
  basic: {
    title,
    merchant_name: title,
    subtitle: highlights[0]?.slice(0, 12) || '',
    days: daysCount,
    product_type: '团队游',
    destination: '厦门',
    departure_city: '',
    transport: '',
    id_required: true,
  },
  highlights: highlights.slice(0, 3),
  overview: highlightsBlock.trim(),
  itinerary: days,
  service_standards: serviceStandards,
  booking_notices: notices,
  packages,
  schedule: {
    dates: [],
    inventory: 0,
  },
  safety: {
    mode: 'draft_only',
    submit_for_review: false,
    publish: false,
    test_price_floor: 99999,
  },
};

await fs.writeFile(output, YAML.stringify(product, { lineWidth: 0 }), 'utf8');
console.log(`已生成 ${path.resolve(output)}`);
console.log(`识别到：${daysCount} 天行程、${highlights.length} 条亮点、${packages.length} 个套餐。`);
console.log('请补充 departure_city、transport、班期、库存等空字段后再运行 upload。');
