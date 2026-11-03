// Meal-prep recipes: raw ingredients + final cooked weight + portions -> a reusable food.
//
// Cooking changes weight (rice soaks up water, curries lose it) but not calories, so per-100g of the *cooked*
// dish = total ingredient energy / cooked weight. Weigh the pot once after cooking for exact numbers.
import { NUTRIENTS, num, round1, scale, sum } from './nutrition.js';

export function computeRecipe({ ingredients, total_cooked_g, portions }) {
  const warnings = [];
  const list = (ingredients || []).filter((i) => num(i.grams) > 0);
  if (!list.length) throw Object.assign(new Error('Add at least one ingredient.'), { status: 400 });
  const rawG = list.reduce((s, i) => s + num(i.grams), 0);
  const totals = sum(list.map((i) => scale(i.per100, i.grams)));
  let cooked = num(total_cooked_g);
  if (!(cooked > 0)) {
    cooked = rawG;
    warnings.push('No cooked weight given, so portions are based on the raw ingredient weight. Weigh the finished batch for better accuracy.');
  } else if (cooked < rawG * 0.3 || cooked > rawG * 3.5) {
    warnings.push(`Cooked weight (${Math.round(cooked)} g) looks odd next to ${Math.round(rawG)} g of ingredients. Double check it.`);
  }
  const n = Math.max(1, num(portions, 1));
  const per100 = Object.fromEntries(NUTRIENTS.map((k) => [k, round1((totals[k] / cooked) * 100)]));
  per100.kcal = Math.round((totals.kcal / cooked) * 100);
  const serving_g = round1(cooked / n);
  return { totals, per100, cooked, portions: n, serving_g, per_portion: scale(per100, serving_g), raw_g: rawG, warnings };
}

/** Validates a recipe request and returns the food record to store. getFood(id) looks up ingredient foods. */
export function buildRecipe(body, getFood = () => null) {
  const ings = (body.ingredients || []).map((i) => {
    let per100 = i.per100;
    if (!per100 && i.food_id) per100 = getFood(+i.food_id);
    if (!per100) throw Object.assign(new Error(`No nutrition for "${i.name}". Pick it from the database or edit it.`), { status: 400 });
    per100 = Object.fromEntries(NUTRIENTS.map((k) => [k, num(per100[k])]));
    return { name: String(i.name || '').slice(0, 80), grams: round1(i.grams), hidden: !!i.hidden, food_id: i.food_id ?? null, per100 };
  });
  const name = String(body.name || '').trim();
  if (!name) throw Object.assign(new Error('Give the recipe a name.'), { status: 400 });
  const c = computeRecipe({ ingredients: ings, total_cooked_g: body.total_cooked_g, portions: body.portions });
  const recipe = JSON.stringify({ ingredients: ings, total_cooked_g: c.cooked, portions: c.portions, answers: (body.answers || []).slice(0, 12) });
  const rec = {
    name, brand: '', aliases: String(body.aliases || ''), ...c.per100, serving_g: c.serving_g,
    serving_label: `1 portion (${Math.round(c.serving_g)} g)`, category: 'meal prep', source: 'recipe', recipe,
  };
  return { rec, computed: c };
}
