import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLocalApi, memoryStorage } from '../public/local-api.js';
import { createChat } from '../public/core/chat.js';

const seedText = fs.readFileSync(new URL('../public/core/foods.txt', import.meta.url), 'utf8');
const p = (kcal, protein = 0, carbs = 0, fat = 0) => ({ kcal, protein, carbs, fat, fiber: 0, sugar: 0, sodium_mg: 0 });
const IMG = 'data:image/jpeg;base64,AAAA';

const cannedChat = async ({ schemaName }) => {
  if (schemaName === 'label_scan') return { readable: true, product_name: 'Tim Tam Original', brand: "Arnott's", barcode: '9310072001234', serving_size_g: 37, serving_label: '2 biscuits (37 g)', servings_per_container: 5, net_weight_g: 175, per_100g: p(503, 5.5, 63, 25), per_serving: null, ingredients_text: 'x', allergens: [], notes: '' };
  if (schemaName === 'recipe_parse') return { name: 'Chicken rice', total_cooked_g: 2400, portions: 6, warnings: [], questions: [], ingredients: [
    { name: 'chicken thigh, raw', grams: 1000, hidden: false, per_100g: p(121, 19.7, 0, 4.1) }, { name: 'basmati rice, dry', grams: 500, hidden: false, per_100g: p(349, 8, 77, 0.6) }] };
  return { meal_summary: 'rice and banana', scale_reference: 'plate', warnings: [], questions: [{ item_name: 'Rice', question: 'Cooked with oil?', options: ['Yes', 'No'] }], items: [
    { name: 'White rice, cooked', kind: 'single', cooking_method: '', grams: 200, grams_low: 160, grams_high: 240, confidence: 0.8, reasoning: '', saved_product_id: null, per_100g: p(130, 2.7, 28, 0.3), ingredients: [] },
    { name: 'Banana', kind: 'single', cooking_method: '', grams: 118, grams_low: 100, grams_high: 130, confidence: 0.9, reasoning: '', saved_product_id: null, per_100g: p(89, 1.1, 22.8, 0.3), ingredients: [] }] };
};
const make = (storage = memoryStorage(), extra = {}) => createLocalApi({ storage, seedText, chat: cannedChat, ...extra });

test('seeds the database once and persists it', async () => {
  const st = memoryStorage();
  const api = await make(st);
  const n = (await api('/status')).foods;
  assert.ok(n >= 550, `foods ${n}`);
  const api2 = await make(st); // second launch: no duplicate seeding
  assert.equal((await api2('/status')).foods, n);
  const r = await api('/foods/search?q=tim%20tam');
  assert.match(r[0].name, /Tim Tam/);
});

test('diary: add, quick-log from a food, edit, delete, summary', async () => {
  const api = await make();
  const [rice] = await api('/foods/search?q=white rice cooked');
  const { id } = await api('/log/quick', { body: { food_id: rice.id, grams: 200, meal: 'lunch', date: '2026-11-03' } });
  let day = await api('/log?date=2026-11-03');
  assert.equal(day.length, 1);
  assert.equal(day[0].kcal, 260);
  await api(`/log/${id}`, { method: 'PUT', body: { grams: 100, kcal: 130 } });
  assert.equal((await api('/log?date=2026-11-03'))[0].kcal, 130);
  const sum = await api('/summary?from=2026-11-01&to=2026-11-03');
  assert.deepEqual(sum.map((d) => [d.date, d.kcal]), [['2026-11-03', 130]]);
  await api(`/log/${id}`, { method: 'DELETE' });
  assert.equal((await api('/log?date=2026-11-03')).length, 0);
  await assert.rejects(api('/log', { body: { entries: [{ name: 'x', date: 'bad' }] } }), /date/);
});

test('meal photo: analysis, answers become remembered habits, group delete', async () => {
  const api = await make();
  const res = await api('/analyze/meal', { body: { images: [IMG], hint: 'x' } });
  assert.equal(res.items.length, 2);
  assert.equal(res.totals.kcal, Math.round(2 * 130 + 1.18 * 89));
  assert.equal(res.questions[0].options.length, 2);
  await api('/analyze/meal', { body: { images: [IMG], answers: [{ item_name: 'Rice', question: 'Cooked with oil?', answer: 'No' }] } });
  assert.deepEqual((await api('/habits')).map((h) => h.answer), ['No']);
  await assert.rejects(api('/analyze/meal', { body: { images: ['http://evil/x.jpg'] } }), /JPEG/);
  await api('/log', { body: { entries: res.items.map((i) => ({ date: '2026-11-03', name: i.name, grams: i.grams, kcal: i.nutrition.kcal, group_id: 'g1', details: { ingredients: [] } })) } });
  const [first] = await api('/log?date=2026-11-03');
  assert.deepEqual(first.details, { ingredients: [] });
  assert.equal((await api(`/log/${first.id}?group=1`, { method: 'DELETE' })).deleted, 2);
  await api('/habits', { method: 'DELETE' });
  assert.equal((await api('/habits')).length, 0);
});

test('label scan saves a product that is then found by name and barcode', async () => {
  const api = await make();
  const r = await api('/analyze/label', { body: { images: [IMG], thumb: 'data:image/jpeg;base64,BBBB' } });
  assert.ok(r.ok && r.created);
  const again = await api('/analyze/label', { body: { images: [IMG] } });
  assert.equal(again.created, false);
  assert.equal(again.food.id, r.food.id);
  const hit = await api('/foods/search?q=arnotts tim tam original&mine=1');
  assert.equal(hit[0].id, r.food.id);
  assert.equal((await api('/foods/barcode/9310072001234')).food.id, r.food.id);
  await assert.rejects(api('/foods/barcode/1'), /not found/i);
});

test('recipes: parse, save, edit in place, log a portion, remembered for photos', async () => {
  const api = await make();
  const parsed = await api('/recipes/parse', { body: { text: 'chicken rice' } });
  const { food, computed } = await api('/recipes', { body: { name: parsed.name, total_cooked_g: parsed.total_cooked_g, portions: parsed.portions, ingredients: parsed.ingredients } });
  assert.equal(food.source, 'recipe');
  assert.equal(food.serving_g, 400);
  assert.ok(computed.per_portion.kcal > 400 && computed.per_portion.kcal < 700);
  const edited = await api('/recipes', { body: { id: food.id, name: 'Chicken rice', total_cooked_g: 3000, portions: 6, ingredients: JSON.parse(food.recipe).ingredients } });
  assert.equal(edited.food.id, food.id);
  assert.equal(edited.food.serving_g, 500);
  await api('/log/quick', { body: { food_id: food.id, grams: 500, date: '2026-11-03' } });
  assert.equal((await api('/foods/search?q=&mine=1'))[0].id, food.id);
});

test('settings and the key stay private: never returned, validated', async () => {
  const api = await make();
  assert.equal((await api('/status')).has_key, false);
  await assert.rejects(api('/settings/openai', { body: { key: 'nope' } }), /sk-/);
  const key = 'sk-' + 'a'.repeat(40);
  const st = await api('/settings/openai', { body: { key, model: 'gpt-4o-mini' } });
  assert.equal(st.has_key, true);
  assert.equal(st.model, 'gpt-4o-mini');
  assert.ok(!JSON.stringify(await api('/settings')).includes(key));
  assert.ok(!JSON.stringify(await api('/backup')).includes(key));
  await api('/settings', { body: { goal_kcal: 1900, ai_passes: 3 } });
  assert.equal((await api('/settings')).settings.goal_kcal, '1900');
  await api('/settings/openai', { body: { key: '' } });
  assert.equal((await api('/status')).has_key, false);
});

test('backup and restore move everything to a fresh phone', async () => {
  const a = await make();
  const lab = await a('/analyze/label', { body: { images: [IMG] } });
  await a('/log/quick', { body: { food_id: lab.food.id, grams: 37, date: '2026-11-02' } });
  await a('/weights', { body: { kg: 82.5, date: '2026-11-02' } });
  await a('/settings', { body: { goal_kcal: 1850 } });
  await a('/analyze/meal', { body: { images: [IMG], answers: [{ item_name: 'Rice', question: 'q?', answer: 'a' }] } });
  const backup = await a('/backup');
  const b = await make();
  const r = await b('/restore', { body: { data: backup } });
  assert.equal(r.foods, 1);
  const log = await b('/log?date=2026-11-02');
  assert.equal(log.length, 1);
  const food = (await b('/foods/search?q=tim tam&mine=1'))[0];
  assert.equal(log[0].food_id, food.id);
  assert.equal((await b('/weights'))[0].kg, 82.5);
  assert.equal((await b('/settings')).settings.goal_kcal, '1850');
  assert.equal((await b('/habits')).length, 1);
  await assert.rejects(b('/restore', { body: { data: { app: 'other' } } }), /backup/);
});

test('chat client: sends key + schema, maps errors to friendly ones', async () => {
  let sent;
  const ok = createChat({ getKey: () => 'sk-test', getModel: () => 'gpt-4o', fetchImpl: async (url, o) => { sent = { url, ...o, body: JSON.parse(o.body) }; return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }) }; } });
  assert.deepEqual(await ok({ system: 's', userContent: [], schema: { type: 'object' }, schemaName: 'x' }), { a: 1 });
  assert.equal(sent.headers.Authorization, 'Bearer sk-test');
  assert.equal(sent.body.response_format.json_schema.strict, true);
  assert.equal(sent.body.temperature, 0.2);
  const fail = (status, msg) => createChat({ getKey: () => 'k', getModel: () => 'gpt-5', fetchImpl: async () => ({ ok: false, status, text: async () => JSON.stringify({ error: { message: msg } }) }) });
  await assert.rejects(fail(401, 'bad')({ schemaName: 'x', userContent: [] }), (e) => e.code === 'bad_key');
  await assert.rejects(fail(429, 'quota')({ schemaName: 'x', userContent: [] }), (e) => e.code === 'rate_limit');
  await assert.rejects(createChat({ getKey: () => '', getModel: () => 'm' })({ schemaName: 'x', userContent: [] }), (e) => e.code === 'no_key');
});
