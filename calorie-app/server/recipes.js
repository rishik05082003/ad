import * as store from './db.js';
import { buildRecipe, computeRecipe } from '../public/core/recipes.js';

export { computeRecipe };

export function saveRecipe(body) {
  const { rec, computed } = buildRecipe(body, (id) => store.getFood(id));
  const existing = body.id ? store.getFood(+body.id) : null;
  const food = existing && existing.source === 'recipe' ? store.updateFood(existing.id, rec) : store.insertFood(rec);
  return { food, computed };
}
