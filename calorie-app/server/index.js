import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './db.js';
import { searchFoods } from './match.js';
import { analyzeMeal, analyzeLabel, parseRecipe } from './analyze.js';
import { saveRecipe, computeRecipe } from './recipes.js';
import { saveProduct, offBarcode, offSearch } from './products.js';
import { getApiKey, keySource, setApiKey, getModel, setModel } from './config.js';
import { AIError } from './openai.js';
import { scale, todayStr, NUTRIENTS } from './nutrition.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 40 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const seeded = store.seedIfNeeded();
if (seeded) console.log(`Food database ready: ${seeded} foods loaded`);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Upload too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
  req.on('error', reject);
});

const isImage = (u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(u);
const cleanImages = (arr) => {
  if (!Array.isArray(arr) || !arr.length) throw new HttpError(400, 'Add at least one photo.');
  if (arr.length > 4) throw new HttpError(400, 'Max 4 photos at a time.');
  if (!arr.every(isImage)) throw new HttpError(400, 'Photos must be JPEG, PNG or WebP.');
  return arr;
};
const settingsOut = () => ({ ...store.allSettings() });
const cleanAnswers = (a) => (Array.isArray(a) ? a : []).slice(0, 12)
  .map((x) => ({ item_name: String(x?.item_name || '').slice(0, 80), question: String(x?.question || '').slice(0, 200), answer: String(x?.answer || '').slice(0, 200) }))
  .filter((x) => x.question && x.answer.trim());
const toFood = (f) => f && ({ ...f, aliases: f.aliases || '' });

const aiStatus = () => ({ has_key: !!getApiKey() || !!process.env.CAL_MOCK_AI, key_source: process.env.CAL_MOCK_AI ? 'mock' : keySource(), model: getModel(), mock: !!process.env.CAL_MOCK_AI });

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/status', async () => ({ ...aiStatus(), foods: store.allFoods().length, today: todayStr() }));

// ----- foods
route('GET', '/api/foods/search', async ({ query }) => {
  const res = searchFoods(query.q || '', store.allFoods(), { limit: Math.min(100, +query.limit || 40), category: query.category || '', mine: query.mine === '1' });
  return res.map((r) => toFood(r.food));
});
route('GET', '/api/foods/categories', async () => {
  const c = {}; for (const f of store.allFoods()) c[f.category] = (c[f.category] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
});
route('GET', '/api/foods/barcode/:code', async ({ params }) => {
  const code = params.code.replace(/\D/g, '');
  const local = store.foodByBarcode(code);
  if (local) return { food: toFood(local), where: 'local' };
  try { const p = await offBarcode(code); if (p) return { off: p, where: 'off' }; } catch { /* offline */ }
  throw new HttpError(404, 'Barcode not found. Scan the label with the camera instead and it will be remembered.');
});
route('GET', '/api/foods/:id', async ({ params }) => { const f = store.getFood(+params.id); if (!f) throw new HttpError(404, 'Not found'); return toFood(f); });
route('POST', '/api/foods', async ({ body }) => {
  if (!body.name?.trim()) throw new HttpError(400, 'Name is required');
  const f = body.per === 'serving' && body.serving_g > 0 ? Object.fromEntries(NUTRIENTS.map((k) => [k, (Number(body[k]) || 0) * 100 / body.serving_g])) : Object.fromEntries(NUTRIENTS.map((k) => [k, Number(body[k]) || 0]));
  const { food } = saveProduct({ ...body, ...f, aliases: body.aliases || '' }, { source: 'custom', thumb: body.thumb || '' });
  return toFood(food);
});
route('PUT', '/api/foods/:id', async ({ params, body }) => {
  const cur = store.getFood(+params.id);
  if (!cur) throw new HttpError(404, 'Not found');
  if (cur.source === 'seed') throw new HttpError(403, 'Built-in foods are read-only. Save a copy as your own food instead.');
  const keep = ['name', 'brand', 'aliases', ...NUTRIENTS, 'serving_g', 'serving_label', 'category', 'barcode'];
  return toFood(store.updateFood(cur.id, Object.fromEntries(keep.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]))));
});
route('DELETE', '/api/foods/:id', async ({ params }) => { if (!store.deleteFood(+params.id)) throw new HttpError(403, 'Only your own foods can be deleted'); return { ok: true }; });
route('GET', '/api/off/search', async ({ query }) => {
  if (!query.q) return [];
  try { return await offSearch(query.q, query.world === '1' ? '' : 'australia'); } catch (e) { throw new HttpError(502, `Online search unavailable: ${e.message}`); }
});
route('POST', '/api/off/import', async ({ body }) => {
  const { food, created } = saveProduct(body.product, { source: 'off' });
  return { food: toFood(food), created };
});

// ----- AI
route('POST', '/api/analyze/meal', async ({ body }) => {
  const images = cleanImages(body.images);
  const passes = Number(store.getSetting('ai_passes', 2));
  const answers = cleanAnswers(body.answers);
  store.saveHabits(answers); // remembered for next time
  return analyzeMeal({ images, hint: String(body.hint || '').slice(0, 500), passes, answers, habits: store.listHabits() }, { foods: store.allFoods(), saved: store.savedProducts(60) });
});
route('POST', '/api/recipes/parse', async ({ body }) => {
  const answers = cleanAnswers(body.answers);
  store.saveHabits(answers);
  return parseRecipe({ text: String(body.text || '').slice(0, 4000), answers, habits: store.listHabits() }, { foods: store.allFoods() });
});
route('POST', '/api/recipes/compute', async ({ body }) => computeRecipe(body));
route('POST', '/api/recipes', async ({ body }) => { const r = saveRecipe(body); return { food: toFood(r.food), computed: r.computed }; });
route('GET', '/api/habits', async () => store.listHabits(60));
route('DELETE', '/api/habits', async () => { store.deleteHabits(); return { ok: true }; });
route('POST', '/api/analyze/label', async ({ body }) => {
  const images = cleanImages(body.images);
  const r = await analyzeLabel({ images, hint: String(body.hint || '').slice(0, 300) });
  if (r.ok && body.save !== false) {
    const { food, created } = saveProduct(r.product, { thumb: String(body.thumb || ''), source: 'label' });
    r.food = toFood(food); r.created = created;
  }
  return r;
});

// ----- diary
route('GET', '/api/log', async ({ query }) => store.logForDate(query.date || todayStr()).map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null })));
route('POST', '/api/log', async ({ body }) => {
  const list = Array.isArray(body.entries) ? body.entries : [body];
  if (!list.length || list.length > 60) throw new HttpError(400, 'Nothing to log');
  const ids = list.map((e) => {
    if (!e.name || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new HttpError(400, 'Each entry needs a name and a date');
    return store.addLog(e);
  });
  return { ids };
});
route('PUT', '/api/log/:id', async ({ params, body }) => {
  const e = store.updateLog(+params.id, body);
  if (!e) throw new HttpError(404, 'Not found');
  return { ...e, details: e.details ? JSON.parse(e.details) : null };
});
route('DELETE', '/api/log/:id', async ({ params, query }) => {
  const e = store.getLog(+params.id);
  if (!e) throw new HttpError(404, 'Not found');
  if (query.group === '1' && e.group_id) return { deleted: store.deleteLogGroup(e.group_id) };
  return { deleted: store.deleteLog(e.id) ? 1 : 0 };
});
route('POST', '/api/log/quick', async ({ body }) => {
  const f = store.getFood(+body.food_id);
  if (!f) throw new HttpError(404, 'Food not found');
  const grams = Number(body.grams) || f.serving_g;
  const id = store.addLog({ date: body.date || todayStr(), meal: body.meal || 'snack', name: f.name, grams, ...scale(f, grams), food_id: f.id, source: 'search' });
  return { id };
});
route('GET', '/api/summary', async ({ query }) => {
  const to = query.to || todayStr();
  const from = query.from || todayStr(new Date(Date.now() - 13 * 86400000));
  return store.dailySummary(from, to);
});

// ----- weight & settings
route('GET', '/api/weights', async () => store.listWeights());
route('POST', '/api/weights', async ({ body }) => {
  const kg = Number(body.kg);
  if (!(kg > 20 && kg < 400)) throw new HttpError(400, 'Enter a weight in kg');
  store.setWeight(body.date || todayStr(), kg);
  return store.listWeights();
});
route('DELETE', '/api/weights/:date', async ({ params }) => { store.deleteWeight(params.date); return store.listWeights(); });
route('GET', '/api/settings', async () => ({ settings: settingsOut(), ai: aiStatus() }));
route('POST', '/api/settings', async ({ body }) => {
  const allowed = ['goal_kcal', 'goal_protein', 'goal_carbs', 'goal_fat', 'sex', 'age', 'height_cm', 'weight_kg', 'activity', 'weekly_loss_kg', 'ai_passes', 'tdee'];
  for (const k of allowed) if (body[k] !== undefined) store.setSetting(k, body[k]);
  return { settings: settingsOut(), ai: aiStatus() };
});
route('POST', '/api/settings/openai', async ({ body }) => {
  if (body.key !== undefined) {
    const k = String(body.key).trim();
    if (k && !/^sk-[A-Za-z0-9_\-]{20,}$/.test(k)) throw new HttpError(400, 'That does not look like an OpenAI key (it starts with sk-).');
    setApiKey(k);
  }
  if (body.model !== undefined) setModel(String(body.model));
  return aiStatus();
});

// ----- server
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(buf);
  });
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj)); };
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      return send(200, await r.fn({ params: m.groups || {}, query: Object.fromEntries(url.searchParams), body }));
    }
    send(404, { error: 'No such endpoint' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !(e instanceof AIError)) console.error(e);
    send(status, { error: e.message, code: e.code });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const host = process.env.HOST || '127.0.0.1';
  server.listen(PORT, host, () => console.log(`LeanMode running at http://${host === '127.0.0.1' ? 'localhost' : host}:${PORT}${process.env.CAL_MOCK_AI ? '  (MOCK AI mode)' : ''}`));
}
