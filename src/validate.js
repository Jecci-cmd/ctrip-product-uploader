const phone = /(?:\+?86[- ]?)?1[3-9]\d{9}/;
const contact = /(微信|V信|微\s*信|QQ|联系客服|联系导游|客服电话)/i;
const absolute = /(百分百|100%|绝对|保证|全程第一|必定|一定入住|零风险)/i;
const promo = /(返现|立减|优惠\s*\d+\s*元|赠送\s*\d+\s*元)/i;
const disallowedPunctuation = /[！!？?；;：“”"'《》【】★❤✓]/;

export function validateProduct(product) {
  const issues = [];
  const add = (severity, field, message) => issues.push({ severity, field, message });
  if (!product.basic?.title) add('blocker', 'basic.title', '缺少产品标题');
  if (!product.basic?.days) add('blocker', 'basic.days', '缺少行程天数');
  if (!product.itinerary?.length) add('blocker', 'itinerary', '缺少每日行程');
  if (product.basic?.days && product.itinerary?.length && product.basic.days !== product.itinerary.length) add('blocker', 'itinerary', '行程天数与每日行程数量不一致');
  if (!product.creation?.contract) add('confirm', 'creation.contract', '合同必须由员工确认');
  if (!product.creation?.brand) add('confirm', 'creation.brand', '线路品牌必须由员工确认');
  if (!product.creation?.product_type) add('confirm', 'creation.product_type', '产品类型创建后不可修改，必须确认');
  if (!product.schedule?.dates?.length) add('confirm', 'schedule.dates', '班期尚未填写');
  if (!Number.isInteger(product.schedule?.inventory) || product.schedule.inventory <= 0) add('confirm', 'schedule.inventory', '库存尚未填写或不合法');
  if (!product.packages?.length) add('blocker', 'packages', '至少需要一个套餐');
  const texts = [];
  const collect = (field, value) => { if (value) texts.push([field, String(value)]); };
  collect('basic.title', product.basic?.title); collect('basic.subtitle', product.basic?.subtitle); collect('features', product.features);
  product.highlights?.forEach((x, i) => collect(`highlights.${i}`, x));
  product.itinerary?.forEach((d, i) => { collect(`itinerary.${i}.title`, d.title); collect(`itinerary.${i}.description`, d.description); d.cards?.forEach((c, j) => collect(`itinerary.${i}.cards.${j}.notes`, c.notes)); });
  for (const [field, text] of texts) {
    if (phone.test(text) || contact.test(text)) add('blocker', field, '不得包含私人联系方式或引导联系客服话术');
    if (absolute.test(text)) add('blocker', field, '包含无法保证或绝对化表述');
    if (promo.test(text)) add('blocker', field, '不得录入带具体金额的优惠、返现或促销信息');
    if (disallowedPunctuation.test(text)) add('warning', field, '包含规则外标点，请人工检查');
  }
  if ((product.highlights?.length || 0) > 3) add('blocker', 'highlights', '推荐理由最多3条');
  if ((product.basic?.subtitle || '').length > 80) add('blocker', 'basic.subtitle', '副标题超过80字');
  const counts = { blocker: issues.filter((x) => x.severity === 'blocker').length, confirm: issues.filter((x) => x.severity === 'confirm').length, warning: issues.filter((x) => x.severity === 'warning').length };
  return { issues, counts, canCreateDraft: counts.blocker === 0, readyForPublish: counts.blocker === 0 && counts.confirm === 0 };
}
