// Only used when CAL_MOCK_AI=1 (development / demo without a key). Returns canned but realistic answers.
let call = 0;
const p = (kcal, protein, carbs, fat, fiber = 0, sugar = 0, sodium_mg = 0) => ({ kcal, protein, carbs, fat, fiber, sugar, sodium_mg });

export async function mock(schemaName) {
  await new Promise((r) => setTimeout(r, 900));
  if (schemaName === 'label_scan') {
    return {
      readable: true, product_name: 'Oreo Original Cookies', brand: 'Cadbury', barcode: '7622201234567',
      serving_size_g: 30, serving_label: '3 cookies (30 g)', servings_per_container: 4, net_weight_g: 120,
      per_100g: p(478, 4.9, 69, 20.5, 2.6, 37, 410), per_serving: p(143, 1.5, 20.7, 6.2, 0.8, 11, 123),
      ingredients_text: 'Refined wheat flour, sugar, edible vegetable oil (palm), cocoa solids, invert syrup, raising agents, salt, emulsifier (soya lecithin), flavour.',
      allergens: ['wheat', 'soy', 'may contain milk'], notes: '',
    };
  }
  const k = call++ % 2;
  const j = k ? 1.12 : 1;
  return {
    meal_summary: 'Dal tadka with rice, two rotis, a small salad and a glass of chai',
    scale_reference: 'Standard steel thali about 30 cm, katori about 150 ml, roti about 15 cm across.',
    items: [
      { name: 'Dal tadka', kind: 'dish', cooking_method: 'tempered', grams: 180 * j, grams_low: 150, grams_high: 220, confidence: 0.82, reasoning: 'Katori about 1.2 full.', saved_product_id: null, per_100g: p(120, 6, 15, 4, 3.5, 1.5, 350),
        ingredients: [
          { name: 'toor dal, cooked', grams: 160 * j, hidden: false, per_100g: p(116, 6.8, 20, 0.5, 5, 1.5, 5) },
          { name: 'ghee', grams: 7 * j, hidden: true, per_100g: p(900, 0, 0, 100, 0, 0, 2) },
          { name: 'onion', grams: 12, hidden: false, per_100g: p(40, 1.1, 9.3, 0.1, 1.7, 4.2, 4) },
        ] },
      { name: 'White rice, cooked', kind: 'single', cooking_method: 'steamed', grams: 150 * j, grams_low: 120, grams_high: 190, confidence: 0.78, reasoning: 'About 3/4 cup.', saved_product_id: null, per_100g: p(130, 2.7, 28, 0.3, 0.4, 0, 1), ingredients: [] },
      { name: 'Roti', kind: 'single', cooking_method: 'tawa', grams: 80, grams_low: 70, grams_high: 90, confidence: 0.9, reasoning: 'Two medium rotis at 40 g.', saved_product_id: null, per_100g: p(260, 9, 46, 3.7, 7, 1.5, 330), ingredients: [] },
      { name: 'Green salad', kind: 'single', cooking_method: 'raw', grams: 60, grams_low: 40, grams_high: 80, confidence: 0.6, reasoning: 'Small handful of cucumber, onion, tomato.', saved_product_id: null, per_100g: p(20, 1, 4, 0.2, 1.5, 2, 20), ingredients: [] },
      { name: 'Masala chai with sugar', kind: 'drink', cooking_method: 'boiled', grams: 150, grams_low: 120, grams_high: 180, confidence: 0.7, reasoning: 'Small glass.', saved_product_id: null, per_100g: p(60, 1.8, 8.5, 2, 0, 8, 22), ingredients: [] },
    ],
    warnings: [], questions: ['Was the dal tempered in ghee or oil?'],
  };
}
