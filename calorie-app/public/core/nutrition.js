export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'];

export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

/** Scale a per-100g nutrition object to a gram amount. */
export function scale(per100, grams) {
  const f = num(grams) / 100;
  const out = {};
  for (const k of NUTRIENTS) out[k] = round1(num(per100?.[k]) * f);
  out.kcal = Math.round(num(per100?.kcal) * f);
  return out;
}

export function sum(list) {
  const out = Object.fromEntries(NUTRIENTS.map((k) => [k, 0]));
  for (const x of list) for (const k of NUTRIENTS) out[k] += num(x?.[k]);
  for (const k of NUTRIENTS) out[k] = round1(out[k]);
  out.kcal = Math.round(out.kcal);
  return out;
}

/** Energy implied by the macros (Atwater, fibre counted at ~2 kcal/g). */
export function atwater(p, c, f, fiber = 0) {
  return 4 * num(p) + 4 * Math.max(0, num(c) - num(fiber)) + 2 * num(fiber) + 9 * num(f);
}

/**
 * Cleans up a per-100g record read from a label or produced by a model.
 * - fills in missing kcal from macros
 * - detects kJ printed where kcal was expected (ratio ~4.18)
 * - flags energy that disagrees with the macros
 */
export function reconcile(per100) {
  const p = { ...Object.fromEntries(NUTRIENTS.map((k) => [k, num(per100?.[k])])) };
  const warnings = [];
  const implied = atwater(p.protein, p.carbs, p.fat, p.fiber);
  if (!p.kcal && implied > 0) {
    p.kcal = Math.round(implied);
    warnings.push('Energy was missing, calculated from macros.');
  } else if (p.kcal > 0 && implied > 20) {
    const ratio = p.kcal / implied;
    if (ratio > 3.6 && ratio < 4.8) {
      p.kcal = Math.round(p.kcal / 4.184);
      warnings.push('Energy looked like kJ, converted to kcal.');
    } else if (ratio < 0.6 || ratio > 1.6) {
      warnings.push(`Energy (${Math.round(p.kcal)} kcal) does not match the macros (~${Math.round(implied)} kcal). Double check the numbers.`);
    }
  }
  return { per100: p, warnings };
}

export const todayStr = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
