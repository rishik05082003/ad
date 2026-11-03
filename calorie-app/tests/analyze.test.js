import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSeed, SEED_FILE } from '../server/seed.js';
import { analyzeMeal, normalizeLabel, ground } from '../server/analyze.js';
import { matchFoods, nameSimilarity } from '../server/match.js';
import { reconcile, scale } from '../server/nutrition.js';

const foods = parseSeed(fs.readFileSync(SEED_FILE, 'utf8')).map((r, i) => ({ id: i + 1, source: 'seed', use_count: 0, brand: '', ...r }));
const per = (kcal, protein = 0, carbs = 0, fat = 0) => ({ kcal, protein, carbs, fat, fiber: 0, sugar: 0, sodium_mg: 0 });
const item = (o) => ({ kind: 'single', cooking_method: '', grams_low: o.grams * 0.8, grams_high: o.grams * 1.2, confidence: 0.8, reasoning: '', saved_product_id: null, ingredients: [], per_100g: per(100), ...o });
const meal = (items) => ({ meal_summary: 'x', scale_reference: 'plate', items, warnings: [], questions: [] });

test('matcher: exact, alias, typo, method words', () => {
  const top = (q) => matchFoods(q, foods, { limit: 1 })[0]?.food.name;
  assert.equal(top('oreo'), 'Oreo');
  assert.equal(top('Oreo cookies'), 'Oreo');
  assert.equal(top('chappati'), 'Roti');
  assert.equal(top('paneer butter masala'), 'Paneer butter masala');
  assert.equal(top('boiled egg'), 'Egg (boiled)');
  assert.equal(top('fried egg'), 'Egg (fried)');
  assert.equal(top('daal'), 'Dal (cooked)');
  assert.equal(top('banana'), 'Banana');
  assert.ok(nameSimilarity('white rice, cooked', 'cooked white rice') > 0.9);
  assert.ok(nameSimilarity('dal tadka', 'white rice') < 0.3);
});

test('saved products beat the seed list on ties', () => {
  const mine = { id: 999, source: 'label', name: 'Oreo Gold', brand: 'Cadbury', aliases: '', kcal: 480, protein: 5, carbs: 70, fat: 20, fiber: 0, sugar: 0, sodium: 0, use_count: 3 };
  const m = matchFoods('oreo gold', [...foods, mine], { limit: 1 })[0];
  assert.equal(m.food.id, 999);
});

test('ground: database wins over model numbers, scaled by grams', () => {
  const g = ground({ name: 'white rice, cooked', per_100g: per(999) }, foods);
  assert.equal(g.source, 'db');
  assert.equal(Math.round(scale(g.per100, 200).kcal), 260);
});

test('ground: poor match falls back to the model numbers', () => {
  const g = ground({ name: 'dragon scale ceviche', per_100g: per(150, 12, 3, 8) }, foods);
  assert.equal(g.source, 'ai');
  assert.equal(g.per100.kcal, 150);
});

test('ground: rejects a database hit that contradicts what was seen', () => {
  const g = ground({ name: 'chicken breast fried crispy', cooking_method: 'fried', per_100g: per(20, 1, 3, 0.1) }, foods, undefined, { accept: 0.5 });
  assert.notEqual(g.source, 'db');
});

test('ground: saved_product_id is trusted', () => {
  const pk = { id: 777, source: 'label', name: 'Protein Wafer', brand: 'X', kcal: 430, protein: 30, carbs: 40, fat: 15, fiber: 0, sugar: 0, sodium: 0 };
  const g = ground({ name: 'wafer bar', saved_product_id: 777, per_100g: per(1) }, [...foods, pk]);
  assert.equal(g.source, 'saved');
  assert.equal(g.per100.protein, 30);
});

test('analyzeMeal: grounds items, splits dishes, merges two passes', async () => {
  const passA = meal([
    item({ name: 'White rice, cooked', grams: 150 }),
    item({ name: 'Dal tadka', kind: 'dish', grams: 180, ingredients: [
      { name: 'toor dal, cooked', grams: 160, hidden: false, per_100g: per(116, 6.8, 20, 0.5) },
      { name: 'ghee', grams: 8, hidden: true, per_100g: per(900, 0, 0, 100) },
    ] }),
  ]);
  const passB = meal([
    item({ name: 'cooked white rice', grams: 170 }),
    item({ name: 'Dal tadka', kind: 'dish', grams: 190, ingredients: [
      { name: 'toor dal cooked', grams: 170, hidden: false, per_100g: per(116, 6.8, 20, 0.5) },
      { name: 'ghee', grams: 6, hidden: true, per_100g: per(900, 0, 0, 100) },
    ] }),
    item({ name: 'Mystery garnish', grams: 5, confidence: 0.3 }),
  ]);
  let n = 0;
  const out = await analyzeMeal({ images: ['data:image/jpeg;base64,AAAA'], hint: '', passes: 2 }, { chat: async () => (n++ ? passB : passA), foods });
  assert.equal(out.items.length, 3);
  const rice = out.items.find((i) => /rice/i.test(i.name));
  assert.equal(rice.grams, 160); // mean of 150 and 170
  assert.equal(rice.source, 'db');
  assert.equal(rice.nutrition.kcal, Math.round(1.6 * 130));
  const dal = out.items.find((i) => /dal/i.test(i.name));
  assert.equal(dal.source, 'ingredients');
  assert.equal(dal.ingredients.length, 2);
  assert.equal(dal.ingredients.find((g) => /ghee/.test(g.name)).hidden, true);
  assert.ok(dal.nutrition.kcal > 150 && dal.nutrition.kcal < 330, `dal kcal ${dal.nutrition.kcal}`);
  const ghost = out.items.find((i) => /garnish/.test(i.name));
  assert.ok(ghost.flags.some((f) => /Only 1 of 2/.test(f)));
  assert.ok(rice.confidence > ghost.confidence);
  assert.equal(out.totals.kcal, out.items.reduce((s, i) => s + i.nutrition.kcal, 0));
});

test('analyzeMeal: survives one failed pass and reports it', async () => {
  let n = 0;
  const out = await analyzeMeal({ images: ['data:x'], passes: 2 }, {
    chat: async () => { if (n++) throw new Error('boom'); return meal([item({ name: 'banana', grams: 118 })]); }, foods,
  });
  assert.equal(out.items.length, 1);
  assert.ok(out.warnings.some((w) => /failed/.test(w)));
});

test('analyzeMeal: all passes failing throws, no images rejected', async () => {
  await assert.rejects(analyzeMeal({ images: ['x'], passes: 1 }, { chat: async () => { throw new Error('nope'); }, foods }), /nope/);
  await assert.rejects(analyzeMeal({ images: [] }, { foods }), /photo/);
});

test('label: per 100 g column preferred, serving info kept', () => {
  const r = normalizeLabel({ readable: true, product_name: 'Oreo', brand: 'Cadbury', barcode: '76 22-2', serving_size_g: 30, serving_label: '3 cookies', servings_per_container: 4, net_weight_g: 120,
    per_100g: { kcal: 478, protein: 4.9, carbs: 69, fat: 20.5, fiber: 2.6, sugar: 37, sodium_mg: 410 }, per_serving: null, ingredients_text: 'x', allergens: [], notes: '' });
  assert.ok(r.ok);
  assert.equal(r.product.kcal, 478);
  assert.equal(r.product.barcode, '76222');
  assert.equal(r.product.serving_g, 30);
});

test('label: per serving only is converted to per 100 g', () => {
  const r = normalizeLabel({ readable: true, product_name: 'Bar', brand: '', barcode: '', serving_size_g: 40, serving_label: '1 bar', servings_per_container: 1, net_weight_g: 40,
    per_100g: null, per_serving: { kcal: 160, protein: 10, carbs: 16, fat: 6, fiber: 4, sugar: 3, sodium_mg: 100 }, ingredients_text: '', allergens: [], notes: '' });
  assert.ok(r.ok);
  assert.equal(r.product.kcal, 400);
  assert.equal(r.product.protein, 25);
  assert.ok(r.warnings.some((w) => /per serving/.test(w)));
});

test('label: unreadable and missing serving size handled', () => {
  assert.equal(normalizeLabel({ readable: false }).ok, false);
  const r = normalizeLabel({ readable: true, serving_size_g: null, per_100g: null, per_serving: { kcal: 100, protein: 1, carbs: 20, fat: 2 } });
  assert.equal(r.ok, false);
  assert.ok(r.needs_serving_size);
});

test('reconcile: kJ mistaken for kcal is fixed, missing kcal is derived', () => {
  const kj = reconcile({ kcal: 2000, protein: 5, carbs: 70, fat: 20 }); // macros imply ~480 kcal
  assert.ok(Math.abs(kj.per100.kcal - 478) < 5);
  assert.ok(kj.warnings.some((w) => /kJ/.test(w)));
  const miss = reconcile({ kcal: 0, protein: 10, carbs: 10, fat: 10 });
  assert.equal(miss.per100.kcal, 170);
});
