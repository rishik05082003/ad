// Photo -> nutrition pipeline.
//
//  1. VISION      N independent passes (different estimation strategies) ask the model to name every item,
//                 estimate edible grams from scale references, split dishes into ingredients (incl. hidden oil,
//                 butter, sugar) and say how sure it is.
//  2. GROUNDING   every item / ingredient is matched against the food database (your saved products first). Database
//                 numbers beat model numbers, but a sanity check rejects matches that disagree wildly with what
//                 the model saw (e.g. "fried" vs "raw"). No match -> model's own per-100g estimate, flagged.
//  3. MERGE       passes are clustered by name, grams are averaged, spread lowers confidence.
//  4. MATH        nutrition = per-100g x grams, summed per dish and per meal.
//
// Weights always come from vision + your hint. Calories never do: they come from data.
import { chatJSON, imageParts } from './openai.js';
import { MEAL_SCHEMA, LABEL_SCHEMA, RECIPE_SCHEMA } from './schemas.js';
import { matchFoods, nameSimilarity } from './match.js';
import { scale, sum, reconcile, num, round1, NUTRIENTS } from './nutrition.js';

export const ACCEPT_SCORE = 0.62;
const MERGE_SIMILARITY = 0.72;

// ---------------------------------------------------------------- prompts
const SYSTEM_MEAL = `You are a meticulous dietitian and food-photo measurement expert helping someone in a calorie deficit.
Your job is to list EVERY food and drink in the photo(s) and estimate the edible weight of each, as eaten.

METHOD
1. Find scale references and write them in scale_reference: dinner plate (about 26-27 cm), side plate (19 cm), katori/small bowl (about 150 ml), fork (about 19 cm), tablespoon (15 ml), teaspoon (5 ml), spoon, hand/fingers, can (330 ml), phone (about 15 cm), packaging text. Use them to judge real size, not the picture size.
2. For each item estimate volume or count, then convert to grams with realistic densities. Reference weights as eaten:
   cooked rice 1 cup (240 ml) 160-195 g | cooked pasta 1 cup 140 g | dal/curry 1 katori 150 g | roti/chapati medium 40 g | paratha 60-80 g | naan 90 g | idli 40 g | dosa 85 g | bread slice 28 g | whole egg 50 g | chicken breast palm-size 100-120 g cooked | paneer cube 10 g | apple medium 180 g | banana peeled 100-120 g | 1 tbsp oil 14 g | 1 tsp ghee 5 g | Oreo cookie 11 g | samosa 80 g | slice of pizza 100-110 g | can of cola 330 g.
3. Weights are EDIBLE weights as eaten: cooked weight for cooked foods, no peel, bones, shells or packaging. Liquids in grams (1 ml = 1 g).
4. Name things specifically ("paneer butter masala", "white rice, cooked", "masala chai with sugar"), never just "curry" or "meal".
5. Mixed dishes (kind=dish): split into components with grams that add up to the dish weight. Include HIDDEN energy when it is very likely and mark hidden=true: cooking oil/ghee/butter, cream, sugar in drinks, dressing, sauces. Restaurant gravies usually carry about 1-2 tbsp of fat per serving, home cooking about 1 tsp to 1 tbsp. Do not count the same fat twice.
6. Plain single foods (kind=single) or drinks need no ingredients (empty array). Packaged foods (kind=packaged) too.
7. per_100g: your best estimate for that item as eaten. It is only a fallback when the database has no match, so be honest and realistic. For ingredients give per 100 g of that ingredient as listed.
8. If the user's saved products list contains the item (same brand/product), set saved_product_id. Use the pack count or visible quantity to get grams (e.g. 3 cookies x serving weight).
9. The user's note overrides your visual guess whenever it states a quantity or fraction ("ate half", "about 200 g rice", "2 rotis"). Apply it and mention it in reasoning. Otherwise ignore the note.
10. Several photos usually show the SAME meal from different angles. Use them to judge depth and do not double count. If the note says they are different meals, list all.
11. grams_low/grams_high is your honest range. confidence: 0.9 clear and standard, 0.6 partly hidden, 0.3 guess. Lower it when food is hidden under sauce or the scale is unclear.
12. If nothing edible is visible return an empty items array and a warning.
13. QUESTIONS: ask 0-4 clarifying questions, only when the answer would change the calories by roughly 50 kcal or more. Typical ones: amount and type of cooking fat (oil, ghee, butter), sugar or milk in a drink, sauce or dressing amount, whether it is homemade or restaurant, what the filling is, how much of a batch dish was served. Each must be short and concrete with 2-4 realistic quick-answer options (e.g. "1 tsp", "1 tbsp", "2 tbsp", "None"). Never ask something already covered by the user note, the user's earlier answers or their known habits.
14. User answers to your earlier questions are authoritative: apply them (e.g. "2 tbsp oil" means 28 g of oil as a hidden ingredient). Known habits are how this user usually cooks: apply them unless the photo or note contradicts them.
15. Items in the saved list marked [own recipe] are the user's meal-prep dishes. If a dish on the plate is clearly one of them, set saved_product_id and estimate the weight of the portion eaten (a full portion is the listed portion weight).
Return only JSON matching the schema.`;

const PASS_STYLES = [
  'STRATEGY for this pass: PLATE-FRACTION method. Estimate how much of the plate/bowl each food covers, compare with a standard plate, and use typical serving weights as sanity checks.',
  'STRATEGY for this pass: BOTTOM-UP VOLUME method. Estimate each food as length x width x height (or count x unit weight), convert with density, and do not anchor on typical serving sizes. Be skeptical of piles that look big because of the camera angle.',
  'STRATEGY for this pass: CONSERVATIVE AUDIT. Look for easily missed items (drinks, sauces, oil sheen, toppings, garnish, cooking fat) and check weights against labels or packaging if any are visible.',
];

function savedBlock(saved) {
  if (!saved?.length) return 'The user has no saved packaged products yet.';
  return 'User saved products (use saved_product_id when an item is clearly one of these):\n' + saved
    .map((f) => `id=${f.id} | ${[f.brand, f.name].filter(Boolean).join(' ')}${f.source === 'recipe' ? ' [own recipe]' : ''} | ${Math.round(f.kcal)} kcal/100g | serving ${f.serving_label || ''} (${Math.round(f.serving_g)} g)`)
    .join('\n');
}

// ---------------------------------------------------------------- grounding
const fromModel = (p = {}) => ({
  kcal: num(p.kcal), protein: num(p.protein), carbs: num(p.carbs), fat: num(p.fat),
  fiber: num(p.fiber), sugar: num(p.sugar), sodium: num(p.sodium_mg ?? p.sodium),
});
const foodPer100 = (f) => Object.fromEntries(NUTRIENTS.map((k) => [k, num(f[k])]));
const hasEnergy = (p) => num(p.kcal) > 0 || num(p.protein) + num(p.carbs) + num(p.fat) > 0;

/**
 * Find the best nutrition source for one named thing.
 * Returns { source: 'saved'|'db'|'ai'|'unknown', food_id, food_name, match_score, per100, note? }
 */
export function ground({ name, cooking_method = '', saved_product_id = null, per_100g }, foods, byId = new Map(foods.map((f) => [f.id, f])), opts = {}) {
  const ai = reconcile(fromModel(per_100g)).per100;
  if (saved_product_id != null && byId.has(saved_product_id)) {
    const f = byId.get(saved_product_id);
    return { source: f.source === 'seed' ? 'db' : 'saved', food_id: f.id, food_name: f.name, match_score: 1, per100: foodPer100(f) };
  }
  const queries = [name];
  if (cooking_method && !name.toLowerCase().includes(cooking_method.toLowerCase())) queries.push(`${name} ${cooking_method}`);
  let best = null;
  for (const q of queries) {
    const m = matchFoods(q, foods, { limit: 1, min: 0.3 })[0];
    if (m && (!best || m.score > best.score)) best = m;
  }
  let note = null;
  if (best && best.score >= (opts.accept ?? ACCEPT_SCORE)) {
    const dbk = num(best.food.kcal), aik = ai.kcal;
    const ratio = dbk > 15 && aik > 15 ? dbk / aik : 1;
    if (best.score < 0.9 && (ratio > 2.2 || ratio < 0.45)) {
      note = `Closest database entry "${best.food.name}" (${Math.round(dbk)} kcal/100g) disagreed with what was seen (~${Math.round(aik)}), used the visual estimate.`;
    } else {
      if (ratio > 3.5 || ratio < 0.28) note = `Database says ${Math.round(dbk)} kcal/100g for "${best.food.name}" but the photo suggested ~${Math.round(aik)}. Check the portion.`;
      return { source: best.food.source === 'seed' ? 'db' : 'saved', food_id: best.food.id, food_name: best.food.name, match_score: best.score, per100: foodPer100(best.food), note };
    }
  }
  if (!hasEnergy(ai)) return { source: 'unknown', food_id: null, food_name: null, match_score: best?.score ?? 0, per100: ai, note: note || `No nutrition data for "${name}". Please edit it.` };
  return { source: 'ai', food_id: null, food_name: null, match_score: best?.score ?? 0, per100: ai, note };
}

/** Turn one raw model pass into grounded items (nutrition is computed later, after merging). */
export function groundPass(raw, foods, byId, passIdx = 0) {
  const items = [];
  for (const it of raw.items || []) {
    const grams = num(it.grams);
    if (!(grams > 0) || !it.name) continue;
    const ings = it.kind === 'dish' && it.ingredients?.length
      ? it.ingredients.filter((g) => num(g.grams) > 0 && g.name).map((g) => ({
        name: g.name, grams: num(g.grams), hidden: !!g.hidden, ground: ground({ name: g.name, per_100g: g.per_100g }, foods, byId),
      }))
      : [];
    const item = {
      _pass: passIdx, name: it.name, kind: it.kind, cooking_method: it.cooking_method || '', grams,
      grams_low: num(it.grams_low, grams * 0.8), grams_high: num(it.grams_high, grams * 1.2),
      confidence: Math.max(0, Math.min(1, num(it.confidence, 0.5))), reasoning: it.reasoning || '',
      ingredients: ings,
      ground: ings.length ? null : ground(it, foods, byId),
    };
    // Cross-check a decomposed dish against a database entry for the whole dish, if there is one.
    if (ings.length) {
      const dish = matchFoods(it.name, foods, { limit: 1, min: 0.3 })[0];
      if (dish && dish.score >= 0.8) item.dish_ref = { name: dish.food.name, kcal100: num(dish.food.kcal) };
    }
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------- merging passes
function cluster(list, nameOf) {
  const clusters = [];
  for (const x of list) {
    let hit = null, hs = 0;
    for (const c of clusters) {
      if (c.some((m) => m._pass === x._pass)) continue;
      const s = Math.max(...c.map((m) => nameSimilarity(nameOf(m), nameOf(x))));
      if (s >= MERGE_SIMILARITY && s > hs) { hit = c; hs = s; }
    }
    if (hit) hit.push(x); else clusters.push([x]);
  }
  return clusters;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

function mergeIngredients(members) {
  const withIngs = members.filter((m) => m.ingredients.length);
  if (!withIngs.length) return [];
  const flat = withIngs.flatMap((m) => m.ingredients.map((g) => ({ ...g, _pass: m._pass })));
  const out = [];
  for (const c of cluster(flat, (g) => g.name)) {
    const presence = c.length / withIngs.length;
    if (presence < 0.5) continue;
    const base = c.find((g) => g.ground.source !== 'ai' && g.ground.source !== 'unknown') || c[0];
    // missing from a pass counts as 0 g, so a hidden extra only one pass noticed is halved rather than dropped or doubled
    out.push({ name: base.name, hidden: c.every((g) => g.hidden), grams: sum_(c.map((g) => g.grams)) / withIngs.length, ground: base.ground });
  }
  return out.filter((g) => g.grams >= 1).sort((a, b) => b.grams - a.grams);
}
const sum_ = (a) => a.reduce((s, v) => s + v, 0);

export function mergePasses(passes) {
  const n = passes.length;
  const flat = passes.flat();
  const merged = [];
  for (const c of cluster(flat, (m) => m.name)) {
    const ingredients = mergeIngredients(c);
    const grams = ingredients.length ? sum_(ingredients.map((g) => g.grams)) : mean(c.map((m) => m.grams));
    const gs = c.map((m) => m.grams);
    const spread = (Math.max(...gs) - Math.min(...gs)) / (mean(gs) || 1);
    let conf = mean(c.map((m) => m.confidence)) * (1 - Math.min(0.4, spread * 0.8));
    if (c.length < n) conf *= n > 2 && c.length >= 2 ? 0.92 : 0.85;
    const bestConf = [...c].sort((a, b) => b.confidence - a.confidence)[0];
    const grounded = c.find((m) => m.ground && m.ground.source !== 'ai' && m.ground.source !== 'unknown') || c.find((m) => m.ground);
    merged.push({
      name: bestConf.name, kind: bestConf.kind, cooking_method: bestConf.cooking_method, grams,
      grams_low: Math.min(grams, mean(c.map((m) => m.grams_low))), grams_high: Math.max(grams, mean(c.map((m) => m.grams_high))),
      confidence: Math.max(0.05, Math.min(0.98, conf)),
      reasoning: bestConf.reasoning, ingredients, ground: ingredients.length ? null : grounded?.ground,
      dish_ref: c.find((m) => m.dish_ref)?.dish_ref, seen_in: c.length, passes: n, spread,
    });
  }
  // an item only one of several passes saw, with low confidence, is probably a hallucination: keep but flag
  return merged;
}

// ---------------------------------------------------------------- final numbers
const publicGround = (g) => ({ source: g.source, food_id: g.food_id, food_name: g.food_name, match_score: g.match_score, per100: g.per100, note: g.note });

export function finalize(items) {
  const warnings = [];
  let id = 1;
  const out = items.map((it) => {
    const flags = [];
    let ingredients = [];
    let nutrition, per100, source, food_id = null, food_name = null, match_score = null;
    if (it.ingredients.length) {
      ingredients = it.ingredients.map((g) => {
        const nutr = scale(g.ground.per100, g.grams);
        if (g.ground.note) flags.push(g.ground.note);
        return { name: g.name, grams: round1(g.grams), hidden: g.hidden, source: g.ground.source, food_id: g.ground.food_id, food_name: g.ground.food_name, match_score: g.ground.match_score, per100: g.ground.per100, nutrition: nutr };
      });
      nutrition = sum(ingredients.map((g) => g.nutrition));
      const grams = sum_(ingredients.map((g) => g.grams));
      per100 = Object.fromEntries(NUTRIENTS.map((k) => [k, round1((nutrition[k] / (grams || 1)) * 100)]));
      source = 'ingredients';
      if (it.dish_ref) {
        const ref = Math.round((it.dish_ref.kcal100 * grams) / 100);
        if (ref > 0 && Math.abs(nutrition.kcal - ref) / ref > 0.35) {
          flags.push(`Ingredient math gives ${nutrition.kcal} kcal but a typical "${it.dish_ref.name}" of this weight is ~${ref} kcal.`);
        }
      }
    } else {
      const g = it.ground;
      nutrition = scale(g.per100, it.grams);
      per100 = g.per100; source = g.source; food_id = g.food_id; food_name = g.food_name; match_score = g.match_score;
      if (g.note) flags.push(g.note);
    }
    if (it.seen_in < it.passes) flags.push(`Only ${it.seen_in} of ${it.passes} analysis passes saw this. Remove it if it is not on your plate.`);
    if (it.confidence < 0.45) flags.push('Low confidence, please check the portion.');
    return {
      id: id++, name: it.name, kind: it.kind, cooking_method: it.cooking_method,
      grams: round1(ingredients.length ? sum_(ingredients.map((g) => g.grams)) : it.grams),
      grams_low: Math.round(it.grams_low), grams_high: Math.round(it.grams_high),
      confidence: Math.round(it.confidence * 100) / 100, reasoning: it.reasoning,
      source, food_id, food_name, match_score, per100, nutrition, ingredients, flags,
    };
  });
  for (const it of out) for (const f of it.flags) warnings.push(`${it.name}: ${f}`);
  return { items: out, totals: sum(out.map((i) => i.nutrition)), warnings };
}

// ---------------------------------------------------------------- public API
/**
 * @param {object} p
 * @param {string[]} p.images data URLs
 * @param {string} [p.hint] user note, e.g. "ate half, about 150g rice"
 * @param {number} [p.passes] 1-3
 * @param {object} deps injectable for tests: { chat, foods, saved }
 */
/** Text block with the user's answers and remembered habits, shared by meal and recipe prompts. */
export function memoryBlock(answers = [], habits = []) {
  const parts = [];
  const a = answers.filter((x) => x?.answer?.trim());
  if (a.length) parts.push('User answers to your earlier questions (authoritative, apply them):\n' + a.map((x) => `- ${x.item_name ? `[${x.item_name}] ` : ''}Q: ${x.question} A: ${x.answer}`).join('\n'));
  const h = habits.filter((x) => x?.answer);
  if (h.length) parts.push('Known habits of this user (apply unless contradicted):\n' + h.map((x) => `- ${x.item ? `${x.item}: ` : ''}${x.question} -> ${x.answer}`).join('\n'));
  return parts.join('\n\n');
}

export const cleanQuestions = (lists) => {
  const seen = new Set(); const out = [];
  for (const q of lists.flat()) {
    const text = (q?.question || '').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ item_name: q.item_name || '', question: text, options: (q.options || []).filter(Boolean).slice(0, 4) });
  }
  return out.slice(0, 4);
};

export async function analyzeMeal({ images, hint = '', passes = 2, answers = [], habits = [] }, deps) {
  const { chat = chatJSON, foods, saved = [] } = deps;
  if (!images?.length) throw Object.assign(new Error('Add at least one photo.'), { status: 400 });
  const n = Math.max(1, Math.min(3, Math.round(passes) || 1));
  const byId = new Map(foods.map((f) => [f.id, f]));
  const note = hint.trim() ? `User note (overrides your visual guess where it states a quantity): "${hint.trim()}"` : 'No user note.';

  const calls = Array.from({ length: n }, (_, i) => chat({
    system: `${SYSTEM_MEAL}\n\n${PASS_STYLES[i % PASS_STYLES.length]}`,
    userContent: [{ type: 'text', text: `${note}\n\n${memoryBlock(answers, habits)}\n\n${savedBlock(saved)}\n\nAnalyse the meal in the attached photo(s).` }, ...imageParts(images)],
    schema: MEAL_SCHEMA, schemaName: 'meal_analysis', temperature: i === 0 ? 0.1 : 0.4,
  }));
  const settled = await Promise.allSettled(calls);
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) throw settled[0].reason;

  const grounded = ok.map((raw, i) => groundPass(raw, foods, byId, i));
  const merged = mergePasses(grounded);
  const { items, totals, warnings } = finalize(merged);
  const allWarn = [...new Set([...warnings, ...ok.flatMap((r) => r.warnings || [])])];
  if (ok.length < n) allWarn.push(`${n - ok.length} of ${n} analysis passes failed, estimate is less reliable.`);
  if (!items.length) allWarn.push('No food was detected in the photo.');
  return {
    summary: ok[0].meal_summary, scale_reference: ok[0].scale_reference, items, totals, warnings: allWarn,
    questions: cleanQuestions(ok.map((r) => r.questions || [])), meta: { passes: ok.length },
  };
}

// ---------------------------------------------------------------- labels
const SYSTEM_LABEL = `You read packaged-food photos (back-of-pack nutrition tables, front of pack, barcode) and transcribe them exactly.
- Copy the numbers as printed. Do not estimate or "fix" them.
- Give BOTH columns if the label has "per 100 g" and "per serving"; use null for anything not printed.
- Energy must be in kcal. If only kJ is printed, convert (kJ / 4.184).
- sodium_mg in milligrams (if salt is given in grams, sodium = salt / 2.5 x 1000).
- serving_size_g is the serving weight in grams (or ml for drinks) if printed.
- product_name and brand come from the front or the label text. Barcode digits only if clearly readable.
- If the image does not show any nutrition information, set readable=false.
Return only JSON matching the schema.`;

const prodPer100 = (p) => ({ kcal: num(p?.kcal), protein: num(p?.protein), carbs: num(p?.carbs), fat: num(p?.fat), fiber: num(p?.fiber), sugar: num(p?.sugar), sodium: num(p?.sodium_mg) });

/** Turn the raw label transcription into a per-100g product. Pure, tested. */
export function normalizeLabel(raw) {
  const warnings = [];
  if (!raw.readable) return { ok: false, error: 'Could not read a nutrition table. Try a sharper, well lit, flat photo of the back of the pack.' };
  const has = (p) => p && num(p.kcal) + num(p.protein) + num(p.carbs) + num(p.fat) > 0;
  const sg = num(raw.serving_size_g);
  let per100, basis;
  if (has(raw.per_100g)) { per100 = prodPer100(raw.per_100g); basis = 'per_100g'; }
  else if (has(raw.per_serving) && sg > 0) {
    const f = 100 / sg; const p = prodPer100(raw.per_serving);
    per100 = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round1(v * f)])); basis = 'per_serving';
    warnings.push(`Label only listed per serving, converted using serving size ${sg} g.`);
  } else if (has(raw.per_serving)) {
    return { ok: false, needs_serving_size: true, error: 'The label lists values per serving but I could not read the serving size in grams. Enter it manually.', raw };
  } else return { ok: false, error: 'No readable nutrition numbers found.' };

  if (has(raw.per_100g) && has(raw.per_serving) && sg > 0) {
    const expect = (num(raw.per_serving.kcal) * 100) / sg;
    if (expect > 20 && Math.abs(expect - per100.kcal) / expect > 0.2) warnings.push('Per-100g and per-serving columns do not agree. Check the numbers.');
  }
  const r = reconcile(per100);
  warnings.push(...r.warnings);
  const servingG = sg > 0 ? sg : 100;
  return {
    ok: true, basis, warnings,
    product: {
      name: (raw.product_name || '').trim() || 'Scanned product', brand: (raw.brand || '').trim(), barcode: (raw.barcode || '').replace(/\D/g, ''),
      ...r.per100, serving_g: servingG, serving_label: (raw.serving_label || '').trim() || `${servingG} g`,
      servings_per_container: raw.servings_per_container ?? null, net_weight_g: raw.net_weight_g ?? null,
      ingredients: (raw.ingredients_text || '').trim(), allergens: raw.allergens || [], notes: raw.notes || '',
    },
  };
}

export async function analyzeLabel({ images, hint = '' }, deps = {}) {
  const { chat = chatJSON } = deps;
  if (!images?.length) throw Object.assign(new Error('Add at least one photo.'), { status: 400 });
  const raw = await chat({
    system: SYSTEM_LABEL,
    userContent: [{ type: 'text', text: `${hint ? `User note: ${hint}\n` : ''}Transcribe the packaged product shown.` }, ...imageParts(images)],
    schema: LABEL_SCHEMA, schemaName: 'label_scan', temperature: 0,
  });
  return normalizeLabel(raw);
}

// ---------------------------------------------------------------- recipes (meal prep)
const SYSTEM_RECIPE = `You turn a home cook's description of a batch recipe into a precise ingredient list for calorie counting.
- Weights are RAW / as-added weights (dry rice, raw meat, oil as poured), in grams. Convert household measures with standards: 1 tbsp oil/ghee/butter 14 g, 1 tsp 5 g, 1 cup raw rice 185 g, 1 cup dal raw 200 g, 1 medium onion 110 g, 1 medium tomato 120 g, 1 egg 50 g, 1 medium potato 170 g, 1 cup milk 245 g, 1 tbsp sugar 12 g.
- Name each ingredient with its state ("chicken thigh, raw", "basmati rice, dry", "cooking oil"). One line per ingredient. Ignore salt, water and small amounts of spices.
- total_cooked_g is the final weight of the whole cooked batch if the user gave it, else null. portions is the number of portions if given, else null. Never invent either.
- per_100g is your estimate for that ingredient as named (raw if raw). It is only a fallback when the database has no match.
- Use questions (0-4) for things that change calories a lot and were not said: how much oil or ghee, skin on or off and fat trimmed, rice type, coconut milk or cream, sugar. Short, concrete, with 2-4 realistic quick-answer options. Never ask what the description, answers or habits already say.
- User answers are authoritative: apply them (e.g. "3 tbsp oil" becomes cooking oil, 42 g).
Return only JSON matching the schema.`;

export async function parseRecipe({ text, answers = [], habits = [] }, deps) {
  const { chat = chatJSON, foods } = deps;
  if (!String(text || '').trim()) throw Object.assign(new Error('Describe what you cooked first.'), { status: 400 });
  const raw = await chat({
    system: SYSTEM_RECIPE,
    userContent: [{ type: 'text', text: `${memoryBlock(answers, habits)}\n\nRecipe description:\n${text.trim()}` }],
    schema: RECIPE_SCHEMA, schemaName: 'recipe_parse', temperature: 0.1,
  });
  const byId = new Map(foods.map((f) => [f.id, f]));
  const ingredients = (raw.ingredients || []).filter((g) => num(g.grams) > 0 && g.name).map((g) => {
    const gr = ground({ name: g.name, per_100g: g.per_100g }, foods, byId);
    return { name: g.name, grams: round1(g.grams), hidden: !!g.hidden, source: gr.source, food_id: gr.food_id, food_name: gr.food_name, match_score: gr.match_score, per100: gr.per100, note: gr.note || null };
  });
  return {
    name: raw.name || '', total_cooked_g: raw.total_cooked_g ?? null, portions: raw.portions ?? null, ingredients,
    questions: cleanQuestions([raw.questions || []]), warnings: [...(raw.warnings || []), ...ingredients.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`)],
  };
}
