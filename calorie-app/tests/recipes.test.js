import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSeed } from '../public/core/seed.js';
import { SEED_FILE } from '../server/seed.js';
import { analyzeMeal, parseRecipe, memoryBlock, cleanQuestions } from '../public/core/analyze.js';
import { computeRecipe } from '../server/recipes.js';

const foods = parseSeed(fs.readFileSync(SEED_FILE, 'utf8')).map((r, i) => ({ id: i + 1, source: 'seed', use_count: 0, brand: '', ...r }));
const per = (kcal, protein = 0, carbs = 0, fat = 0) => ({ kcal, protein, carbs, fat, fiber: 0, sugar: 0, sodium: 0 });
const p100 = (kcal, protein = 0, carbs = 0, fat = 0) => ({ kcal, protein, carbs, fat, fiber: 0, sugar: 0, sodium_mg: 0 });

test('computeRecipe: per 100 g of the COOKED dish and per portion', () => {
  const r = computeRecipe({
    ingredients: [
      { name: 'rice', grams: 500, per100: per(350, 8, 77, 0.6) },   // 1750 kcal
      { name: 'chicken', grams: 1000, per100: per(120, 20, 0, 4) }, // 1200 kcal
      { name: 'oil', grams: 28, per100: per(884, 0, 0, 100) },      // ~248 kcal
    ],
    total_cooked_g: 2400, portions: 6,
  });
  assert.equal(r.totals.kcal, 1750 + 1200 + 248);
  assert.equal(r.per100.kcal, Math.round((3198 / 2400) * 100));
  assert.equal(r.serving_g, 400);
  assert.ok(Math.abs(r.per_portion.kcal - 3198 / 6) <= 1);
  assert.deepEqual(r.warnings, []);
});

test('computeRecipe: missing cooked weight falls back to raw weight with a warning; odd weights warned', () => {
  const ing = [{ name: 'x', grams: 1000, per100: per(100) }];
  assert.ok(computeRecipe({ ingredients: ing, portions: 4 }).warnings.some((w) => /cooked weight/i.test(w)));
  assert.ok(computeRecipe({ ingredients: ing, total_cooked_g: 100, portions: 1 }).warnings.some((w) => /odd/.test(w)));
  assert.throws(() => computeRecipe({ ingredients: [] }), /ingredient/);
});

test('answers and remembered habits are sent to the model, questions come back structured', async () => {
  let seen = '';
  const out = await analyzeMeal({
    images: ['data:x'], passes: 1,
    answers: [{ item_name: 'Dal tadka', question: 'How much ghee?', answer: '2 tbsp' }],
    habits: [{ item: 'Chai', question: 'Sugar?', answer: '1 tsp' }],
  }, {
    foods,
    chat: async ({ userContent }) => {
      seen = userContent[0].text;
      return { meal_summary: 'x', scale_reference: '', items: [], warnings: [], questions: [
        { item_name: 'Rice', question: 'Cooked with oil?', options: ['Yes', 'No'] },
        { item_name: 'Rice', question: 'cooked with oil?', options: ['Yes'] },
      ] };
    },
  });
  assert.match(seen, /Q: How much ghee\? A: 2 tbsp/);
  assert.match(seen, /Chai: Sugar\? -> 1 tsp/);
  assert.equal(out.questions.length, 1); // duplicate (case-insensitive) removed
  assert.deepEqual(out.questions[0].options, ['Yes', 'No']);
});

test('memoryBlock ignores empty answers; cleanQuestions caps at 4', () => {
  assert.equal(memoryBlock([{ question: 'q', answer: ' ' }], []), '');
  const qs = cleanQuestions([Array.from({ length: 9 }, (_, i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd', 'e'] }))]);
  assert.equal(qs.length, 4);
  assert.equal(qs[0].options.length, 4);
});

test('parseRecipe grounds raw ingredients and keeps the cooked weight / portions', async () => {
  const out = await parseRecipe({ text: '1kg chicken thigh, 500g basmati dry, 2 tbsp oil, made 2.4kg, 6 portions' }, {
    foods,
    chat: async () => ({
      name: 'Chicken rice', total_cooked_g: 2400, portions: 6, warnings: [], questions: [],
      ingredients: [
        { name: 'chicken thigh, raw', grams: 1000, hidden: false, per_100g: p100(121, 19.7, 0, 4.1) },
        { name: 'basmati rice, dry', grams: 500, hidden: false, per_100g: p100(349, 8, 77, 0.6) },
        { name: 'cooking oil', grams: 28, hidden: true, per_100g: p100(884, 0, 100 * 0, 100) },
      ],
    }),
  });
  assert.equal(out.total_cooked_g, 2400);
  assert.equal(out.portions, 6);
  const rice = out.ingredients.find((i) => /basmati/.test(i.name));
  assert.equal(rice.source, 'db');
  assert.ok(rice.per100.kcal > 300, `rice per100 ${rice.per100.kcal} (should be the dry value)`);
  const chicken = out.ingredients.find((i) => /chicken/.test(i.name));
  assert.ok(chicken.per100.kcal < 215 && chicken.per100.kcal > 100, `chicken per100 ${chicken.per100.kcal}`);
  await assert.rejects(parseRecipe({ text: '  ' }, { foods }), /Describe/);
});
