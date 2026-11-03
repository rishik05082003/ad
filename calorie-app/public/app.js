// LeanMode front end. Vanilla JS, no build step.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const NUT = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'];
const MEALS = [['breakfast', 'Breakfast', '🍳'], ['lunch', 'Lunch', '🥗'], ['dinner', 'Dinner', '🍛'], ['snack', 'Snacks', '🍪']];
const CAT_EMOJI = { fruit: '🍎', vegetable: '🥦', grain: '🍚', indian: '🍛', protein: '🍗', dairy: '🥛', fat: '🧈', nuts: '🥜', snack: '🍿', packaged: '📦', dessert: '🍰', fastfood: '🍔', drink: '🥤', alcohol: '🍺', bread: '🍞', cereal: '🥣', legume: '🫘', condiment: '🧂', spread: '🥜', sweetener: '🍯', supplement: '💪', soup: '🍲', breakfast: '🥞', 'meal prep': '🍱' };
const emoji = (c) => CAT_EMOJI[c] || '🍽️';

const state = { tab: 'today', date: today(), log: [], settings: {}, ai: {}, foodsQ: '', foodsCat: '', foodsMine: false };

function today(d = new Date()) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return today(d); }
function niceDate(s) {
  if (s === today()) return 'Today';
  if (s === addDays(today(), -1)) return 'Yesterday';
  return new Date(s + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function defaultMeal() { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner'; }

let localApi = null; // set when there is no server: the app then runs entirely on the phone (see local-api.js)
async function api(path, opts = {}) {
  if (localApi) return localApi(path, opts);
  const res = await fetch('/api' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null;
  try { j = await res.json(); } catch { /* */ }
  if (!res.ok) { const e = new Error(j?.error || `Request failed (${res.status})`); e.code = j?.code; throw e; }
  return j;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
const goal = () => ({
  kcal: Number(state.settings.goal_kcal) || 2000,
  protein: Number(state.settings.goal_protein) || Math.round(((Number(state.settings.goal_kcal) || 2000) * 0.3) / 4),
  carbs: Number(state.settings.goal_carbs) || Math.round(((Number(state.settings.goal_kcal) || 2000) * 0.4) / 4),
  fat: Number(state.settings.goal_fat) || Math.round(((Number(state.settings.goal_kcal) || 2000) * 0.3) / 9),
});
const sumN = (list) => { const o = Object.fromEntries(NUT.map((k) => [k, 0])); for (const x of list) for (const k of NUT) o[k] += Number(x[k]) || 0; return o; };
const scaleN = (o, f) => Object.fromEntries(NUT.map((k) => [k, (Number(o[k]) || 0) * f]));

// ---------------------------------------------------------------- images
async function toJpeg(file, max = 1400, q = 0.82) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = null; }
  if (!bmp) return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
const thumbOf = (url) => new Promise((res) => {
  const im = new Image(); im.onload = () => { const s = 160 / Math.max(im.width, im.height); const c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.6)); }; im.onerror = () => res(''); im.src = url;
});
function pickPhotos({ camera, multiple = true, max = 1400 }) {
  return new Promise((resolve) => {
    const inp = $(camera ? '#file-cam' : '#file-gal');
    inp.value = '';
    inp.multiple = multiple && !camera;
    inp.onchange = async () => { resolve(await Promise.all([...inp.files].slice(0, 4).map((f) => toJpeg(f, max)))); };
    inp.click();
  });
}

// ---------------------------------------------------------------- sheet
let sheetStack = [];
function openSheet(title, html, { onClose } = {}) {
  const root = $('#sheet-root');
  const back = document.createElement('div'); back.className = 'back';
  back.innerHTML = `<div class="sheet" role="dialog"><div class="hd"><h2>${esc(title)}</h2><button class="x" aria-label="Close">✕</button></div><div class="bd">${html}</div></div>`;
  root.appendChild(back);
  const api_ = {
    el: back, body: $('.bd', back),
    set(h) { $('.bd', back).innerHTML = h; },
    title(t) { $('h2', back).textContent = t; },
    close() { back.remove(); sheetStack = sheetStack.filter((s) => s !== api_); onClose?.(); },
  };
  $('.x', back).onclick = () => api_.close();
  back.addEventListener('mousedown', (e) => { if (e.target === back) api_.close(); });
  sheetStack.push(api_);
  return api_;
}
const closeAllSheets = () => { [...sheetStack].forEach((s) => s.close()); };

// ---------------------------------------------------------------- data
async function loadDay() { state.log = await api(`/log?date=${state.date}`); }
async function loadSettings() { const r = await api('/settings'); state.settings = r.settings; state.ai = r.ai; }
async function refresh() { await Promise.all([loadDay(), loadSettings()]); render(); }

// ---------------------------------------------------------------- render
function render() {
  document.querySelectorAll('#nav [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const top = $('#top');
  top.innerHTML = state.tab === 'today'
    ? `<div class="brand">Lean<em>Mode</em></div><div class="datenav"><button data-act="day" data-d="-1">‹</button><span>${niceDate(state.date)}</span><button data-act="day" data-d="1" ${state.date >= today() ? 'disabled style="opacity:.3"' : ''}>›</button></div>`
    : `<div class="brand">Lean<em>Mode</em></div><span class="chip a">${state.ai.mock ? 'demo AI' : state.ai.has_key ? 'AI ready' : 'no AI key'}</span>`;
  ({ today: renderToday, foods: renderFoods, trends: renderTrends, settings: renderSettings })[state.tab]();
}

function ring(eaten, g) {
  const R = 74, C = 2 * Math.PI * R, pct = Math.min(1, eaten / g);
  const over = eaten > g, near = eaten > g * 0.9;
  const col = over ? 'var(--bad)' : near ? 'var(--warn)' : 'var(--accent)';
  return `<div class="ring"><svg width="170" height="170" viewBox="0 0 170 170"><circle cx="85" cy="85" r="${R}" fill="none" stroke="var(--card2)" stroke-width="14"/>
  <circle cx="85" cy="85" r="${R}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" style="transition:stroke-dashoffset .8s"/></svg>
  <div class="c"><div class="big" style="color:${col}">${r0(Math.abs(g - eaten)).toLocaleString()}</div><div class="lbl">${over ? 'kcal over' : 'kcal left'}</div></div></div>`;
}
const macroBar = (name, val, g, color) => `<div class="macro"><div class="spread small"><span>${name}</span><span class="mute">${r0(val)} / ${r0(g)} g</span></div><div class="bar"><i style="width:${Math.min(100, (val / g) * 100)}%;background:${color}"></i></div></div>`;

function renderToday() {
  const t = sumN(state.log), g = goal();
  const tdee = Number(state.settings.tdee) || 0;
  let banner = '';
  if (!state.log.length) banner = `<div class="banner info">Nothing logged yet. Tap <b>+</b> and snap your meal, or search the database.</div>`;
  else if (t.kcal > g.kcal) banner = `<div class="banner bad">${r0(t.kcal - g.kcal)} kcal over your target. A walk or a lighter next meal pulls it back.</div>`;
  else if (tdee) banner = `<div class="banner ok">On track: ${r0(tdee - t.kcal)} kcal below maintenance so far (about ${r1(((tdee - t.kcal) / 7700))} kg of fat if the day ended now).</div>`;
  else banner = `<div class="banner ok">${r0(g.kcal - t.kcal)} kcal to go. Set up your profile in Settings for a proper deficit target.</div>`;

  const byMeal = MEALS.map(([key, label, em]) => {
    const rows = state.log.filter((e) => (e.meal || 'snack') === key);
    if (!rows.length) return '';
    return `<div class="meal"><h3><span>${em} ${label}</span><span>${r0(rows.reduce((s, e) => s + e.kcal, 0))} kcal</span></h3>${rows.map(entryRow).join('')}</div>`;
  }).join('');

  $('#view').innerHTML = `
  <div class="card hero">${ring(t.kcal, g.kcal)}
    <div class="stats">
      <div class="stat"><b>${r0(t.kcal).toLocaleString()}</b><span>eaten</span></div>
      <div class="stat"><b>${r0(g.kcal).toLocaleString()}</b><span>daily target</span></div>
      ${tdee ? `<div class="stat"><b>−${r0(tdee - g.kcal)}</b><span>planned deficit</span></div>` : ''}
    </div></div>
  <div class="card" style="margin-top:0">${macroBar('Protein', t.protein, g.protein, 'var(--p)')}${macroBar('Carbs', t.carbs, g.carbs, 'var(--c)')}${macroBar('Fat', t.fat, g.fat, 'var(--f)')}
    <div class="small mute" style="margin-top:10px">Fibre ${r0(t.fiber)} g · Sugar ${r0(t.sugar)} g · Sodium ${r0(t.sodium)} mg</div></div>
  ${installHint()}${banner}${byMeal}`;
}

function installHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let dismissed = false; try { dismissed = localStorage.getItem('lm_install_dismissed') === '1'; } catch { /* */ }
  if (!state.ai.local || standalone || dismissed) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="banner info small"><div class="spread"><div><b>Install it like an app.</b> ${ios ? 'Tap the Share button, then <b>Add to Home Screen</b>.' : 'Open the browser menu (⋮), then <b>Install app</b> or <b>Add to Home screen</b>.'} Installed, it opens full screen, works offline and keeps your data safe from the browser clearing it.</div><button data-act="dismiss-install" style="font-size:18px">✕</button></div></div>`;
}

function entryRow(e) {
  const th = e.thumb ? `<img src="${esc(e.thumb)}" alt="">` : (e.source === 'photo' ? '📷' : '🍽️');
  const ing = e.details?.ingredients?.length;
  return `<button class="entry" data-act="entry" data-id="${e.id}"><div class="th">${th}</div><div class="grow"><div class="nm">${esc(e.name)}</div><div class="small mute">${r0(e.grams)} g · P${r0(e.protein)} C${r0(e.carbs)} F${r0(e.fat)}${ing ? ` · ${ing} ingredients` : ''}</div></div><div class="kc">${r0(e.kcal)}</div></button>`;
}

// ---------------------------------------------------------------- entry sheet
function entrySheet(id) {
  const e = state.log.find((x) => x.id === id); if (!e) return;
  const ings = e.details?.ingredients || [];
  const sh = openSheet(e.name, `
    <div class="kv"><span class="mute">Calories</span><b>${r0(e.kcal)} kcal</b><span class="mute">Protein</span><b>${r1(e.protein)} g</b><span class="mute">Carbs</span><b>${r1(e.carbs)} g</b><span class="mute">Fat</span><b>${r1(e.fat)} g</b><span class="mute">Fibre / Sugar</span><b>${r1(e.fiber)} / ${r1(e.sugar)} g</b></div>
    ${e.details?.reasoning ? `<div class="banner info small" style="margin-top:12px">${esc(e.details.reasoning)}</div>` : ''}
    ${ings.length ? `<div class="ing">${ings.map((g) => `<div><span>${esc(g.name)}${g.hidden ? ' <span class="chip w">hidden</span>' : ''}</span><span class="mute">${r0(g.grams)} g · ${r0(g.nutrition?.kcal)} kcal</span></div>`).join('')}</div>` : ''}
    <label>Amount (g)</label><input id="eg" type="number" inputmode="decimal" value="${r1(e.grams)}">
    <label>Meal</label><select id="em">${MEALS.map(([k, l]) => `<option value="${k}" ${k === e.meal ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="grid2" style="margin-top:16px"><button class="btn" id="save">Save</button><button class="btn ghost" id="again">Log again today</button></div>
    <button class="btn danger" id="del" style="margin-top:10px">Delete${e.group_id ? ' this item' : ''}</button>
    ${e.group_id && state.log.filter((x) => x.group_id === e.group_id).length > 1 ? '<button class="btn danger" id="delg" style="margin-top:10px">Delete whole photo meal</button>' : ''}`);
  $('#save', sh.el).onclick = async () => {
    const g = Number($('#eg', sh.el).value) || e.grams, f = e.grams > 0 ? g / e.grams : 1;
    const upd = { grams: g, meal: $('#em', sh.el).value, ...Object.fromEntries(NUT.map((k) => [k, k === 'kcal' ? r0(e[k] * f) : r1(e[k] * f)])) };
    if (ings.length) upd.details = { ...e.details, ingredients: ings.map((x) => ({ ...x, grams: r1(x.grams * f), nutrition: Object.fromEntries(NUT.map((k) => [k, r1((x.nutrition?.[k] || 0) * f)])) })) };
    await api(`/log/${id}`, { method: 'PUT', body: upd }); sh.close(); await loadDay(); render();
  };
  $('#again', sh.el).onclick = async () => {
    const { id: _i, created_at, ...rest } = e;
    await api('/log', { body: { entries: [{ ...rest, date: today(), group_id: '', thumb: '' }] } });
    sh.close(); toast('Logged again for today'); if (state.date === today()) { await loadDay(); render(); }
  };
  $('#del', sh.el).onclick = async () => { await api(`/log/${id}`, { method: 'DELETE' }); sh.close(); await loadDay(); render(); };
  $('#delg', sh.el)?.addEventListener('click', async () => { await api(`/log/${id}?group=1`, { method: 'DELETE' }); sh.close(); await loadDay(); render(); });
}

// ---------------------------------------------------------------- ADD menu
function addMenu() {
  const noKey = !state.ai.has_key;
  const sh = openSheet('Add food', `
    ${noKey ? '<div class="banner warn small">Photo features need your OpenAI key. Add it once in Settings. Search and manual entry work without it.</div>' : ''}
    <div class="tiles">
      <button class="tile hot" data-go="meal"><span class="e">📸</span><b>Photo of my meal</b><span>AI spots every item, estimates grams and ingredients</span></button>
      <button class="tile" data-go="label"><span class="e">🏷️</span><b>Scan a food label</b><span>Back of pack. Saved so it is recognised next time</span></button>
      <button class="tile" data-go="search"><span class="e">🔎</span><b>Search foods</b><span>${state.foodCount || 530}+ foods, Coles favourites, barcode</span></button>
      <button class="tile" data-go="quick"><span class="e">✍️</span><b>Quick add</b><span>Just type calories and macros</span></button>
      <button class="tile" data-go="recipe" style="grid-column:span 2"><span class="e">🍱</span><b>Meal prep / cooked batch</b><span>Add what you cooked once, log portions all week. Remembered for photos too</span></button>
    </div>`);
  sh.el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { sh.close(); ({ meal: mealFlow, label: labelFlow, search: () => searchSheet({}), quick: quickAdd, recipe: recipeFlow })[b.dataset.go](); });
}

// ---------------------------------------------------------------- MEAL PHOTO flow
function mealFlow() {
  let photos = [];
  const sh = openSheet('Photo of my meal', '');
  const draw = () => {
    sh.set(`
    <div class="preview">${photos.map((p, i) => `<div class="pv"><img src="${p}"><button class="rm" data-i="${i}">✕</button></div>`).join('')}</div>
    ${photos.length < 4 ? `<div class="grid2"><button class="btn ghost" id="cam">📷 Take photo</button><button class="btn ghost" id="gal">🖼️ Gallery</button></div>` : ''}
    <p class="small mute">Tip: shoot from above or at 45°, with the plate fully in frame. Put a fork or spoon next to the food for scale. A second angle improves portion accuracy.</p>
    <label>Anything the camera cannot know? (optional)</label>
    <textarea id="hint" rows="2" placeholder="e.g. I ate half of it · about 150 g rice · cooked in 1 tbsp ghee · 2 rotis"></textarea>
    <label>Meal</label><select id="meal">${MEALS.map(([k, l]) => `<option value="${k}" ${k === defaultMeal() ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn" id="go" style="margin-top:16px" ${photos.length ? '' : 'disabled'}>Analyse meal</button>`);
    $('#cam', sh.el)?.addEventListener('click', async () => { photos.push(...await pickPhotos({ camera: true })); photos = photos.slice(0, 4); keep(); draw(); });
    $('#gal', sh.el)?.addEventListener('click', async () => { photos.push(...await pickPhotos({})); photos = photos.slice(0, 4); keep(); draw(); });
    sh.el.querySelectorAll('.rm').forEach((b) => b.onclick = () => { photos.splice(+b.dataset.i, 1); keep(); draw(); });
    $('#go', sh.el).onclick = () => run();
  };
  let hintVal = '', mealVal = defaultMeal();
  const keep = () => { hintVal = $('#hint', sh.el)?.value ?? hintVal; mealVal = $('#meal', sh.el)?.value ?? mealVal; };
  const restore = () => { if ($('#hint', sh.el)) { $('#hint', sh.el).value = hintVal; $('#meal', sh.el).value = mealVal; } };
  const _draw = draw;
  const draw2 = () => { _draw(); restore(); };
  const run = async () => {
    keep();
    const thumb = await thumbOf(photos[0]);
    sh.set(`<div class="scan"><img src="${photos[0]}" style="height:100%;width:100%;object-fit:cover;opacity:.5"></div><div class="ai-step" id="step"></div>`);
    const steps = ['Spotting every food and drink…', 'Reading plate size for scale…', 'Estimating portion weights…', 'Splitting dishes into ingredients…', 'Matching the nutrition database…', 'Cross-checking the passes…'];
    let si = 0; const tick = setInterval(() => { const s = $('#step', sh.el); if (s) s.textContent = steps[Math.min(si++, steps.length - 1)]; }, 1800);
    $('#step', sh.el).textContent = steps[si++];
    try {
      const res = await api('/analyze/meal', { body: { images: photos, hint: hintVal } });
      clearInterval(tick);
      reviewMeal(sh, res, { thumb, meal: mealVal, photos, hint: hintVal, answers: [] });
    } catch (e) {
      clearInterval(tick);
      sh.set(`<div class="banner bad">${esc(e.message)}</div>${e.code === 'no_key' || e.code === 'bad_key' ? '<button class="btn" id="tosettings">Open Settings</button>' : ''}<button class="btn ghost" id="retry" style="margin-top:10px">Try again</button>`);
      $('#retry', sh.el).onclick = draw2; $('#tosettings', sh.el)?.addEventListener('click', () => { sh.close(); state.tab = 'settings'; render(); });
    }
  };
  draw2();
  setTimeout(() => $('#cam', sh.el)?.click(), 150);
}

const confCls = (c) => (c >= 0.75 ? 'g' : c >= 0.5 ? 'w' : 'b');
const srcLabel = { db: 'database', saved: 'your product', ai: 'AI estimate', unknown: 'unknown', ingredients: 'from ingredients' };

function reviewMeal(sh, res, ctx) {
  const A = { mult: 1, ans: {}, meal: ctx.meal, items: res.items.map((i) => ({ ...i, k: 1, open: false, base: { grams: i.grams, nutrition: i.nutrition, ingredients: i.ingredients } })) };
  const disp = (it) => { const f = it.k * A.mult; return { grams: it.base.grams * f, nutrition: scaleN(it.base.nutrition, f), ingredients: it.base.ingredients.map((g) => ({ ...g, grams: g.grams * f, nutrition: scaleN(g.nutrition, f) })) }; };
  const totals = () => sumN(A.items.map((it) => disp(it).nutrition));
  const redraw = () => { const bd = sh.el.querySelector('.bd'); const y = bd.scrollTop; draw(); bd.scrollTop = y; };

  const draw = () => {
    const t = totals(), g = goal();
    sh.title('Review your meal');
    sh.set(`
      <div class="small mute">${esc(res.summary || '')}</div>
      ${res.scale_reference ? `<div class="small mute" style="margin-top:4px">📏 ${esc(res.scale_reference)}</div>` : ''}
      ${res.warnings?.length ? res.warnings.map((w) => `<div class="banner warn small">${esc(w)}</div>`).join('') : ''}
      ${res.questions?.length ? `<div class="card qcard"><b>A few quick questions</b><div class="small mute">Your answers sharpen the estimate and are remembered for next time.</div>${res.questions.map((q, qi) => `<div class="q" data-q="${qi}"><div>${esc(q.question)}${q.item_name ? ` <span class="chip">${esc(q.item_name)}</span>` : ''}</div><div class="chips">${q.options.map((o) => `<button data-opt="${esc(o)}" class="${A.ans[qi] === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div><input data-free placeholder="or type your own, e.g. 3 tsp"></div>`).join('')}<button class="btn" id="reask">Update estimate with my answers</button><div class="small mute" style="margin-top:6px">This re-runs the analysis, so do manual gram edits after.</div></div>` : ''}
      ${A.items.map((it, i) => { const d = disp(it); return `
        <div class="item" data-i="${i}">
          <div class="t"><div class="grow"><div class="nm">${esc(it.name)}</div>
            <div class="small mute">${esc(it.cooking_method || it.kind)} · range ${r0(it.grams_low * it.k * A.mult)}-${r0(it.grams_high * it.k * A.mult)} g</div>
            <div style="margin-top:6px"><span class="chip ${confCls(it.confidence)}">${r0(it.confidence * 100)}% sure</span> <span class="chip ${it.source === 'ai' || it.source === 'unknown' ? 'w' : 'a'}">${srcLabel[it.source] || it.source}</span>${it.food_name ? ` <span class="chip">${esc(it.food_name)}</span>` : ''}</div></div>
            <div class="right"><div class="kc">${r0(d.nutrition.kcal)}</div><div class="small mute">kcal</div></div></div>
          <div class="gramin"><button class="step" data-s="-10">−</button><input type="number" inputmode="decimal" value="${r0(d.grams)}" data-g><span class="mute small">g</span><button class="step" data-s="10">+</button><span class="grow"></span>
            <span class="small mute">P${r0(d.nutrition.protein)} C${r0(d.nutrition.carbs)} F${r0(d.nutrition.fat)}</span><button class="step" data-rm title="Remove" style="margin-left:6px">✕</button></div>
          ${it.reasoning ? `<div class="small mute" style="margin-top:8px">💭 ${esc(it.reasoning)}</div>` : ''}
          ${it.flags?.map((f) => `<div class="small" style="color:var(--warn);margin-top:6px">⚠ ${esc(f)}</div>`).join('') || ''}
          ${d.ingredients.length ? `<button class="small" data-open style="color:var(--accent);margin-top:8px">${it.open ? '▾' : '▸'} ${d.ingredients.length} ingredients</button>${it.open ? `<div class="ing">${d.ingredients.map((x) => `<div><span>${esc(x.name)}${x.hidden ? ' <span class="chip w">hidden</span>' : ''} <span class="chip ${x.source === 'ai' ? 'w' : ''}">${srcLabel[x.source] || x.source}</span></span><span class="mute">${r0(x.grams)} g · ${r0(x.nutrition.kcal)}</span></div>`).join('')}</div>` : ''}` : ''}
          ${d.ingredients.length ? '<button class="small" data-savedish style="color:var(--accent2);margin:8px 0 0 14px">💾 Save as my dish</button>' : ''}
        </div>`; }).join('') || '<div class="empty">Nothing detected. Try a clearer photo or add items manually.</div>'}
      <button class="btn ghost" id="addmore" style="margin-top:6px">+ Add something it missed</button>
      <div class="totalbar">
        <div class="card" style="margin:8px 0">
          <div class="spread"><div><div style="font-size:26px;font-weight:800">${r0(t.kcal)} <span class="small mute">kcal</span></div><div class="small mute">P ${r0(t.protein)} · C ${r0(t.carbs)} · F ${r0(t.fat)} · ${r0((t.kcal / g.kcal) * 100)}% of today's target</div></div>
          <select id="rmeal" style="width:auto">${MEALS.map(([k, l]) => `<option value="${k}" ${k === A.meal ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <label>Ate more or less than the photo? Portion ×${A.mult.toFixed(2)}</label><input type="range" id="mult" min="0.25" max="2" step="0.05" value="${A.mult}">
        </div>
        <button class="btn" id="log" ${A.items.length ? '' : 'disabled'}>Log meal</button>
      </div>`);
    wire();
  };
  const wire = () => {
    $('#mult', sh.el).oninput = (e) => { A.mult = Number(e.target.value); const y = sh.el.querySelector('.bd').scrollTop; draw(); sh.el.querySelector('.bd').scrollTop = y; $('#mult', sh.el).focus?.(); };
    $('#rmeal', sh.el).onchange = (e) => { A.meal = e.target.value; };
    sh.el.querySelectorAll('.item').forEach((el) => {
      const it = A.items[+el.dataset.i];
      const setG = (g) => { const f = A.mult * it.base.grams; it.k = Math.max(0.01, g / f); const y = sh.el.querySelector('.bd').scrollTop; draw(); sh.el.querySelector('.bd').scrollTop = y; };
      $('[data-g]', el).onchange = (e) => setG(Number(e.target.value) || disp(it).grams);
      el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => setG(Math.max(1, disp(it).grams + Number(b.dataset.s))));
      $('[data-rm]', el).onclick = () => { A.items.splice(+el.dataset.i, 1); draw(); };
      $('[data-open]', el)?.addEventListener('click', () => { it.open = !it.open; const y = sh.el.querySelector('.bd').scrollTop; draw(); sh.el.querySelector('.bd').scrollTop = y; });
      $('[data-savedish]', el)?.addEventListener('click', () => { const d = disp(it); recipeEditor({ name: it.name, total: r0(d.grams), portions: 1, ings: d.ingredients.map((x) => ({ name: x.name, grams: r1(x.grams), hidden: x.hidden, per100: x.per100, source: x.source, food_id: x.food_id })) }); });
    });
    sh.el.querySelectorAll('.q').forEach((qel) => {
      const qi = +qel.dataset.q;
      qel.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => { A.ans[qi] = A.ans[qi] === b.dataset.opt ? '' : b.dataset.opt; redraw(); });
      $('[data-free]', qel).oninput = (e) => { A.ans[qi] = e.target.value.trim(); qel.querySelectorAll('[data-opt]').forEach((b) => b.classList.remove('on')); };
    });
    $('#reask', sh.el)?.addEventListener('click', async () => {
      const prev = ctx.answers || [];
      const fresh = res.questions.map((q, qi) => ({ item_name: q.item_name, question: q.question, answer: A.ans[qi] || '' })).filter((a) => a.answer);
      if (!fresh.length) return toast('Pick or type an answer first');
      const answers = [...prev, ...fresh];
      sh.set(`<div class="scan"><img src="${ctx.photos[0]}" style="height:100%;width:100%;object-fit:cover;opacity:.5"></div><div class="ai-step">Re-estimating with your answers…</div>`);
      try {
        const r2 = await api('/analyze/meal', { body: { images: ctx.photos, hint: ctx.hint, answers } });
        reviewMeal(sh, r2, { ...ctx, meal: A.meal, answers });
      } catch (e) { toast(e.message); draw(); }
    });
    $('#addmore', sh.el).onclick = () => searchSheet({
      confirmLabel: 'Add to meal',
      onConfirm: (food, grams) => {
        const n = scaleN(food, grams / 100);
        A.items.push({ id: Date.now(), name: food.name, kind: 'single', cooking_method: '', grams, grams_low: grams, grams_high: grams, confidence: 1, reasoning: 'Added by you', source: food.source === 'seed' ? 'db' : 'saved', food_id: food.id, food_name: food.name, flags: [], ingredients: [], per100: food, nutrition: n, k: 1, open: false, base: { grams, nutrition: n, ingredients: [] } });
        draw();
      },
    });
    $('#log', sh.el).onclick = async () => {
      const gid = 'g' + Date.now();
      const entries = A.items.map((it, i) => {
        const d = disp(it);
        return { date: state.date, meal: A.meal, name: it.name, grams: r1(d.grams), ...Object.fromEntries(NUT.map((k) => [k, k === 'kcal' ? r0(d.nutrition[k]) : r1(d.nutrition[k])])),
          food_id: it.food_id, group_id: gid, source: 'photo', confidence: it.confidence, thumb: i === 0 ? ctx.thumb : '',
          details: { reasoning: it.reasoning, source: it.source, flags: it.flags, ingredients: d.ingredients.map((x) => ({ name: x.name, grams: r1(x.grams), hidden: x.hidden, source: x.source, nutrition: Object.fromEntries(NUT.map((k) => [k, r1(x.nutrition[k])])) })) } };
      });
      await api('/log', { body: { entries } });
      sh.close(); toast(`Logged ${entries.length} items, ${r0(totals().kcal)} kcal`); await loadDay(); render();
    };
  };
  draw();
}

// ---------------------------------------------------------------- LABEL flow
function labelFlow() {
  let photos = [];
  const sh = openSheet('Scan a food label', '');
  const draw = () => {
    sh.set(`
    <p class="small mute">Photograph the <b>nutrition table</b> on the back of the pack, flat and well lit. Add the front too if you like (name and brand). It is saved to <b>My foods</b>, so next time it is found by name, by barcode and in meal photos.</p>
    <div class="preview">${photos.map((p, i) => `<div class="pv"><img src="${p}"><button class="rm" data-i="${i}">✕</button></div>`).join('')}</div>
    ${photos.length < 3 ? `<div class="grid2"><button class="btn ghost" id="cam">📷 Take photo</button><button class="btn ghost" id="gal">🖼️ Gallery</button></div>` : ''}
    <button class="btn" id="go" style="margin-top:16px" ${photos.length ? '' : 'disabled'}>Read label</button>`);
    $('#cam', sh.el)?.addEventListener('click', async () => { photos.push(...await pickPhotos({ camera: true, max: 1900 })); photos = photos.slice(0, 3); draw(); });
    $('#gal', sh.el)?.addEventListener('click', async () => { photos.push(...await pickPhotos({ max: 1900 })); photos = photos.slice(0, 3); draw(); });
    sh.el.querySelectorAll('.rm').forEach((b) => b.onclick = () => { photos.splice(+b.dataset.i, 1); draw(); });
    $('#go', sh.el).onclick = run;
  };
  const run = async () => {
    sh.set(`<div class="scan"><img src="${photos[0]}" style="height:100%;width:100%;object-fit:cover;opacity:.5"></div><div class="ai-step">Reading the nutrition table…</div>`);
    try {
      const thumb = await thumbOf(photos[0]);
      const r = await api('/analyze/label', { body: { images: photos, thumb } });
      if (!r.ok) throw new Error(r.error);
      labelResult(sh, r);
    } catch (e) {
      sh.set(`<div class="banner bad">${esc(e.message)}</div><button class="btn ghost" id="retry">Try again</button>`);
      $('#retry', sh.el).onclick = draw;
    }
  };
  draw();
  setTimeout(() => $('#cam', sh.el)?.click(), 150);
}

function labelResult(sh, r) {
  const f = r.food;
  sh.title(r.created ? 'Saved to My foods ✓' : 'Updated in My foods ✓');
  sh.set(`
    ${r.warnings?.map((w) => `<div class="banner warn small">${esc(w)}</div>`).join('') || ''}
    <label>Name</label><input id="n" value="${esc(f.name)}"><label>Brand</label><input id="b" value="${esc(f.brand)}">
    <div class="grid2"><div><label>Serving (g)</label><input id="sg" type="number" value="${f.serving_g}"></div><div><label>Serving label</label><input id="sl" value="${esc(f.serving_label)}"></div></div>
    <div class="small mute" style="margin-top:12px">Per 100 g (check against the pack)</div>
    <div class="grid3">${[['kcal', 'kcal'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat'], ['fiber', 'Fibre'], ['sugar', 'Sugar'], ['sodium', 'Sodium mg']].map(([k, l]) => `<div><label>${l}</label><input data-k="${k}" type="number" inputmode="decimal" value="${r1(f[k])}"></div>`).join('')}</div>
    ${f.ingredients ? `<details style="margin-top:10px"><summary class="small mute">Ingredients</summary><div class="small mute">${esc(f.ingredients)}</div></details>` : ''}
    <label>Barcode (optional)</label><input id="bc" inputmode="numeric" value="${esc(f.barcode)}">
    <div class="grid2" style="margin-top:16px"><button class="btn ghost" id="save">Save corrections</button><button class="btn" id="use">Log it…</button></div>`);
  const collect = () => ({ name: $('#n', sh.el).value, brand: $('#b', sh.el).value, serving_g: Number($('#sg', sh.el).value) || 100, serving_label: $('#sl', sh.el).value, barcode: $('#bc', sh.el).value.replace(/\D/g, ''), ...Object.fromEntries([...sh.el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, Number(i.value) || 0])) });
  $('#save', sh.el).onclick = async () => { await api(`/foods/${f.id}`, { method: 'PUT', body: collect() }); toast('Saved'); };
  $('#use', sh.el).onclick = async () => { const nf = await api(`/foods/${f.id}`, { method: 'PUT', body: collect() }); sh.close(); amountSheet(nf, {}); };
}

// ---------------------------------------------------------------- SEARCH + amount
function searchSheet({ onConfirm, confirmLabel }) {
  const sh = openSheet('Search foods', `
    <input id="q" type="search" placeholder="Try: tim tam, roti, chicken biryani, 9300…" autocomplete="off">
    <div class="chips" id="cats" style="margin-top:8px"></div>
    <div id="res"></div>
    <div id="online"></div>`);
  let cat = '', mine = false, t;
  const cats = ['all', 'mine', 'meal prep', 'packaged', 'indian', 'protein', 'fruit', 'vegetable', 'dairy', 'bread', 'drink', 'fastfood', 'dessert', 'snack'];
  const drawCats = () => { $('#cats', sh.el).innerHTML = cats.map((c) => `<button class="${(c === 'all' && !cat && !mine) || c === cat || (c === 'mine' && mine) ? 'on' : ''}" data-c="${c}">${c === 'mine' ? '⭐ My foods' : c}</button>`).join(''); sh.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { mine = b.dataset.c === 'mine'; cat = ['all', 'mine'].includes(b.dataset.c) ? '' : b.dataset.c; drawCats(); go(); }); };
  const go = async () => {
    const q = $('#q', sh.el).value.trim();
    const isCode = /^\d{8,14}$/.test(q);
    if (isCode) {
      try {
        const r = await api(`/foods/barcode/${q}`);
        if (r.food) return showFood(r.food);
        if (r.off) { const imp = await api('/off/import', { body: { product: r.off } }); toast('Found online and saved'); return showFood(imp.food); }
      } catch (e) { $('#res', sh.el).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    }
    const list = await api(`/foods/search?q=${encodeURIComponent(q)}&category=${cat}&mine=${mine ? 1 : 0}&limit=40`);
    $('#res', sh.el).innerHTML = list.length ? list.map(foodRow).join('') : `<div class="empty">No match in the database.</div>`;
    sh.el.querySelectorAll('[data-fid]').forEach((b) => b.onclick = () => showFood(list.find((f) => f.id === +b.dataset.fid)));
    $('#online', sh.el).innerHTML = q.length > 1 ? `<button class="btn ghost" id="off" style="margin-top:6px">🌏 Search Open Food Facts (Australian products)</button><button class="btn ghost" id="barcode" style="margin-top:8px;display:${'BarcodeDetector' in window ? 'block' : 'none'}">📷 Scan barcode</button>` : ('BarcodeDetector' in window ? `<button class="btn ghost" id="barcode" style="margin-top:8px">📷 Scan barcode</button>` : '');
    $('#off', sh.el)?.addEventListener('click', () => online(q));
    $('#barcode', sh.el)?.addEventListener('click', scanBarcode);
  };
  const showFood = (f) => amountSheet(f, { onConfirm, confirmLabel, afterLog: () => { if (!onConfirm) sh.close(); } });
  const online = async (q) => {
    const box = $('#online', sh.el); box.innerHTML = '<div class="empty">Searching online…</div>';
    try {
      const list = await api(`/off/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = `<h2 style="font-size:15px">Online results</h2>` + (list.length ? list.map((p, i) => `<button class="entry" data-i="${i}"><div class="th">🌏</div><div class="grow"><div class="nm">${esc(p.name)}</div><div class="small mute">${esc(p.brand)} · ${r0(p.kcal)} kcal/100g</div></div><span class="chip a">save</span></button>`).join('') : '<div class="empty">Nothing found.</div>');
      box.querySelectorAll('[data-i]').forEach((b) => b.onclick = async () => { const imp = await api('/off/import', { body: { product: list[+b.dataset.i] } }); toast('Saved to My foods'); showFood(imp.food); });
    } catch (e) { box.innerHTML = `<div class="banner warn small">${esc(e.message)}</div>`; }
  };
  const scanBarcode = async () => {
    const v = document.createElement('video'); v.setAttribute('playsinline', ''); v.style.cssText = 'width:100%;border-radius:16px;margin-top:10px';
    const box = $('#online', sh.el); box.prepend(v);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('Camera not available'); return; }
    v.srcObject = stream; await v.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const stop = () => stream.getTracks().forEach((t2) => t2.stop());
    sh.el.querySelector('.x').addEventListener('click', stop, { once: true });
    const loop = async () => { if (!v.isConnected) return stop(); try { const c = await det.detect(v); if (c[0]) { stop(); v.remove(); $('#q', sh.el).value = c[0].rawValue; go(); return; } } catch { /* */ } requestAnimationFrame(loop); };
    loop();
  };
  $('#q', sh.el).oninput = () => { clearTimeout(t); t = setTimeout(go, 160); };
  drawCats(); go();
  if (!onConfirm) setTimeout(() => $('#q', sh.el).focus(), 200);
}

const foodRow = (f) => `<button class="entry" data-fid="${f.id}"><div class="th">${f.thumb ? `<img src="${esc(f.thumb)}">` : emoji(f.category)}</div><div class="grow"><div class="nm">${esc(f.brand ? f.brand + ' ' : '')}${esc(f.name)}</div><div class="small mute">${r0(f.kcal)} kcal/100g · ${esc(f.serving_label)} = ${r0((f.kcal * f.serving_g) / 100)} kcal${f.source !== 'seed' ? ' · ⭐ yours' : ''}</div></div></button>`;

function amountSheet(food, { onConfirm, confirmLabel = 'Log', afterLog } = {}) {
  const sh = openSheet(`${food.brand ? food.brand + ' ' : ''}${food.name}`, '');
  let grams = food.serving_g || 100, meal = defaultMeal();
  const draw = () => {
    const n = scaleN(food, grams / 100);
    sh.set(`
      <div class="card" style="margin-top:4px"><div class="spread"><div><div style="font-size:34px;font-weight:800">${r0(n.kcal)} <span class="small mute">kcal</span></div><div class="small mute">P ${r1(n.protein)} · C ${r1(n.carbs)} · F ${r1(n.fat)} · fibre ${r1(n.fiber)} · sugar ${r1(n.sugar)}</div></div>${food.thumb ? `<img src="${esc(food.thumb)}" style="height:60px;border-radius:12px">` : `<span style="font-size:40px">${emoji(food.category)}</span>`}</div></div>
      ${food.source === 'recipe' ? recipeSummary(food) : ''}
      <label>Amount (g or ml)</label><input id="g" type="number" inputmode="decimal" value="${r1(grams)}">
      <div class="chips" style="margin-top:8px"><button data-m="${food.serving_g}">1 × ${esc(food.serving_label)}</button><button data-m="${food.serving_g * 2}">2 ×</button><button data-m="${food.serving_g / 2}">½ ×</button><button data-m="100">100 g</button><button data-m="50">50 g</button><button data-m="200">200 g</button></div>
      ${onConfirm ? '' : `<label>Meal</label><select id="m">${MEALS.map(([k, l]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      <button class="btn" id="ok" style="margin-top:16px">${esc(confirmLabel)}</button>
      ${food.source !== 'seed' ? `<div class="grid2" style="margin-top:10px"><button class="btn ghost" id="edit">${food.source === 'recipe' ? 'Edit recipe' : 'Edit food'}</button><button class="btn danger" id="rm">Delete food</button></div>` : '<div class="small mute" style="margin-top:12px">Built-in values are typical averages. Scan your own pack for exact numbers and it will take priority.</div>'}`);
    $('#g', sh.el).oninput = (e) => { grams = Number(e.target.value) || 0; const n2 = scaleN(food, grams / 100); sh.el.querySelector('.card div div').firstChild.textContent = r0(n2.kcal) + ' '; };
    sh.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { grams = Number(b.dataset.m); draw(); });
    $('#m', sh.el)?.addEventListener('change', (e) => { meal = e.target.value; });
    $('#ok', sh.el).onclick = async () => {
      if (!(grams > 0)) return toast('Enter an amount');
      if (onConfirm) { onConfirm(food, grams); sh.close(); closeUpper(); return; }
      await api('/log/quick', { body: { food_id: food.id, grams, meal, date: state.date } });
      sh.close(); afterLog?.(); toast(`Logged ${r0(scaleN(food, grams / 100).kcal)} kcal`); await loadDay(); render();
    };
    $('#edit', sh.el)?.addEventListener('click', () => { sh.close(); if (food.source === 'recipe') editRecipe(food); else foodForm(food); });
    $('#rm', sh.el)?.addEventListener('click', async () => { if (confirm('Delete this food?')) { await api(`/foods/${food.id}`, { method: 'DELETE' }); sh.close(); toast('Deleted'); if (state.tab === 'foods') renderFoods(); } });
  };
  const closeUpper = () => { const top = sheetStack[sheetStack.length - 1]; if (top && top.title && top.el.querySelector('#q')) top.close(); };
  draw();
}

function foodForm(food = null) {
  const f = food || { name: '', brand: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '', sodium: '', serving_g: 100, serving_label: '1 serving', barcode: '' };
  const sh = openSheet(food ? 'Edit food' : 'New food', `
    <label>Name</label><input id="n" value="${esc(f.name)}" placeholder="e.g. Mum's chicken curry"><label>Brand (optional)</label><input id="b" value="${esc(f.brand)}">
    <div class="grid2"><div><label>Serving (g)</label><input id="sg" type="number" value="${f.serving_g}"></div><div><label>Serving name</label><input id="sl" value="${esc(f.serving_label)}"></div></div>
    <label>Values are</label><select id="per"><option value="100">per 100 g</option><option value="serving">per serving</option></select>
    <div class="grid3">${[['kcal', 'kcal'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat'], ['fiber', 'Fibre'], ['sugar', 'Sugar'], ['sodium', 'Sodium mg']].map(([k, l]) => `<div><label>${l}</label><input data-k="${k}" type="number" inputmode="decimal" value="${f[k] === '' ? '' : r1(f[k])}"></div>`).join('')}</div>
    <button class="btn" id="ok" style="margin-top:16px">Save</button>`);
  $('#ok', sh.el).onclick = async () => {
    const body = { name: $('#n', sh.el).value, brand: $('#b', sh.el).value, serving_g: Number($('#sg', sh.el).value) || 100, serving_label: $('#sl', sh.el).value, per: $('#per', sh.el).value, category: f.category || 'packaged', ...Object.fromEntries([...sh.el.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, Number(i.value) || 0])) };
    try {
      if (food) { await api(`/foods/${food.id}`, { method: 'PUT', body }); } else { await api('/foods', { body }); }
      sh.close(); toast('Saved'); if (state.tab === 'foods') renderFoods();
    } catch (e) { toast(e.message); }
  };
}

function quickAdd() {
  const sh = openSheet('Quick add', `
    <label>What was it?</label><input id="n" placeholder="e.g. Restaurant pasta">
    <div class="grid2"><div><label>Calories</label><input id="k" type="number" inputmode="decimal"></div><div><label>Protein g</label><input id="p" type="number" inputmode="decimal"></div><div><label>Carbs g</label><input id="c" type="number" inputmode="decimal"></div><div><label>Fat g</label><input id="f" type="number" inputmode="decimal"></div></div>
    <label>Meal</label><select id="m">${MEALS.map(([k, l]) => `<option value="${k}" ${k === defaultMeal() ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn" id="ok" style="margin-top:16px">Log</button>`);
  $('#ok', sh.el).onclick = async () => {
    const kcal = Number($('#k', sh.el).value);
    if (!(kcal >= 0) || !$('#k', sh.el).value) return toast('Enter calories');
    await api('/log', { body: { entries: [{ date: state.date, meal: $('#m', sh.el).value, name: $('#n', sh.el).value || 'Quick add', grams: 0, kcal, protein: Number($('#p', sh.el).value) || 0, carbs: Number($('#c', sh.el).value) || 0, fat: Number($('#f', sh.el).value) || 0, source: 'quick' }] } });
    sh.close(); await loadDay(); render();
  };
}


// ---------------------------------------------------------------- MEAL PREP / RECIPES
const pickNut = (f) => Object.fromEntries(NUT.map((k) => [k, Number(f[k]) || 0]));

function recipeSummary(food) {
  let r; try { r = JSON.parse(food.recipe || '{}'); } catch { return ''; }
  if (!r.ingredients?.length) return '';
  return `<details style="margin:8px 0"><summary class="small mute">🍱 ${r.ingredients.length} ingredients · ${r0(r.total_cooked_g)} g cooked · ${r.portions} portions</summary><div class="ing">${r.ingredients.map((i) => `<div><span>${esc(i.name)}${i.hidden ? ' <span class="chip w">hidden</span>' : ''}</span><span class="mute">${r0(i.grams)} g</span></div>`).join('')}</div></details>`;
}

function editRecipe(food) {
  let r = {}; try { r = JSON.parse(food.recipe || '{}'); } catch { /* */ }
  recipeEditor({ id: food.id, name: food.name, total: r.total_cooked_g, portions: r.portions, ings: (r.ingredients || []).map((i) => ({ ...i, source: 'saved' })), answers: r.answers || [] });
}

function recipeFlow() {
  const sh = openSheet('Meal prep / cooked batch', `
    <p class="small mute">Cook once, log portions all week. Tell me what went in (raw weights are best) and the weight of the whole finished pot. It is saved, so next time you just pick it, and meal photos will recognise it.</p>
    <label>What did you cook?</label>
    <textarea id="txt" rows="5" placeholder="e.g. Chicken rice for the week: 1 kg chicken thigh, 500 g basmati (dry), 3 tbsp oil, 2 onions, 1 tin tomatoes. Cooked weight 2.6 kg, 8 portions"></textarea>
    <button class="btn" id="go" style="margin-top:14px">Build recipe with AI</button>
    <button class="btn ghost" id="manual" style="margin-top:10px">Add ingredients manually</button>`);
  $('#manual', sh.el).onclick = () => { sh.close(); recipeEditor({}); };
  $('#go', sh.el).onclick = async () => {
    const text = $('#txt', sh.el).value.trim();
    if (!text) return toast('Describe what you cooked first');
    sh.set('<div class="scan"><span style="font-size:46px;position:relative">🍱</span></div><div class="ai-step">Working out ingredients and weights…</div>');
    try {
      const r = await api('/recipes/parse', { body: { text } });
      sh.close();
      recipeEditor({ name: r.name, total: r.total_cooked_g, portions: r.portions, ings: r.ingredients, questions: r.questions, warnings: r.warnings, text });
    } catch (e) {
      sh.set(`<div class="banner bad">${esc(e.message)}</div><button class="btn ghost" id="back">Back</button>`);
      $('#back', sh.el).onclick = () => { sh.close(); recipeFlow(); };
    }
  };
}

function recipeEditor(init) {
  const R = { id: init.id, name: init.name || '', total: init.total || '', portions: init.portions || '', ings: (init.ings || []).map((i) => ({ ...i })), questions: init.questions || [], ans: {}, answers: init.answers || [], text: init.text || '', warnings: init.warnings || [] };
  const sh = openSheet(R.id ? 'Edit recipe' : 'Your recipe', '');
  const calc = () => {
    const tot = sumN(R.ings.map((i) => scaleN(i.per100, (Number(i.grams) || 0) / 100)));
    const raw = R.ings.reduce((s, i) => s + (Number(i.grams) || 0), 0);
    const cooked = Number(R.total) > 0 ? Number(R.total) : raw;
    const n = Math.max(1, Number(R.portions) || 1);
    const per100 = scaleN(tot, 100 / (cooked || 1)), sg = cooked / n;
    return { tot, raw, cooked, n, per100, sg, per: scaleN(per100, sg / 100) };
  };
  const drawSum = () => {
    const c = calc(), el = $('#rsum', sh.el); if (!el) return;
    el.innerHTML = R.ings.length ? `<div class="spread"><div><div style="font-size:34px;font-weight:800">${r0(c.per.kcal)} <span class="small mute">kcal / portion</span></div>
      <div class="small mute">P ${r0(c.per.protein)} · C ${r0(c.per.carbs)} · F ${r0(c.per.fat)} · 1 portion = ${r0(c.sg)} g</div></div><span style="font-size:36px">🍱</span></div>
      <div class="small mute" style="margin-top:8px">Whole batch ${r0(c.tot.kcal).toLocaleString()} kcal · ${r0(c.per100.kcal)} kcal per 100 g cooked · ${r0(c.raw)} g raw → ${r0(c.cooked)} g ${Number(R.total) > 0 ? 'cooked' : '(set cooked weight!)'}</div>` : '<div class="small mute">Add ingredients to see the numbers.</div>';
    sh.el.querySelectorAll('[data-rk]').forEach((s) => { const i = R.ings[+s.dataset.rk]; if (i) s.textContent = r0(scaleN(i.per100, (Number(i.grams) || 0) / 100).kcal) + ' kcal'; });
  };
  const redraw = () => { const bd = sh.el.querySelector('.bd'); const y = bd.scrollTop; draw(); bd.scrollTop = y; };
  const draw = () => {
    sh.set(`
      <label>Name</label><input id="rn" value="${esc(R.name)}" placeholder="e.g. Sunday chicken rice">
      ${R.warnings.map((w) => `<div class="banner warn small">${esc(w)}</div>`).join('')}
      <label>Ingredients (raw / as added)</label>
      ${R.ings.map((i, k) => `<div class="ingrow"><div><div>${esc(i.name)}${i.hidden ? ' <span class="chip w">hidden</span>' : ''}</div><div class="small mute"><span class="chip ${i.source === 'ai' || i.source === 'unknown' ? 'w' : ''}">${srcLabel[i.source] || i.source || 'database'}</span> <span data-rk="${k}"></span></div></div><input type="number" inputmode="decimal" data-g="${k}" value="${r1(i.grams)}"><button class="step" data-rm="${k}" style="width:30px;height:30px;border-radius:9px;background:var(--card2)">✕</button></div>`).join('') || '<div class="small mute">No ingredients yet.</div>'}
      <button class="btn ghost" id="addi" style="margin-top:10px">+ Add ingredient</button>
      <div class="grid2"><div><label>Total cooked weight (g)</label><input id="rt" type="number" inputmode="decimal" value="${R.total}" placeholder="weigh the whole pot"></div><div><label>Portions</label><input id="rp" type="number" inputmode="decimal" value="${R.portions}" placeholder="e.g. 8"></div></div>
      <div class="card" id="rsum" style="margin-top:14px"></div>
      ${R.questions.length && R.text ? `<div class="card qcard"><b>A few quick questions</b><div class="small mute">Answers sharpen the numbers and are remembered.</div>${R.questions.map((q, qi) => `<div class="q" data-q="${qi}"><div>${esc(q.question)}</div><div class="chips">${q.options.map((o) => `<button data-opt="${esc(o)}" class="${R.ans[qi] === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div><input data-free placeholder="or type your own"></div>`).join('')}<button class="btn" id="rask">Update with my answers</button><div class="small mute" style="margin-top:6px">This rebuilds the ingredient list, so do manual edits after.</div></div>` : ''}
      <button class="btn" id="rsave" style="margin-top:6px">${R.id ? 'Save changes' : 'Save recipe'}</button>`);
    $('#rn', sh.el).oninput = (e) => { R.name = e.target.value; };
    $('#rt', sh.el).oninput = (e) => { R.total = e.target.value; drawSum(); };
    $('#rp', sh.el).oninput = (e) => { R.portions = e.target.value; drawSum(); };
    sh.el.querySelectorAll('[data-g]').forEach((inp) => inp.oninput = () => { R.ings[+inp.dataset.g].grams = Number(inp.value) || 0; drawSum(); });
    sh.el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { R.ings.splice(+b.dataset.rm, 1); redraw(); });
    $('#addi', sh.el).onclick = () => searchSheet({ confirmLabel: 'Add ingredient', onConfirm: (food, grams) => { R.ings.push({ name: food.name, grams, hidden: false, per100: pickNut(food), source: food.source === 'seed' ? 'db' : 'saved', food_id: food.id }); redraw(); } });
    sh.el.querySelectorAll('.q').forEach((qel) => {
      const qi = +qel.dataset.q;
      qel.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => { R.ans[qi] = R.ans[qi] === b.dataset.opt ? '' : b.dataset.opt; redraw(); });
      $('[data-free]', qel).oninput = (e) => { R.ans[qi] = e.target.value.trim(); qel.querySelectorAll('[data-opt]').forEach((b) => b.classList.remove('on')); };
    });
    $('#rask', sh.el)?.addEventListener('click', async () => {
      const fresh = R.questions.map((q, qi) => ({ item_name: q.item_name, question: q.question, answer: R.ans[qi] || '' })).filter((a) => a.answer);
      if (!fresh.length) return toast('Pick or type an answer first');
      R.answers = [...R.answers, ...fresh];
      sh.set('<div class="scan"><span style="font-size:46px;position:relative">🍱</span></div><div class="ai-step">Updating the recipe…</div>');
      try {
        const r = await api('/recipes/parse', { body: { text: R.text, answers: R.answers } });
        R.ings = r.ingredients; R.questions = r.questions; R.ans = {}; R.warnings = r.warnings;
        if (!R.name) R.name = r.name; if (!(Number(R.total) > 0) && r.total_cooked_g) R.total = r.total_cooked_g; if (!(Number(R.portions) > 0) && r.portions) R.portions = r.portions;
      } catch (e) { toast(e.message); }
      draw();
    });
    $('#rsave', sh.el).onclick = async () => {
      if (!R.name.trim()) return toast('Give it a name');
      if (!R.ings.length) return toast('Add at least one ingredient');
      try {
        const res = await api('/recipes', { body: { id: R.id, name: R.name, total_cooked_g: Number(R.total) || 0, portions: Number(R.portions) || 1, answers: R.answers, ingredients: R.ings.map((i) => ({ name: i.name, grams: Number(i.grams) || 0, hidden: !!i.hidden, food_id: i.food_id ?? null, per100: i.per100 })) } });
        sh.close(); toast('Recipe saved. Log a portion any time.'); amountSheet(res.food, {});
      } catch (e) { toast(e.message); }
    };
    drawSum();
  };
  draw();
}

// ---------------------------------------------------------------- FOODS tab
async function renderFoods() {
  $('#view').innerHTML = `<h2>Food database</h2><input id="fq" type="search" placeholder="Search ${state.foodCount || ''} foods…" value="${esc(state.foodsQ)}"><div class="chips" id="fc" style="margin-top:10px"></div><div id="fl"></div><button class="btn ghost" id="nf" style="margin-top:14px">+ Create my own food</button><button class="btn ghost" id="off" style="margin-top:10px">🌏 Find a product online</button>`;
  const cats = await api('/foods/categories');
  const draw = () => { $('#fc').innerHTML = [['', 'All'], ['__mine', '⭐ Mine'], ...cats.map((c) => [c.name, `${c.name} ${c.count}`])].map(([v, l]) => `<button class="${(v === '__mine' ? state.foodsMine : !state.foodsMine && v === state.foodsCat) ? 'on' : ''}" data-v="${v}">${esc(l)}</button>`).join(''); document.querySelectorAll('#fc [data-v]').forEach((b) => b.onclick = () => { state.foodsMine = b.dataset.v === '__mine'; state.foodsCat = state.foodsMine ? '' : b.dataset.v; draw(); load(); }); };
  const load = async () => {
    const list = await api(`/foods/search?q=${encodeURIComponent(state.foodsQ)}&category=${state.foodsCat}&mine=${state.foodsMine ? 1 : 0}&limit=60`);
    $('#fl').innerHTML = list.length ? list.map(foodRow).join('') : '<div class="empty">Nothing here yet. Scan a label with the + button and it will show up under ⭐ Mine.</div>';
    document.querySelectorAll('#fl [data-fid]').forEach((b) => b.onclick = () => amountSheet(list.find((f) => f.id === +b.dataset.fid), {}));
  };
  let t; $('#fq').oninput = (e) => { state.foodsQ = e.target.value; clearTimeout(t); t = setTimeout(load, 160); };
  $('#nf').onclick = () => foodForm(); $('#off').onclick = () => searchSheet({});
  draw(); load();
}

// ---------------------------------------------------------------- TRENDS
async function renderTrends() {
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  const from = addDays(today(), -13);
  const [sum, weights] = await Promise.all([api(`/summary?from=${from}&to=${today()}`), api('/weights')]);
  const map = new Map(sum.map((d) => [d.date, d]));
  const days = Array.from({ length: 14 }, (_, i) => { const d = addDays(from, i); return { date: d, kcal: map.get(d)?.kcal || 0, protein: map.get(d)?.protein || 0, has: !!map.get(d) }; });
  const g = goal(), tdee = Number(state.settings.tdee) || 0;
  const logged = days.filter((d) => d.has && d.date !== today());
  const avg = logged.length ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;
  const def = tdee && logged.length ? tdee - avg : null;
  const W = 520, H = 170, pad = 22, max = Math.max(g.kcal * 1.25, ...days.map((d) => d.kcal), 1);
  const bw = (W - pad * 2) / 14;
  const bars = days.map((d, i) => { const h = ((H - 40) * d.kcal) / max; const over = d.kcal > g.kcal; return `<rect x="${pad + i * bw + 3}" y="${H - 22 - h}" width="${bw - 6}" height="${Math.max(h, d.has ? 2 : 0)}" rx="4" fill="${over ? 'var(--bad)' : 'var(--accent)'}" opacity="${d.has ? 1 : 0.15}"/><text x="${pad + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${d.date.slice(8)}</text>`; }).join('');
  const gy = H - 22 - ((H - 40) * g.kcal) / max;
  const chart = `<svg viewBox="0 0 ${W} ${H}" width="100%">${bars}<line x1="${pad}" x2="${W - pad}" y1="${gy}" y2="${gy}" stroke="var(--warn)" stroke-dasharray="4 4"/><text x="${W - pad}" y="${gy - 4}" text-anchor="end">target ${r0(g.kcal)}</text></svg>`;

  let wchart = '<div class="empty small">Log your weight to see the trend.</div>';
  if (weights.length > 1) {
    const ws = weights.slice(-30), mn = Math.min(...ws.map((w) => w.kg)) - 0.5, mx = Math.max(...ws.map((w) => w.kg)) + 0.5;
    const pts = ws.map((w, i) => [pad + (i * (W - pad * 2)) / (ws.length - 1), 12 + (H - 40) * (1 - (w.kg - mn) / (mx - mn))]);
    wchart = `<svg viewBox="0 0 ${W} ${H}" width="100%"><polyline fill="none" stroke="var(--accent2)" stroke-width="3" stroke-linejoin="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--accent2)"/>`).join('')}<text x="${pad}" y="${H - 6}">${ws[0].date.slice(5)}</text><text x="${W - pad}" y="${H - 6}" text-anchor="end">${ws[ws.length - 1].date.slice(5)}</text><text x="${pad}" y="12">${mx.toFixed(1)}</text><text x="${pad}" y="${H - 26}">${mn.toFixed(1)}</text></svg>`;
  }
  const lw = weights[weights.length - 1], fw = weights[0];
  $('#view').innerHTML = `
    <h2>Last 14 days</h2><div class="card">${chart}</div>
    <div class="grid2"><div class="card stat"><b>${logged.length ? r0(avg) : '–'}</b><span>avg kcal / day</span></div><div class="card stat"><b>${def == null ? '–' : (def >= 0 ? '−' : '+') + r0(Math.abs(def))}</b><span>avg vs maintenance${tdee ? '' : ' (set profile)'}</span></div>
    <div class="card stat"><b>${def == null ? '–' : r1((def * 7) / 7700)} kg</b><span>projected fat loss / week</span></div><div class="card stat"><b>${logged.length ? r0(logged.reduce((s, d) => s + d.protein, 0) / logged.length) : '–'} g</b><span>avg protein / day</span></div></div>
    <h2>Weight</h2><div class="card">${wchart}${weights.length > 1 ? `<div class="small mute" style="margin-top:6px">${lw.kg - fw.kg <= 0 ? 'Down' : 'Up'} ${Math.abs(r1(lw.kg - fw.kg))} kg since ${fw.date}</div>` : ''}
      <div class="row" style="margin-top:10px"><input id="wk" type="number" step="0.1" inputmode="decimal" placeholder="Today's weight (kg)" value="${lw?.date === today() ? lw.kg : ''}"><button class="btn sm" id="wsave" style="white-space:nowrap">Save</button></div></div>`;
  $('#wsave').onclick = async () => { try { await api('/weights', { body: { kg: Number($('#wk').value) } }); toast('Weight saved'); renderTrends(); } catch (e) { toast(e.message); } };
}

// ---------------------------------------------------------------- SETTINGS
function calcPlan(s) {
  const w = +s.weight_kg, h = +s.height_cm, a = +s.age;
  if (!(w && h && a)) return null;
  const bmr = 10 * w + 6.25 * h - 5 * a + (s.sex === 'female' ? -161 : 5);
  const tdee = bmr * (+s.activity || 1.375);
  const loss = +s.weekly_loss_kg || 0.5;
  const floor = s.sex === 'female' ? 1200 : 1500;
  const target = Math.max(floor, Math.round(tdee - (loss * 7700) / 7));
  const protein = Math.round(w * 1.8), fat = Math.round((target * 0.25) / 9), carbs = Math.max(0, Math.round((target - protein * 4 - fat * 9) / 4));
  return { bmr: r0(bmr), tdee: r0(tdee), target, protein, fat, carbs, floored: target === floor };
}
function renderSettings() {
  const s = state.settings, ai = state.ai;
  $('#view').innerHTML = `
  <h2>OpenAI (photo + label reading)</h2>
  <div class="card">
    ${ai.mock ? '<div class="banner info small">Demo mode: canned AI answers. Start the server without CAL_MOCK_AI for the real thing.</div>' : ai.has_key ? `<div class="banner ok small">Key saved ✓ (${ai.key_source === 'phone' ? 'stored on this phone only' : 'from ' + esc(ai.key_source)}). You never have to type it again.</div>` : '<div class="banner warn small">No key yet. Paste it once below, it is stored on this machine only.</div>'}
    <label>API key</label><input id="key" type="password" autocomplete="off" placeholder="${ai.has_key ? '•••••••••••• (leave blank to keep)' : 'sk-…'}">
    <label>Vision model</label><input id="model" value="${esc(ai.model)}">
    <label>Analysis passes (more = steadier estimates, costs more)</label><select id="passes">${[1, 2, 3].map((n) => `<option value="${n}" ${(+s.ai_passes || 2) === n ? 'selected' : ''}>${n} ${n === 2 ? '(recommended)' : ''}</option>`).join('')}</select>
    <button class="btn" id="saveai" style="margin-top:14px">Save AI settings</button>
    ${ai.has_key && ai.key_source !== 'mock' ? '<button class="btn danger" id="clearkey" style="margin-top:10px">Remove saved key</button>' : ''}
  </div>
  <h2>My deficit plan</h2>
  <div class="card">
    <div class="grid2"><div><label>Sex</label><select id="sex"><option value="male" ${s.sex !== 'female' ? 'selected' : ''}>Male</option><option value="female" ${s.sex === 'female' ? 'selected' : ''}>Female</option></select></div><div><label>Age</label><input id="age" type="number" value="${esc(s.age || '')}"></div>
    <div><label>Height (cm)</label><input id="h" type="number" value="${esc(s.height_cm || '')}"></div><div><label>Weight (kg)</label><input id="w" type="number" step="0.1" value="${esc(s.weight_kg || '')}"></div></div>
    <label>Activity</label><select id="act">${[[1.2, 'Desk job, little exercise'], [1.375, 'Light (1-3 workouts/week)'], [1.55, 'Moderate (3-5/week)'], [1.725, 'Very active (6-7/week)']].map(([v, l]) => `<option value="${v}" ${+(s.activity || 1.375) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Target loss per week</label><select id="loss">${[0.25, 0.5, 0.75, 1].map((v) => `<option value="${v}" ${+(s.weekly_loss_kg || 0.5) === v ? 'selected' : ''}>${v} kg / week</option>`).join('')}</select>
    <div id="plan"></div>
    <button class="btn" id="saveplan" style="margin-top:14px">Apply plan</button>
    <div class="small mute" style="margin-top:10px">Estimate only (Mifflin-St Jeor). Adjust after 2-3 weeks of real weigh-ins. Not medical advice.</div>
  </div>
  <h2>Or set targets by hand</h2>
  <div class="card"><div class="grid2"><div><label>Calories</label><input id="gk" type="number" value="${esc(s.goal_kcal || '')}"></div><div><label>Protein g</label><input id="gp" type="number" value="${esc(s.goal_protein || '')}"></div><div><label>Carbs g</label><input id="gc" type="number" value="${esc(s.goal_carbs || '')}"></div><div><label>Fat g</label><input id="gf" type="number" value="${esc(s.goal_fat || '')}"></div></div><button class="btn ghost" id="savegoal" style="margin-top:12px">Save targets</button></div>
  <h2>What I remember about how you cook</h2>
  <div class="card"><div id="habits" class="small mute">Loading…</div></div>
  ${ai.local ? `<h2>Backup</h2><div class="card"><div class="small mute">Everything (diary, scanned products, recipes, weights, habits) lives on this phone. Your OpenAI key is never included. Save a backup file now and then, especially before switching phones.</div><div class="grid2" style="margin-top:12px"><button class="btn ghost" id="bk">Download backup</button><button class="btn ghost" id="rs">Restore backup</button></div></div>` : ''}`;
  const prof = () => ({ sex: $('#sex').value, age: $('#age').value, height_cm: $('#h').value, weight_kg: $('#w').value, activity: $('#act').value, weekly_loss_kg: $('#loss').value });
  const showPlan = () => { const p = calcPlan(prof()); $('#plan').innerHTML = p ? `<div class="banner ok" style="margin-top:12px">Maintenance <b>${p.tdee}</b> kcal → eat <b>${p.target}</b> kcal/day<br><span class="small">Protein ${p.protein} g · Carbs ${p.carbs} g · Fat ${p.fat} g${p.floored ? '<br>Held at a safe minimum, so your real loss rate will be slower.' : ''}</span></div>` : '<div class="small mute" style="margin-top:10px">Fill in age, height and weight.</div>'; };
  ['sex', 'age', 'h', 'w', 'act', 'loss'].forEach((id) => $('#' + id).addEventListener('input', showPlan)); showPlan();
  $('#saveplan').onclick = async () => { const p = calcPlan(prof()); if (!p) return toast('Fill in age, height and weight'); await api('/settings', { body: { ...prof(), goal_kcal: p.target, goal_protein: p.protein, goal_carbs: p.carbs, goal_fat: p.fat, tdee: p.tdee } }); await api('/weights', { body: { kg: Number(prof().weight_kg) } }).catch(() => {}); toast('Plan applied'); await loadSettings(); renderSettings(); };
  $('#savegoal').onclick = async () => { await api('/settings', { body: { goal_kcal: $('#gk').value, goal_protein: $('#gp').value, goal_carbs: $('#gc').value, goal_fat: $('#gf').value } }); toast('Saved'); await loadSettings(); };
  $('#saveai').onclick = async () => {
    try {
      const body = { model: $('#model').value }; if ($('#key').value.trim()) body.key = $('#key').value.trim();
      await api('/settings/openai', { body }); await api('/settings', { body: { ai_passes: $('#passes').value } });
      toast('AI settings saved'); await loadSettings(); render();
    } catch (e) { toast(e.message); }
  };
  $('#bk')?.addEventListener('click', async () => {
    const data = await api('/backup');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `leanmode-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove();
    toast('Backup saved to your downloads');
  });
  $('#rs')?.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        if (!confirm('Replace everything on this phone with the backup?')) return;
        const r = await api('/restore', { body: { data } });
        toast(`Restored ${r.entries} entries and ${r.foods} foods`); await refresh();
      } catch (e) { toast(e.message || 'Could not read that file'); }
    };
    inp.click();
  });
  api('/habits').then((h) => {
    const box = $('#habits'); if (!box) return;
    box.innerHTML = h.length ? `<div class="ing" style="border:0;margin:0;padding:0">${h.map((x) => `<div><span>${x.item ? `<b>${esc(x.item)}</b>: ` : ''}${esc(x.question)}</span><span style="color:var(--text)">${esc(x.answer)}</span></div>`).join('')}</div><button class="btn danger sm" id="clrh" style="margin-top:12px">Forget these</button><div style="margin-top:8px">The AI uses these as defaults when it analyses photos, and only asks again when something looks different.</div>` : 'Nothing yet. When the AI asks a question (like how much oil) and you answer, it is remembered here.';
    $('#clrh')?.addEventListener('click', async () => { await api('/habits', { method: 'DELETE' }); renderSettings(); });
  }).catch(() => {});
  $('#clearkey')?.addEventListener('click', async () => { await api('/settings/openai', { body: { key: '' } }); await loadSettings(); render(); });
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') { state.tab = b.dataset.tab; if (state.tab === 'today') loadDay().then(render); else render(); }
  else if (a === 'add') addMenu();
  else if (a === 'day') { const n = addDays(state.date, +b.dataset.d); if (n <= today()) { state.date = n; loadDay().then(render); } }
  else if (a === 'entry') entrySheet(+b.dataset.id);
  else if (a === 'dismiss-install') { try { localStorage.setItem('lm_install_dismissed', '1'); } catch { /* */ } render(); }
});

async function initBackend() {
  try { // a LeanMode server on the same address? use it. Otherwise run fully on this phone.
    const r = await fetch('api/status', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) return;
  } catch { /* no server */ }
  const [{ createLocalApi }, { idbStorage }] = await Promise.all([import('./local-api.js'), import('./local-storage.js')]);
  const seedText = await (await fetch(new URL('./core/foods.txt', import.meta.url))).text();
  localApi = await createLocalApi({ storage: idbStorage(), seedText });
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict our data
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  try {
    await initBackend();
    const st = await api('/status'); state.foodCount = st.foods;
    await refresh();
  } catch (e) { $('#view').innerHTML = `<div class="banner bad">Cannot reach the server: ${esc(e.message)}</div>`; }
})();
