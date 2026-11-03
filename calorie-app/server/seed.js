import path from 'node:path';

export const SEED_FILE = path.join(import.meta.dirname, 'data', 'foods.txt');

/** Parses data/foods.txt (12 semicolon separated columns, per 100 g). */
export function parseSeed(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const c = line.split(';');
    if (c.length !== 12) throw new Error(`foods.txt line ${i + 1}: expected 12 columns, got ${c.length}`);
    const n = (x) => {
      const v = Number(x);
      if (!Number.isFinite(v)) throw new Error(`foods.txt line ${i + 1}: bad number "${x}"`);
      return v;
    };
    rows.push({
      name: c[0].trim(), aliases: c[1].trim(), kcal: n(c[2]), protein: n(c[3]), carbs: n(c[4]), fat: n(c[5]),
      fiber: n(c[6]), sugar: n(c[7]), sodium: n(c[8]), serving_g: n(c[9]), serving_label: c[10].trim(), category: c[11].trim(),
    });
  });
  return rows;
}
