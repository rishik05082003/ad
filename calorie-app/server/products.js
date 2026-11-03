// Saving scanned / imported products so they are recognised later (search, barcode, and photo analysis).
import * as store from './db.js';
import { matchFoods, normalize } from '../public/core/match.js';
export { fromOpenFoodFacts, offBarcode, offSearch } from '../public/core/off.js';

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
