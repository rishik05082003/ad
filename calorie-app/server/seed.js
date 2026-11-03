import path from 'node:path';
export { parseSeed } from '../public/core/seed.js';
export const SEED_FILE = path.resolve(import.meta.dirname, '..', 'public', 'core', 'foods.txt');
