// Saving scanned / imported products so they are recognised later (search, barcode, and photo analysis).
import * as store from './db.js';
import { matchFoods, normalize } from './match.js';

export function saveProduct(p, { thumb = '', source = 'label' } = {}) {
  const rec = {
    name: p.name, brand: p.brand || '', aliases: p.aliases || '', kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat,
    fiber: p.fiber, sugar: p.sugar, sodium: p.sodium, serving_g: p.serving_g || 100, serving_label: p.serving_label || '100 g',
    category: p.category || 'packaged', source, barcode: p.barcode || '', ingredients: p.ingredients || '', thumb,
  };
  let existing = rec.barcode ? store.foodByBarcode(rec.barcode) : null;
  if (!existing && rec.brand) {
    // same brand + near identical name = same product re-scanned
    const hit = matchFoods(`${rec.brand} ${rec.name}`, store.allFoods().filter((f) => f.source !== 'seed'), { limit: 1, min: 0.9 })[0];
    if (hit && normalize(hit.food.brand) === normalize(rec.brand)) existing = hit.food;
  }
  if (existing && existing.source !== 'seed') {
    return { food: store.updateFood(existing.id, { ...rec, thumb: thumb || existing.thumb, use_count: existing.use_count }), created: false };
  }
  return { food: store.insertFood(rec), created: true };
}

/** Open Food Facts v2 product -> our per-100g shape. */
export function fromOpenFoodFacts(prod) {
  const n = prod.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : 0);
  const sodium = n.sodium_100g != null ? n.sodium_100g * 1000 : n.salt_100g != null ? (n.salt_100g / 2.5) * 1000 : 0;
  const sg = parseFloat(prod.serving_quantity) || 100;
  return {
    name: prod.product_name || prod.generic_name || 'Unnamed product', brand: (prod.brands || '').split(',')[0].trim(),
    barcode: String(prod.code || prod._id || ''), kcal: Math.round(kcal), protein: n.proteins_100g || 0, carbs: n.carbohydrates_100g || 0,
    fat: n.fat_100g || 0, fiber: n.fiber_100g || 0, sugar: n.sugars_100g || 0, sodium: Math.round(sodium),
    serving_g: sg, serving_label: prod.serving_size || `${sg} g`, ingredients: prod.ingredients_text || '',
  };
}

const UA = { 'User-Agent': 'LeanMode/1.0 (personal calorie tracker)' };
const OFF_FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity,ingredients_text';

export async function offBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 && j.product ? fromOpenFoodFacts({ ...j.product, code }) : null;
}

export async function offSearch(q, country = 'australia') {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}` +
    (country ? `&tagtype_0=countries&tag_contains_0=contains&tag_0=${encodeURIComponent(country)}` : '');
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Open Food Facts returned ${r.status}`);
  const j = await r.json();
  return (j.products || []).map(fromOpenFoodFacts).filter((p) => p.kcal > 0 || p.protein + p.carbs + p.fat > 0);
}
