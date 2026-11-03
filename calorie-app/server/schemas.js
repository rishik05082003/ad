// JSON schemas for OpenAI strict structured output (every property required, no extras).
const n = { type: 'number' };
const nn = { type: ['number', 'null'] };
const s = { type: 'string' };

export const per100Schema = (nullable = false) => {
  const t = nullable ? nn : n;
  return {
    type: nullable ? ['object', 'null'] : 'object',
    additionalProperties: false,
    required: ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium_mg'],
    properties: { kcal: t, protein: t, carbs: t, fat: t, fiber: t, sugar: t, sodium_mg: t },
  };
};

export const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meal_summary', 'scale_reference', 'items', 'warnings', 'questions'],
  properties: {
    meal_summary: s,
    scale_reference: { ...s, description: 'What objects you used to judge size (plate diameter, fork, bowl, hand, packaging) and the scale you inferred.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'cooking_method', 'grams', 'grams_low', 'grams_high', 'confidence', 'reasoning', 'saved_product_id', 'per_100g', 'ingredients'],
        properties: {
          name: { ...s, description: 'Specific food name as a database would list it, e.g. "paneer butter masala", "white rice, cooked".' },
          kind: { type: 'string', enum: ['single', 'dish', 'packaged', 'drink'] },
          cooking_method: s,
          grams: { ...n, description: 'Edible weight (ml for drinks) as eaten, in grams.' },
          grams_low: n,
          grams_high: n,
          confidence: { ...n, description: '0 to 1' },
          reasoning: { ...s, description: 'One or two sentences: how you got the weight.' },
          saved_product_id: { type: ['integer', 'null'], description: 'id from the user saved-products list if this is clearly that product, else null' },
          per_100g: per100Schema(),
          ingredients: {
            type: 'array',
            description: 'For kind=dish: components with weights that add up to the dish weight, including hidden oil/butter/cream/sugar. Empty array otherwise.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'grams', 'hidden', 'per_100g'],
              properties: { name: s, grams: n, hidden: { type: 'boolean' }, per_100g: per100Schema() },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: s },
    questions: { type: 'array', items: s, description: 'Things that would sharpen the estimate if the user answered.' },
  },
};

export const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'product_name', 'brand', 'barcode', 'serving_size_g', 'serving_label', 'servings_per_container', 'net_weight_g', 'per_100g', 'per_serving', 'ingredients_text', 'allergens', 'notes'],
  properties: {
    readable: { type: 'boolean', description: 'false if no nutrition information can be read from the image(s)' },
    product_name: s,
    brand: s,
    barcode: { ...s, description: 'Digits under the barcode if visible, else empty string' },
    serving_size_g: { ...nn, description: 'Serving size in grams (or ml) if printed' },
    serving_label: { ...s, description: 'Serving text as printed, e.g. "3 cookies (34 g)"' },
    servings_per_container: nn,
    net_weight_g: nn,
    per_100g: per100Schema(true),
    per_serving: per100Schema(true),
    ingredients_text: s,
    allergens: { type: 'array', items: s },
    notes: s,
  },
};
