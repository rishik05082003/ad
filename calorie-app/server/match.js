// Fuzzy food matcher. Turns a free-text name ("paneer butter masala", "oreo", "chappati")
// into ranked rows from the food database. Pure functions, no I/O, easy to test.

const STOP = new Set(['the', 'of', 'with', 'and', 'a', 'an', 'in', 'on', 'style', 'homemade', 'home', 'made', 'fresh', 'some', 'my', 'piece', 'pieces', 'serving', 'bowl', 'plate', 'cup', 'glass']);
const METHODS = new Set(['cooked', 'boiled', 'fried', 'raw', 'baked', 'grilled', 'steamed', 'roasted', 'dry', 'prepared', 'toasted', 'sauteed', 'tandoori']);

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function singular(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(ches|shes|xes|sses)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
  return t;
}

export function tokens(s) {
  return normalize(s).split(' ').filter(Boolean).map(singular).filter((t) => !STOP.has(t));
}

function lev(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 1 for equal, ~0.8/0.7 for a typo away, 0 otherwise. */
function tokSim(a, b) {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  const d = lev(a, b, 2);
  if (d === 1) return 0.82;
  if (d === 2 && Math.min(a.length, b.length) >= 7) return 0.7;
  return 0;
}

/** Similarity of two token lists, 0..1. */
function listSim(qt, ct) {
  if (!qt.length || !ct.length) return 0;
  const qContent = qt.filter((t) => !METHODS.has(t));
  const cContent = ct.filter((t) => !METHODS.has(t));
  const q = qContent.length ? qContent : qt;
  const c = cContent.length ? cContent : ct;

  let qHit = 0;
  const used = new Set();
  for (const t of q) {
    let best = 0, bi = -1;
    c.forEach((u, i) => {
      if (used.has(i)) return;
      const s = tokSim(t, u);
      if (s > best) { best = s; bi = i; }
    });
    if (bi >= 0) used.add(bi);
    qHit += best;
  }
  const cov = qHit / q.length;      // how much of the query is explained
  const prec = qHit / c.length;     // how much of the candidate is explained
  if (cov === 0) return 0;
  let score = (2 * cov * prec) / (cov + prec);
  // method words: a mismatch (fried vs boiled) is worse than one side not saying anything
  const qm = qt.filter((t) => METHODS.has(t));
  const cm = ct.filter((t) => METHODS.has(t));
  if (qm.length && cm.length) {
    if (qm.some((m) => cm.includes(m))) score += 0.04;
    else score -= 0.15;
  }
  return Math.max(0, Math.min(1, score));
}

function prepare(food) {
  if (food._p) return food._p;
  const names = [food.name, ...(food.aliases ? food.aliases.split(',') : [])].map((x) => x.trim()).filter(Boolean);
  const lists = names.map((n) => ({ text: normalize(n), toks: tokens(n) }));
  if (food.brand) {
    const bt = tokens(food.brand);
    lists.push({ text: normalize(`${food.brand} ${food.name}`), toks: [...bt, ...tokens(food.name)] });
  }
  Object.defineProperty(food, '_p', { value: lists, enumerable: false });
  return lists;
}

export function scoreFood(query, food) {
  const qt = tokens(query);
  const qn = normalize(query);
  if (!qt.length) return 0;
  let best = 0;
  for (const l of prepare(food)) {
    let s = listSim(qt, l.toks);
    if (l.text === qn) s = 1;
    else if (s > 0 && (` ${l.text} `.includes(` ${qn} `) || ` ${qn} `.includes(` ${l.text} `))) s = Math.min(1, s + 0.08);
    if (s > best) best = s;
  }
  if (best > 0) {
    if (food.source && food.source !== 'seed') best += 0.05; // the user's own products win ties
    best += Math.min(0.03, Math.log10(1 + (food.use_count || 0)) * 0.02);
  }
  return Math.min(1, best);
}

export function matchFoods(query, foods, { limit = 5, min = 0.3 } = {}) {
  const out = [];
  for (const f of foods) {
    const s = scoreFood(query, f);
    if (s >= min) out.push({ food: f, score: Math.round(s * 1000) / 1000 });
  }
  out.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  return out.slice(0, limit);
}

/** Similarity of two free-text names, used to merge items between analysis passes. */
export function nameSimilarity(a, b) {
  const at = tokens(a), bt = tokens(b);
  if (!at.length || !bt.length) return 0;
  if (normalize(a) === normalize(b)) return 1;
  return listSim(at, bt);
}

/** Search-as-you-type: substring/prefix hits first, then fuzzy. */
export function searchFoods(query, foods, { limit = 40, category = '', mine = false } = {}) {
  const q = normalize(query);
  let pool = foods;
  if (category) pool = pool.filter((f) => f.category === category);
  if (mine) pool = pool.filter((f) => f.source !== 'seed');
  if (!q) {
    return [...pool].sort((a, b) => (b.use_count - a.use_count) || a.name.localeCompare(b.name)).slice(0, limit).map((food) => ({ food, score: 0 }));
  }
  const scored = [];
  for (const f of pool) {
    let s = scoreFood(query, f);
    const hay = prepare(f).map((l) => l.text);
    if (hay.some((h) => h.startsWith(q))) s = Math.max(s, 0.9);
    else if (hay.some((h) => h.includes(q))) s = Math.max(s, 0.75);
    if (s >= 0.4) scored.push({ food: f, score: s });
  }
  scored.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  return scored.slice(0, limit);
}
