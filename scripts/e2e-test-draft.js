import { saveCtripDraft } from '../src/ctrip-adapter.js';

const product = {
  creation: { contract: '7232940', product_type: '境内短途旅游', product_form: '跟团游', region: 'CN', brand: '职旅意境' },
  basic: {
    title: '自动化测试勿售 厦门3日游', supplier_name: '自动化测试勿售 厦门3日游', subtitle: '自动化测试勿售 厦门鼓浪屿+赶海+海鲜体验',
    days: 3, nights: 2, countries: ['中国'], provinces: ['福建'], cities: ['厦门'], meeting_city: '厦门', destination_city: '厦门',
  },
  highlights: ['品尝当地海鲜特色餐，体验厦门风味'],
  features: '厦门海滨风光+鼓浪屿漫步+赶海体验',
  itinerary: [
    { day: 1, title: '厦门集合-接站-入住酒店', description: '抵达后安排接站并入住酒店' },
    { day: 2, title: '厦门-南普陀寺-鼓浪屿-厦门', description: '按当天实际顺序游览' },
    { day: 3, title: '曾厝垵-环岛路-赶海体验-返程', description: '行程结束后按安排返程' },
  ],
};

const result = await saveCtripDraft({
  product,
  productId: process.argv[2] || '76727209',
  onProgress: (step) => console.log(step),
});
console.log(JSON.stringify(result, null, 2));
