import { productSchema } from './product-schema.js';

const cityProvince = { 厦门: '福建', 深圳: '广东', 广州: '广东', 汕头: '广东', 潮州: '广东', 珠海: '广东', 北京: '北京', 上海: '上海', 杭州: '浙江', 成都: '四川', 重庆: '重庆', 西安: '陕西', 三亚: '海南', 海口: '海南', 桂林: '广西', 昆明: '云南', 贵阳: '贵州', 南京: '江苏', 苏州: '江苏', 武汉: '湖北', 长沙: '湖南', 青岛: '山东' };

function applyAccountDefaults(product, raw) {
  product.creation ||= {};
  product.creation.travel_mode ||= '拼团游';
  product.creation.contract ||= process.env.CTRIP_DEFAULT_CONTRACT_ID || '7232940';
  product.creation.product_type ||= process.env.CTRIP_DEFAULT_PRODUCT_TYPE || '境内短途旅游';
  product.creation.product_form ||= '跟团游';
  product.creation.region ||= 'CN';
  product.creation.brand ||= process.env.CTRIP_DEFAULT_BRAND || '职旅意境';
  product.creation.distribution_channels ||= [];
  product.basic.provinces ||= [];
  const city = product.basic.destination_city || product.basic.cities?.[0] || Object.keys(cityProvince).find((name) => raw.includes(name));
  if (city) {
    if (!product.basic.cities?.length) product.basic.cities = [city];
    product.basic.destination_city ||= city;
    product.basic.meeting_city ||= city;
    if (!product.basic.provinces.length && cityProvince[city]) product.basic.provinces = [cityProvince[city]];
  }
  return product;
}

function responseText(body) {
  return body.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
}

async function aiParse(raw, filename) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: '你是团队游产品资料抽取器。只提取原文能支持的信息；不推测合同、品牌、库存、联系人、POI或承诺。补充说明不得重复结构化字段。证据quote必须来自原文。' },
        { role: 'user', content: `文件名：${filename}\n\n${raw}` },
      ],
      text: { format: { type: 'json_schema', name: 'tour_product', strict: true, schema: productSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const text = responseText(await response.json());
  if (!text) throw new Error('OpenAI API 没有返回结构化文本');
  const parsed = JSON.parse(text);
  parsed.source.filename = filename;
  return parsed;
}

async function modelVerseParse(raw, filename) {
  const baseUrl = (process.env.MODELVERSE_BASE_URL || 'https://api.modelverse.cn').replace(/\/$/, '');
  const model = process.env.MODELVERSE_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODELVERSE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: '你是团队游产品资料抽取器。只提取原文能支持的信息；不推测合同、品牌、库存、联系人、POI或服务承诺。补充说明不得重复结构化字段。evidence.quote必须直接来自原文。' }] },
      contents: [{ role: 'user', parts: [{ text: `文件名：${filename}\n\n${raw}` }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: productSchema,
      },
    }),
  });
  if (!response.ok) throw new Error(`ModelVerse API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.json();
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw new Error(body.error?.message || 'ModelVerse API 没有返回结构化文本');
  const parsed = JSON.parse(text);
  parsed.source.filename = filename;
  return parsed;
}

export async function parseMaterial(raw, filename) {
  if (process.env.MODELVERSE_API_KEY) {
    try { return { product: applyAccountDefaults(await modelVerseParse(raw, filename), raw), parser: 'modelverse-gemini', warning: '' }; }
    catch (error) {
      const failure = new Error(`AI 解析失败（ModelVerse）：${error.message}`);
      failure.status = 502;
      throw failure;
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try { return { product: applyAccountDefaults(await aiParse(raw, filename), raw), parser: 'openai', warning: '' }; }
    catch (error) {
      const failure = new Error(`AI 解析失败（OpenAI）：${error.message}`);
      failure.status = 502;
      throw failure;
    }
  }
  const failure = new Error('AI 接口未配置，无法解析产品资料。请配置 MODELVERSE_API_KEY 或 OPENAI_API_KEY 后重试。');
  failure.status = 503;
  throw failure;
}
