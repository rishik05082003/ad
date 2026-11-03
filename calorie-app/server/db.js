import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { NUTRIENTS } from './nutrition.js';

const DB_PATH = process.env.CAL_DB || path.join(DATA_DIR, 'leanmode.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_key TEXT UNIQUE,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  aliases TEXT DEFAULT '',
  kcal REAL DEFAULT 0, protein REAL DEFAULT 0, carbs REAL DEFAULT 0, fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0, sugar REAL DEFAULT 0, sodium REAL DEFAULT 0,
  serving_g REAL DEFAULT 100,
  serving_label TEXT DEFAULT '100 g',
  category TEXT DEFAULT 'other',
  source TEXT DEFAULT 'custom',
  barcode TEXT DEFAULT '',
  ingredients TEXT DEFAULT '',
  thumb TEXT DEFAULT '',
  recipe TEXT DEFAULT '',
  use_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal TEXT DEFAULT 'snack',
  name TEXT NOT NULL,
  grams REAL DEFAULT 0,
  kcal REAL DEFAULT 0, protein REAL DEFAULT 0, carbs REAL DEFAULT 0, fat REAL DEFAULT 0,
  fiber REAL DEFAULT 0, sugar REAL DEFAULT 0, sodium REAL DEFAULT 0,
  food_id INTEGER,
  group_id TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  confidence REAL,
  details TEXT DEFAULT '',
  thumb TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_log_date ON log(date);
CREATE TABLE IF NOT EXISTS habits (
  item_norm TEXT NOT NULL, question_norm TEXT NOT NULL, item TEXT DEFAULT '', question TEXT NOT NULL, answer TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (item_norm, question_norm)
);
CREATE TABLE IF NOT EXISTS weights (date TEXT PRIMARY KEY, kg REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// migrate databases created before recipes existed
if (!db.prepare('PRAGMA table_info(foods)').all().some((c) => c.name === 'recipe')) db.exec("ALTER TABLE foods ADD COLUMN recipe TEXT DEFAULT ''");

// ---------- helpers ----------
const nul = (v) => (v === undefined ? null : v);
const run = (sql, ...p) => db.prepare(sql).run(...p.map(nul));
const get = (sql, ...p) => db.prepare(sql).get(...p.map(nul));
const all = (sql, ...p) => db.prepare(sql).all(...p.map(nul));

// ---------- seed ----------
import { parseSeed, SEED_FILE } from './seed.js';
export { parseSeed, SEED_FILE };

export function seedIfNeeded() {
  const text = fs.readFileSync(SEED_FILE, 'utf8');
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  if (getSetting('seed_hash') === hash) return 0;
  const rows = parseSeed(text);
  db.exec('BEGIN');
  try {
    const stmt = db.prepare(`INSERT INTO foods (seed_key,name,aliases,kcal,protein,carbs,fat,fiber,sugar,sodium,serving_g,serving_label,category,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'seed')
      ON CONFLICT(seed_key) DO UPDATE SET name=excluded.name, aliases=excluded.aliases, kcal=excluded.kcal, protein=excluded.protein,
        carbs=excluded.carbs, fat=excluded.fat, fiber=excluded.fiber, sugar=excluded.sugar, sodium=excluded.sodium,
        serving_g=excluded.serving_g, serving_label=excluded.serving_label, category=excluded.category`);
    for (const r of rows) {
      stmt.run(r.name.toLowerCase(), r.name, r.aliases, r.kcal, r.protein, r.carbs, r.fat, r.fiber, r.sugar, r.sodium, r.serving_g, r.serving_label, r.category);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  setSetting('seed_hash', hash);
  invalidateFoods();
  return rows.length;
}

// ---------- settings ----------
export function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}
export function allSettings() {
  const out = {};
  for (const r of all('SELECT key,value FROM settings')) if (r.key !== 'seed_hash') out[r.key] = r.value;
  return out;
}

// ---------- foods ----------
let cache = null;
export const invalidateFoods = () => { cache = null; };
export function allFoods() {
  if (!cache) cache = all('SELECT * FROM foods');
  return cache;
}
export const getFood = (id) => get('SELECT * FROM foods WHERE id=?', id);
export const foodByBarcode = (code) => (code ? get("SELECT * FROM foods WHERE barcode=? AND barcode<>''", code) : null);

const FOOD_COLS = ['name', 'brand', 'aliases', ...NUTRIENTS, 'serving_g', 'serving_label', 'category', 'source', 'barcode', 'ingredients', 'thumb', 'recipe'];

export function insertFood(f) {
  const vals = FOOD_COLS.map((k) => f[k] ?? (NUTRIENTS.includes(k) || k === 'serving_g' ? 0 : ''));
  const r = run(`INSERT INTO foods (${FOOD_COLS.join(',')}) VALUES (${FOOD_COLS.map(() => '?').join(',')})`, ...vals);
  invalidateFoods();
  return getFood(Number(r.lastInsertRowid));
}
export function updateFood(id, f) {
  const cur = getFood(id);
  if (!cur) return null;
  const merged = { ...cur, ...f };
  run(`UPDATE foods SET ${FOOD_COLS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...FOOD_COLS.map((k) => merged[k] ?? ''), id);
  invalidateFoods();
  return getFood(id);
}
export function deleteFood(id) {
  const f = getFood(id);
  if (!f || f.source === 'seed') return false;
  run('DELETE FROM foods WHERE id=?', id);
  invalidateFoods();
  return true;
}
export function bumpUse(id) {
  if (id) { run('UPDATE foods SET use_count=use_count+1 WHERE id=?', id); invalidateFoods(); }
}
/** Foods the user created or scanned. Used so photo analysis can recognise their packaged products later. */
export function savedProducts(limit = 80) {
  return all("SELECT * FROM foods WHERE source<>'seed' ORDER BY (source='recipe') DESC, use_count DESC, id DESC LIMIT ?", limit);
}

// ---------- habits (answers to clarifying questions, remembered) ----------
const hnorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
let lastTs = 0; // monotonic so the most recently answered habit always sorts first
export function saveHabits(list) {
  for (const h of list || []) {
    if (!h?.question || !String(h.answer || '').trim()) continue;
    lastTs = Math.max(Date.now(), lastTs + 1);
    run(`INSERT INTO habits(item_norm,question_norm,item,question,answer,updated_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(item_norm,question_norm) DO UPDATE SET answer=excluded.answer, question=excluded.question, item=excluded.item, updated_at=excluded.updated_at`,
      hnorm(h.item_name), hnorm(h.question), String(h.item_name || '').slice(0, 80), String(h.question).slice(0, 200), String(h.answer).slice(0, 200), String(lastTs));
  }
  run('DELETE FROM habits WHERE rowid NOT IN (SELECT rowid FROM habits ORDER BY updated_at DESC, rowid DESC LIMIT 60)');
}
export const listHabits = (limit = 25) => all('SELECT item,question,answer FROM habits ORDER BY updated_at DESC, rowid DESC LIMIT ?', limit);
export const deleteHabits = () => run('DELETE FROM habits');

// ---------- log ----------
const LOG_COLS = ['date', 'meal', 'name', 'grams', ...NUTRIENTS, 'food_id', 'group_id', 'source', 'confidence', 'details', 'thumb'];
export function addLog(e) {
  const vals = LOG_COLS.map((k) => {
    let v = e[k];
    if (k === 'details' && v && typeof v !== 'string') v = JSON.stringify(v);
    if (v === undefined || v === null) return ['food_id', 'confidence'].includes(k) ? null : (NUTRIENTS.includes(k) || k === 'grams' ? 0 : '');
    return v;
  });
  const r = run(`INSERT INTO log (${LOG_COLS.join(',')}) VALUES (${LOG_COLS.map(() => '?').join(',')})`, ...vals);
  bumpUse(e.food_id);
  return Number(r.lastInsertRowid);
}
export const logForDate = (date) => all('SELECT * FROM log WHERE date=? ORDER BY id', date);
export const getLog = (id) => get('SELECT * FROM log WHERE id=?', id);
export function updateLog(id, f) {
  const cur = getLog(id);
  if (!cur) return null;
  const m = { ...cur, ...f };
  if (m.details && typeof m.details !== 'string') m.details = JSON.stringify(m.details);
  run(`UPDATE log SET ${LOG_COLS.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...LOG_COLS.map((k) => m[k] ?? null), id);
  return getLog(id);
}
export const deleteLog = (id) => run('DELETE FROM log WHERE id=?', id).changes > 0;
export function deleteLogGroup(groupId) {
  return groupId ? run('DELETE FROM log WHERE group_id=?', groupId).changes : 0;
}
export function dailySummary(from, to) {
  return all(`SELECT date, SUM(kcal) kcal, SUM(protein) protein, SUM(carbs) carbs, SUM(fat) fat, COUNT(*) entries
              FROM log WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`, from, to);
}

// ---------- weights ----------
export const listWeights = (limit = 120) => all('SELECT * FROM weights ORDER BY date DESC LIMIT ?', limit).reverse();
export const setWeight = (date, kg) => run('INSERT INTO weights(date,kg) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET kg=excluded.kg', date, kg);
export const deleteWeight = (date) => run('DELETE FROM weights WHERE date=?', date);
