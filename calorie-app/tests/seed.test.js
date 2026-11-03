import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSeed, SEED_FILE } from '../server/seed.js';
import { atwater } from '../server/nutrition.js';

const rows = parseSeed(fs.readFileSync(SEED_FILE, 'utf8'));

test('seed has a strong set of foods', () => {
  assert.ok(rows.length >= 350, `only ${rows.length} rows`);
  const names = new Set(rows.map((r) => r.name.toLowerCase()));
  assert.equal(names.size, rows.length, 'duplicate names in seed');
});

test('every seed row is plausible', () => {
  const bad = [];
  for (const r of rows) {
    if (r.kcal < 0 || r.protein < 0 || r.carbs < 0 || r.fat < 0) bad.push(`${r.name}: negative`);
    if (r.protein + r.carbs + r.fat > 101) bad.push(`${r.name}: macros exceed 100 g`);
    if (r.sugar > r.carbs + 0.5) bad.push(`${r.name}: sugar > carbs`);
    if (r.fiber > r.carbs + 0.5) bad.push(`${r.name}: fiber > carbs`);
    if (r.serving_g <= 0) bad.push(`${r.name}: serving`);
    const a = atwater(r.protein, r.carbs, r.fat, r.fiber);
    // alcohol has energy that macros do not show
    if (r.category !== 'alcohol' && a > 30 && Math.abs(r.kcal - a) / a > 0.3) bad.push(`${r.name}: kcal ${r.kcal} vs macros ${Math.round(a)}`);
  }
  assert.deepEqual(bad, []);
});
