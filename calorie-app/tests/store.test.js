import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-'));
const store = await import('../server/db.js');
const { saveRecipe } = await import('../server/recipes.js');
const { matchFoods } = await import('../public/core/match.js');
store.seedIfNeeded();

test('habits are remembered, updated in place, newest first', () => {
  store.saveHabits([{ item_name: 'Dal tadka', question: 'How much ghee?', answer: '1 tsp' }, { item_name: '', question: 'Cooking style?', answer: 'home' }]);
  store.saveHabits([{ item_name: 'Dal tadka', question: 'how much ghee', answer: '1 tbsp' }]);
  const h = store.listHabits();
  assert.equal(h.length, 2);
  assert.equal(h[0].answer, '1 tbsp');
  store.deleteHabits();
  assert.equal(store.listHabits().length, 0);
});

test('saved recipe is a food: found by name, listed first for photo recognition, editable', () => {
  const { food, computed } = saveRecipe({
    name: 'Sunday chicken rice', total_cooked_g: 2400, portions: 6,
    ingredients: [
      { name: 'chicken thigh, raw', grams: 1000, per100: { kcal: 121, protein: 19.7, carbs: 0, fat: 4.1 } },
      { name: 'basmati rice, dry', grams: 500, per100: { kcal: 349, protein: 8, carbs: 77, fat: 0.6 } },
    ],
    answers: [{ question: 'Skin on?', answer: 'No' }],
  });
  assert.equal(food.source, 'recipe');
  assert.equal(food.serving_g, 400);
  assert.equal(Math.round(food.kcal), computed.per100.kcal);
  assert.equal(JSON.parse(food.recipe).portions, 6);
  assert.equal(matchFoods('sunday chicken rice', store.allFoods(), { limit: 1 })[0].food.id, food.id);
  assert.equal(store.savedProducts(5)[0].id, food.id);

  const again = saveRecipe({ id: food.id, name: 'Sunday chicken rice', total_cooked_g: 3000, portions: 6, ingredients: JSON.parse(food.recipe).ingredients });
  assert.equal(again.food.id, food.id);
  assert.equal(again.food.serving_g, 500);
  assert.equal(store.allFoods().filter((f) => f.name === 'Sunday chicken rice').length, 1);
});
