// Natural units ("1 cookie", "2 rotis", "3 slices") derived from a food's serving label, so you can enter
// what you actually ate instead of grams. "3 cookies" at 34 g means 1 cookie is about 11.3 g.
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
const ADJ = /^(medium|large|small|regular|big|mini)$/i;
const KEEP_LAST = new Set(['sliced', 'diced', 'dry', 'raw', 'arils', 'grated', 'toasted', 'cooked', 'chunks', 'drained', 'filling', 'popped']);
const IE_WORDS = new Set(['cookie', 'brownie', 'pie', 'smoothie', 'veggie', 'rookie', 'calorie', 'hoagie', 'sundae', 'tie']);
const NO_PLURAL = new Set(['tbsp', 'tsp', 'g', 'ml', 'oz', 'kg', 'l', 'pav', 'naan', 'roti', 'chapati', 'idli', 'dosa', 'puri', 'bhatura', 'thepla']);

const plural = (w) => {
  const l = w.toLowerCase();
  if (NO_PLURAL.has(l) || l.endsWith('s') && !l.endsWith('ss')) return w;
  if (/(s|x|z|ch|sh)$/.test(l)) return w + 'es';
  if (/[^aeiou]y$/.test(l)) return w.slice(0, -1) + 'ies';
  return w + 's';
};
const singular = (w) => {
  const l = w.toLowerCase();
  if (NO_PLURAL.has(l)) return w;
  if (/ies$/.test(l)) return IE_WORDS.has(l.slice(0, -1)) ? w.slice(0, -1) : w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|sses|zes)$/.test(l)) return w.slice(0, -2);
  if (l.endsWith('s') && !l.endsWith('ss') && !l.endsWith('us')) return w.slice(0, -1);
  return w;
};

function mapWord(phrase, fn) {
  const words = phrase.split(' ');
  let i = words.length - 1;
  while (i > 0 && KEEP_LAST.has(words[i].toLowerCase())) i--;
  words[i] = fn(words[i]);
  return words.join(' ');
}

/** -> { one, many, grams } where grams is the weight of ONE unit, or null if the label has no countable unit. */
export function unitOf(food) {
  const label = String(food?.serving_label || '').trim();
  const m = label.match(/^(?:about\s+)?(\d+(?:\.\d+)?(?:\/\d+)?|[½¼¾])\s*(?:x|×)?\s*(.+)$/i);
  if (!m) return null;
  let count;
  if (FRAC[m[1]] !== undefined) count = FRAC[m[1]];
  else if (m[1].includes('/')) { const [a, b] = m[1].split('/').map(Number); count = a / b; } else count = parseFloat(m[1]);
  let rest = m[2].replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  if (!(count > 0) || !rest || /^(g|gm|gram|grams|ml|kg|oz)\b/i.test(rest)) return null;
  const grams = Number(food.serving_g) / count;
  if (!(grams > 0)) return null;
  if (ADJ.test(rest)) {
    const base = String(food.name || '').replace(/\(.*?\)/g, '').trim().toLowerCase();
    rest = `${rest.toLowerCase()} ${base}`.trim();
  }
  const single = count <= 1; // "1 slice", "1/2 cup", "1/4 cup" are written in the singular; "3 cookies" in the plural
  const one = single ? rest : mapWord(rest, singular);
  const many = single ? mapWord(rest, plural) : rest;
  return { one, many, grams };
}

export const fmtQty = (n) => String(Math.round(n * 100) / 100);

const WORDS = { a: 1, an: 1, one: 1, half: 0.5, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, dozen: 12 };

/**
 * "2 oreo", "half a roti", "150g rice", "1 oreo double stuff" -> { text, qty?, grams? }
 * Returns null when there is no leading amount.
 */
export function parseAmount(query) {
  const q = String(query || '').trim();
  let m = q.match(/^(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams|ml)\s+(?:of\s+)?(.+)$/i);
  if (m) return { text: m[2].trim(), grams: parseFloat(m[1]) };
  m = q.match(/^(half(?:\s+an?)?|\d+\/\d+|\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|ten|dozen)\s*(?:x|×)?\s+(?:of\s+)?(.+)$/i);
  if (!m) return null;
  const raw = m[1].toLowerCase().replace(/\s+an?$/, '');
  let qty;
  if (raw.includes('/')) { const [a, b] = raw.split('/').map(Number); qty = a / b; } else qty = WORDS[raw] ?? parseFloat(raw);
  return qty > 0 && m[2].trim() ? { text: m[2].trim(), qty } : null;
}
