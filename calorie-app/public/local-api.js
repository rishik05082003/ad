// The whole backend, running inside the phone's browser. Same routes as server/index.js, so app.js does not care
// which one it talks to. Data lives in IndexedDB (see local-storage.js); the OpenAI key lives there too, on the
// phone only, and requests go straight from the phone to OpenAI. No server, no account.
import { searchFoods, matchFoods, normalize } from './core/match.js';
import { parseSeed } from './core/seed.js';
import { analyzeMeal, analyzeLabel, parseRecipe } from './core/analyze.js';
import { buildRecipe, computeRecipe } from './core/recipes.js';
import { createChat } from './core/chat.js';
import { offBarcode, offSearch } from './core/off.js';
import { scale, todayStr, NUTRIENTS } from './core/nutrition.js';

const STORE_KEY = { foods: 'id', log: 'id', weights: 'date', habits: 'k', kv: 'key' };

/** In-memory storage with the same interface as the IndexedDB one. Used by tests. */
export function memoryStorage(initial = {}) {
  const data = { foods: [], log: [], weights: [], habits: [], kv: [], ...initial };
  return {
    async load() { return structuredClone(data); },
    async put(store, obj) {
      const k = STORE_KEY[store]; const c = structuredClone(obj);
      const i = data[store].findIndex((x) => x[k] === obj[k]);
      if (i >= 0) data[store][i] = c; else data[store].push(c);
    },
    async putMany(store, objs) { for (const o of objs) await this.put(store, o); },
    async del(store, key) { data[store] = data[store].filter((x) => x[STORE_KEY[store]] !== key); },
    async clear(store) { data[store] = []; },
  };
}

const DEF = { brand: '', aliases: '', kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, serving_g: 100, serving_label: '100 g', category: 'other', source: 'custom', barcode: '', ingredients: '', thumb: '', recipe: '', use_count: 0, seed_key: null };
const FOOD_FIELDS = ['name', 'brand', 'aliases', ...NUTRIENTS, 'serving_g', 'serving_label', 'category', 'source', 'barcode', 'ingredients', 'thumb', 'recipe'];
const pickFields = (o) => Object.fromEntries(FOOD_FIELDS.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };
const hnorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const httpErr = (status, message, code) => Object.assign(new Error(message), { status, code });
const isImage = (u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(u);

export async function createLocalApi({ storage, seedText, fetchImpl = (...a) => fetch(...a), chat: chatOverride }) {
  const snap = await storage.load();
  const foods = snap.foods;
  const log = snap.log;
  let weights = snap.weights;
  let habits = snap.habits;
  const kv = Object.fromEntries(snap.kv.map((r) => [r.key, r.value]));
  let nextFood = foods.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  let nextLog = log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  const setKv = async (key, value) => { kv[key] = value; await storage.put('kv', { key, value }); };
  const delKv = async (key) => { delete kv[key]; await storage.del('kv', key); };

  const chat = chatOverride || createChat({ getKey: () => kv['secret:openai_key'] || '', getModel: () => kv['secret:model'] || 'gpt-4o', fetchImpl });
  const aiStatus = () => ({ has_key: !!kv['secret:openai_key'], key_source: kv['secret:openai_key'] ? 'phone' : null, model: kv['secret:model'] || 'gpt-4o', mock: false, local: true });

  // ---------- foods
  async function seed() {
    const hash = hashStr(seedText);
    if (kv.seed_hash === hash) return;
    const bySeed = new Map(foods.filter((f) => f.seed_key).map((f) => [f.seed_key, f]));
    const changed = [];
    for (const r of parseSeed(seedText)) {
      const key = r.name.toLowerCase(); const ex = bySeed.get(key);
      if (ex) { const nf = { ...ex, ...r, seed_key: key, source: 'seed' }; foods[foods.indexOf(ex)] = nf; changed.push(nf); }
      else { const nf = { ...DEF, ...r, seed_key: key, source: 'seed', id: nextFood++, created_at: new Date().toISOString() }; foods.push(nf); changed.push(nf); }
    }
    await storage.putMany('foods', changed);
    await setKv('seed_hash', hash);
  }
  await seed();

  const getFood = (id) => foods.find((f) => f.id === id) || null;
  async function insertFood(rec) {
    const f = { ...DEF, ...pickFields(rec), id: nextFood++, created_at: new Date().toISOString() };
    foods.push(f); await storage.put('foods', f); return f;
  }
  async function updateFood(id, patch) {
    const i = foods.findIndex((f) => f.id === id); if (i < 0) return null;
    const nf = { ...foods[i], ...pickFields(patch) }; if (patch.use_count !== undefined) nf.use_count = patch.use_count;
    foods[i] = nf; await storage.put('foods', nf); return nf;
  }
  async function bumpUse(id) { const f = getFood(id); if (f) { f.use_count = (f.use_count || 0) + 1; await storage.put('foods', f); } }
  const savedProducts = (limit = 60) => foods.filter((f) => f.source !== 'seed')
    .sort((a, b) => (b.source === 'recipe') - (a.source === 'recipe') || b.use_count - a.use_count || b.id - a.id).slice(0, limit);

  async function saveProduct(p, { thumb = '', source = 'label' } = {}) {
    const rec = { name: p.name, brand: p.brand || '', aliases: p.aliases || '', kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber, sugar: p.sugar, sodium: p.sodium, serving_g: p.serving_g || 100, serving_label: p.serving_label || '100 g', category: p.category || 'packaged', source, barcode: p.barcode || '', ingredients: p.ingredients || '', thumb };
    let existing = rec.barcode ? foods.find((f) => f.barcode === rec.barcode) : null;
    if (!existing && rec.brand) {
      const hit = matchFoods(`${rec.brand} ${rec.name}`, foods.filter((f) => f.source !== 'seed'), { limit: 1, min: 0.9 })[0];
      if (hit && normalize(hit.food.brand) === normalize(rec.brand)) existing = hit.food;
    }
    if (existing && existing.source !== 'seed') return { food: await updateFood(existing.id, { ...rec, thumb: thumb || existing.thumb }), created: false };
    return { food: await insertFood(rec), created: true };
  }

  // ---------- habits
  let lastTs = 0;
  async function saveHabits(list) {
    for (const h of list || []) {
      if (!h?.question || !String(h.answer || '').trim()) continue;
      lastTs = Math.max(Date.now(), lastTs + 1);
      const row = { k: `${hnorm(h.item_name)}|${hnorm(h.question)}`, item: String(h.item_name || '').slice(0, 80), question: String(h.question).slice(0, 200), answer: String(h.answer).slice(0, 200), updated_at: lastTs };
      const i = habits.findIndex((x) => x.k === row.k); if (i >= 0) habits[i] = row; else habits.push(row);
      await storage.put('habits', row);
    }
    habits.sort((a, b) => b.updated_at - a.updated_at);
    for (const old of habits.splice(60)) await storage.del('habits', old.k);
  }
  const listHabits = (limit = 25) => [...habits].sort((a, b) => b.updated_at - a.updated_at).slice(0, limit).map(({ item, question, answer }) => ({ item, question, answer }));
  const cleanAnswers = (a) => (Array.isArray(a) ? a : []).slice(0, 12)
    .map((x) => ({ item_name: String(x?.item_name || '').slice(0, 80), question: String(x?.question || '').slice(0, 200), answer: String(x?.answer || '').slice(0, 200) }))
    .filter((x) => x.question && x.answer.trim());
  const cleanImages = (arr) => {
    if (!Array.isArray(arr) || !arr.length) throw httpErr(400, 'Add at least one photo.');
    if (arr.length > 4) throw httpErr(400, 'Max 4 photos at a time.');
    if (!arr.every(isImage)) throw httpErr(400, 'Photos must be JPEG, PNG or WebP.');
    return arr;
  };

  // ---------- routes
  const routes = [];
  const route = (m, p, f) => routes.push({ m, re: new RegExp(`^${p.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), f });
  const settingsOut = () => Object.fromEntries(Object.entries(kv).filter(([k]) => k.startsWith('set:')).map(([k, v]) => [k.slice(4), v]));

  route('GET', '/status', async () => ({ ...aiStatus(), foods: foods.length, today: todayStr() }));

  route('GET', '/foods/search', async ({ query }) => searchFoods(query.q || '', foods, { limit: Math.min(100, +query.limit || 40), category: query.category || '', mine: query.mine === '1' }).map((r) => r.food));
  route('GET', '/foods/categories', async () => {
    const c = {}; for (const f of foods) c[f.category] = (c[f.category] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  });
  route('GET', '/foods/barcode/:code', async ({ params }) => {
    const code = params.code.replace(/\D/g, '');
    const local = code && foods.find((f) => f.barcode === code);
    if (local) return { food: local, where: 'local' };
    try { const p = await offBarcode(code, fetchImpl); if (p) return { off: p, where: 'off' }; } catch { /* offline */ }
    throw httpErr(404, 'Barcode not found. Scan the label with the camera instead and it will be remembered.');
  });
  route('GET', '/foods/:id', async ({ params }) => { const f = getFood(+params.id); if (!f) throw httpErr(404, 'Not found'); return f; });
  route('POST', '/foods', async ({ body }) => {
    if (!body.name?.trim()) throw httpErr(400, 'Name is required');
    const per = body.per === 'serving' && body.serving_g > 0
      ? Object.fromEntries(NUTRIENTS.map((k) => [k, ((Number(body[k]) || 0) * 100) / body.serving_g]))
      : Object.fromEntries(NUTRIENTS.map((k) => [k, Number(body[k]) || 0]));
    return (await saveProduct({ ...body, ...per, aliases: body.aliases || '' }, { source: 'custom', thumb: body.thumb || '' })).food;
  });
  route('PUT', '/foods/:id', async ({ params, body }) => {
    const cur = getFood(+params.id);
    if (!cur) throw httpErr(404, 'Not found');
    if (cur.source === 'seed') throw httpErr(403, 'Built-in foods are read-only. Save a copy as your own food instead.');
    const keep = ['name', 'brand', 'aliases', ...NUTRIENTS, 'serving_g', 'serving_label', 'category', 'barcode'];
    return updateFood(cur.id, Object.fromEntries(keep.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])));
  });
  route('DELETE', '/foods/:id', async ({ params }) => {
    const i = foods.findIndex((f) => f.id === +params.id);
    if (i < 0 || foods[i].source === 'seed') throw httpErr(403, 'Only your own foods can be deleted');
    foods.splice(i, 1); await storage.del('foods', +params.id); return { ok: true };
  });
  route('GET', '/off/search', async ({ query }) => {
    if (!query.q) return [];
    try { return await offSearch(query.q, query.world === '1' ? '' : 'australia', fetchImpl); } catch (e) { throw httpErr(502, `Online search unavailable: ${e.message}`); }
  });
  route('POST', '/off/import', async ({ body }) => { const { food, created } = await saveProduct(body.product, { source: 'off' }); return { food, created }; });

  // ---------- AI
  route('POST', '/analyze/meal', async ({ body }) => {
    const images = cleanImages(body.images);
    const answers = cleanAnswers(body.answers);
    await saveHabits(answers);
    return analyzeMeal({ images, hint: String(body.hint || '').slice(0, 500), passes: Number(kv['set:ai_passes'] || 2), answers, habits: listHabits() }, { chat, foods, saved: savedProducts(60) });
  });
  route('POST', '/analyze/label', async ({ body }) => {
    const images = cleanImages(body.images);
    const r = await analyzeLabel({ images, hint: String(body.hint || '').slice(0, 300) }, { chat });
    if (r.ok && body.save !== false) { const { food, created } = await saveProduct(r.product, { thumb: String(body.thumb || ''), source: 'label' }); r.food = food; r.created = created; }
    return r;
  });
  route('POST', '/recipes/parse', async ({ body }) => {
    const answers = cleanAnswers(body.answers); await saveHabits(answers);
    return parseRecipe({ text: String(body.text || '').slice(0, 4000), answers, habits: listHabits() }, { chat, foods });
  });
  route('POST', '/recipes/compute', async ({ body }) => computeRecipe(body));
  route('POST', '/recipes', async ({ body }) => {
    const { rec, computed } = buildRecipe(body, getFood);
    const ex = body.id ? getFood(+body.id) : null;
    const food = ex && ex.source === 'recipe' ? await updateFood(ex.id, rec) : await insertFood(rec);
    return { food, computed };
  });
  route('GET', '/habits', async () => listHabits(60));
  route('DELETE', '/habits', async () => { habits = []; await storage.clear('habits'); return { ok: true }; });

  // ---------- diary
  route('GET', '/log', async ({ query }) => log.filter((e) => e.date === (query.date || todayStr())).sort((a, b) => a.id - b.id));
  async function addLog(e) {
    const row = { date: e.date, meal: e.meal || 'snack', name: String(e.name).slice(0, 120), grams: Number(e.grams) || 0, ...Object.fromEntries(NUTRIENTS.map((k) => [k, Number(e[k]) || 0])), food_id: e.food_id ?? null, group_id: e.group_id || '', source: e.source || 'manual', confidence: e.confidence ?? null, details: e.details || null, thumb: e.thumb || '', id: nextLog++, created_at: new Date().toISOString() };
    log.push(row); await storage.put('log', row); if (row.food_id) await bumpUse(row.food_id); return row.id;
  }
  route('POST', '/log', async ({ body }) => {
    const list = Array.isArray(body.entries) ? body.entries : [body];
    if (!list.length || list.length > 60) throw httpErr(400, 'Nothing to log');
    const ids = [];
    for (const e of list) {
      if (!e.name || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw httpErr(400, 'Each entry needs a name and a date');
      ids.push(await addLog(e));
    }
    return { ids };
  });
  route('PUT', '/log/:id', async ({ params, body }) => {
    const i = log.findIndex((e) => e.id === +params.id); if (i < 0) throw httpErr(404, 'Not found');
    const { id, created_at, ...patch } = body;
    log[i] = { ...log[i], ...patch }; await storage.put('log', log[i]); return log[i];
  });
  route('DELETE', '/log/:id', async ({ params, query }) => {
    const e = log.find((x) => x.id === +params.id); if (!e) throw httpErr(404, 'Not found');
    const doomed = query.group === '1' && e.group_id ? log.filter((x) => x.group_id === e.group_id) : [e];
    for (const d of doomed) { log.splice(log.indexOf(d), 1); await storage.del('log', d.id); }
    return { deleted: doomed.length };
  });
  route('POST', '/log/quick', async ({ body }) => {
    const f = getFood(+body.food_id); if (!f) throw httpErr(404, 'Food not found');
    const grams = Number(body.grams) || f.serving_g;
    return { id: await addLog({ date: body.date || todayStr(), meal: body.meal || 'snack', name: f.name, grams, ...scale(f, grams), food_id: f.id, source: 'search' }) };
  });
  route('GET', '/summary', async ({ query }) => {
    const to = query.to || todayStr(); const from = query.from || todayStr(new Date(Date.now() - 13 * 86400000));
    const by = new Map();
    for (const e of log) {
      if (e.date < from || e.date > to) continue;
      const d = by.get(e.date) || { date: e.date, kcal: 0, protein: 0, carbs: 0, fat: 0, entries: 0 };
      d.kcal += e.kcal; d.protein += e.protein; d.carbs += e.carbs; d.fat += e.fat; d.entries++; by.set(e.date, d);
    }
    return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
  });

  // ---------- weight, settings
  const sortedWeights = () => [...weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
  route('GET', '/weights', async () => sortedWeights());
  route('POST', '/weights', async ({ body }) => {
    const kg = Number(body.kg);
    if (!(kg > 20 && kg < 400)) throw httpErr(400, 'Enter a weight in kg');
    const row = { date: body.date || todayStr(), kg };
    const i = weights.findIndex((w) => w.date === row.date); if (i >= 0) weights[i] = row; else weights.push(row);
    await storage.put('weights', row); return sortedWeights();
  });
  route('DELETE', '/weights/:date', async ({ params }) => { weights = weights.filter((w) => w.date !== params.date); await storage.del('weights', params.date); return sortedWeights(); });
  route('GET', '/settings', async () => ({ settings: settingsOut(), ai: aiStatus() }));
  route('POST', '/settings', async ({ body }) => {
    for (const k of ['goal_kcal', 'goal_protein', 'goal_carbs', 'goal_fat', 'sex', 'age', 'height_cm', 'weight_kg', 'activity', 'weekly_loss_kg', 'ai_passes', 'tdee']) if (body[k] !== undefined) await setKv(`set:${k}`, String(body[k]));
    return { settings: settingsOut(), ai: aiStatus() };
  });
  route('POST', '/settings/openai', async ({ body }) => {
    if (body.key !== undefined) {
      const k = String(body.key).trim();
      if (k && !/^sk-[A-Za-z0-9_\-]{20,}$/.test(k)) throw httpErr(400, 'That does not look like an OpenAI key (it starts with sk-).');
      if (k) await setKv('secret:openai_key', k); else await delKv('secret:openai_key');
    }
    if (body.model !== undefined) { const m = String(body.model).trim(); if (m) await setKv('secret:model', m); else await delKv('secret:model'); }
    return aiStatus();
  });

  // ---------- backup (phone storage can be wiped by the OS, so offer a file)
  route('GET', '/backup', async () => ({ app: 'leanmode', version: 1, exported_at: new Date().toISOString(), foods: foods.filter((f) => f.source !== 'seed'), log, weights, habits, settings: settingsOut() }));
  route('POST', '/restore', async ({ body }) => {
    const d = body.data;
    if (d?.app !== 'leanmode' || !Array.isArray(d.log) || !Array.isArray(d.foods)) throw httpErr(400, 'That is not a LeanMode backup file.');
    for (const f of foods.filter((x) => x.source !== 'seed')) await storage.del('foods', f.id);
    for (let i = foods.length - 1; i >= 0; i--) if (foods[i].source !== 'seed') foods.splice(i, 1);
    const idMap = new Map();
    for (const f of d.foods) { const { id: old, ...rest } = f; const nf = await insertFood({ ...rest }); await updateFood(nf.id, { use_count: f.use_count || 0 }); idMap.set(old, nf.id); }
    log.length = 0; await storage.clear('log'); nextLog = 1;
    for (const e of d.log) { const row = { ...e, id: nextLog++, food_id: e.food_id != null ? (idMap.get(e.food_id) ?? e.food_id) : null }; log.push(row); await storage.put('log', row); }
    weights = d.weights || []; await storage.clear('weights'); await storage.putMany('weights', weights);
    habits = d.habits || []; await storage.clear('habits'); await storage.putMany('habits', habits);
    for (const [k, v] of Object.entries(d.settings || {})) await setKv(`set:${k}`, String(v));
    return { ok: true, foods: d.foods.length, entries: d.log.length };
  });

  return async function api(path, opts = {}) {
    const method = opts.method || (opts.body ? 'POST' : 'GET');
    const url = new URL(path, 'http://local');
    for (const r of routes) {
      if (r.m !== method) continue;
      const m = url.pathname.match(r.re); if (!m) continue;
      const out = await r.f({ params: m.groups || {}, query: Object.fromEntries(url.searchParams), body: opts.body ? JSON.parse(JSON.stringify(opts.body)) : {} });
      return out === undefined ? out : JSON.parse(JSON.stringify(out)); // callers never touch internal state
    }
    throw httpErr(404, 'No such endpoint');
  };
}
