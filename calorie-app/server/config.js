// Where the OpenAI key lives. The browser never sees it.
//
// Lookup order:
//   1. OPENAI_API_KEY environment variable
//   2. data/secrets.json (written by the Settings screen, chmod 600, git-ignored)
//   3. .env file next to package.json (git-ignored)
//
// Enter it once and it is remembered. Nothing in the repo contains a key.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.CAL_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRETS = path.join(DATA_DIR, 'secrets.json');

function readEnvFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
  return out;
}

function readSecrets() {
  try { return JSON.parse(fs.readFileSync(SECRETS, 'utf8')); } catch { return {}; }
}

export function getApiKey() {
  return process.env.OPENAI_API_KEY || readSecrets().openai_key || readEnvFile().OPENAI_API_KEY || '';
}

export function keySource() {
  if (process.env.OPENAI_API_KEY) return 'env';
  if (readSecrets().openai_key) return 'settings';
  if (readEnvFile().OPENAI_API_KEY) return '.env';
  return null;
}

export function setApiKey(key) {
  const s = readSecrets();
  if (key) s.openai_key = key.trim(); else delete s.openai_key;
  fs.writeFileSync(SECRETS, JSON.stringify(s), { mode: 0o600 });
  try { fs.chmodSync(SECRETS, 0o600); } catch { /* windows */ }
}

export function getModel() {
  return readSecrets().model || process.env.OPENAI_MODEL || readEnvFile().OPENAI_MODEL || 'gpt-4o';
}

export function setModel(model) {
  const s = readSecrets();
  if (model) s.model = model.trim(); else delete s.model;
  fs.writeFileSync(SECRETS, JSON.stringify(s), { mode: 0o600 });
}
