export const productSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'creation', 'basic', 'highlights', 'features', 'itinerary', 'packages', 'schedule', 'terms', 'evidence'],
  properties: {
    source: { type: 'object', additionalProperties: false, required: ['filename'], properties: { filename: { type: 'string' } } },
    creation: {
      type: 'object', additionalProperties: false,
      required: ['travel_mode', 'contract', 'product_type', 'product_form', 'region', 'brand', 'distribution_channels'],
      properties: {
        travel_mode: { type: 'string', enum: ['', '拼团游', '独立出游'] },
        contract: { type: 'string' }, product_type: { type: 'string' }, product_form: { type: 'string' },
        region: { type: 'string' }, brand: { type: 'string' },
        distribution_channels: { type: 'array', items: { type: 'string' } },
      },
    },
    basic: {
      type: 'object', additionalProperties: false,
      required: ['title', 'supplier_name', 'subtitle', 'days', 'nights', 'countries', 'cities', 'attractions', 'meeting_city', 'destination_city', 'service_language'],
      properties: {
        title: { type: 'string' }, supplier_name: { type: 'string' }, subtitle: { type: 'string' },
        days: { type: 'integer', minimum: 0 }, nights: { type: 'integer', minimum: 0 },
        countries: { type: 'array', items: { type: 'string' } }, provinces: { type: 'array', items: { type: 'string' } }, cities: { type: 'array', items: { type: 'string' } },
        attractions: { type: 'array', items: { type: 'string' } }, meeting_city: { type: 'string' },
        destination_city: { type: 'string' }, service_language: { type: 'string' },
      },
    },
    highlights: { type: 'array', maxItems: 3, items: { type: 'string' } },
    features: { type: 'string' },
    itinerary: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['day', 'title', 'description', 'cards'],
        properties: {
          day: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' },
          cards: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['type', 'name', 'city', 'included', 'duration_minutes', 'notes'],
            properties: {
              type: { type: 'string', enum: ['住宿', '交通', '餐饮', '景点', '自由活动', '购物', '集合接驳'] },
              name: { type: 'string' }, city: { type: 'string' }, included: { type: ['boolean', 'null'] },
              duration_minutes: { type: ['integer', 'null'] }, notes: { type: 'string' },
            },
          } },
        },
      },
    },
    packages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'description', 'adult_price', 'child_price', 'single_room_supplement'], properties: { name: { type: 'string' }, description: { type: 'string' }, adult_price: { type: ['number', 'null'] }, child_price: { type: ['number', 'null'] }, single_room_supplement: { type: ['number', 'null'] } } } },
    schedule: { type: 'object', additionalProperties: false, required: ['dates', 'inventory'], properties: { dates: { type: 'array', items: { type: 'string' } }, inventory: { type: ['integer', 'null'] } } },
    terms: { type: 'object', additionalProperties: false, required: ['service_standards', 'booking_notices'], properties: { service_standards: { type: 'string' }, booking_notices: { type: 'string' } } },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'quote', 'confidence'], properties: { field: { type: 'string' }, quote: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } } } },
  },
};

export function emptyProduct(filename = '') {
  return {
    source: { filename }, creation: { travel_mode: '拼团游', contract: '', product_type: '', product_form: '跟团游', region: 'CN', brand: '', distribution_channels: [] },
    basic: { title: '', supplier_name: '', subtitle: '', days: 0, nights: 0, countries: ['中国'], provinces: [], cities: [], attractions: [], meeting_city: '', destination_city: '', service_language: '普通话' },
    highlights: [], features: '', itinerary: [], packages: [], schedule: { dates: [], inventory: null },
    terms: { service_standards: '', booking_notices: '' }, evidence: [],
  };
}
