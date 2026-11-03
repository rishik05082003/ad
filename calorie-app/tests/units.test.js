import test from 'node:test';
import assert from 'node:assert/strict';
import { unitOf, parseAmount, fmtQty } from '../public/core/units.js';

const u = (serving_label, serving_g, name = 'Food') => unitOf({ serving_label, serving_g, name });

test('units: cookies, slices, pieces', () => {
  const o = u('3 cookies', 34, 'Oreo');
  assert.equal(o.one, 'cookie'); assert.equal(o.many, 'cookies'); assert.ok(Math.abs(o.grams - 11.33) < 0.01);
  const d = u('1 cookie', 14.5, 'Oreo Double Stuff');
  assert.equal(d.one, 'cookie'); assert.equal(d.many, 'cookies'); assert.equal(d.grams, 14.5);
  assert.deepEqual([u('1 slice', 25).one, u('1 slice', 25).many], ['slice', 'slices']);
  assert.equal(u('5 pieces', 100).one, 'piece');
  assert.equal(u('1 roti', 40).many, 'roti');         // roti stays roti
  assert.equal(u('1 glass', 240).many, 'glasses');
  assert.equal(u('2 tbsp', 32).one, 'tbsp');
  assert.equal(u('4 finger bar', 41.5).many, 'finger bar'); // label already describes the pack, plural unchanged for count>1
  assert.equal(u('1 finger bar', 10).many, 'finger bars');
});

test('units: adjectives borrow the food name, descriptors keep the noun', () => {
  assert.equal(u('1 medium', 182, 'Apple').one, 'medium apple');
  assert.equal(u('6 large', 100, 'Shrimp (cooked)').one, 'large shrimp');
  assert.equal(u('1 cup sliced', 165, 'Mango').many, 'cups sliced');
  assert.equal(u('1/2 cup arils', 87, 'Pomegranate').grams, 174);
  assert.equal(u('1 portion (400 g)', 400, 'Dal').one, 'portion');
});

test('units: fractions are singular, pieces plural', () => {
  assert.equal(u('1/4 cup', 50, 'White rice (raw)').many, 'cups');
  assert.equal(u('1/4 cup', 50).one, 'cup');
  assert.equal(u('1/2 cup arils', 87, 'Pomegranate').many, 'cups arils');
});

test('units: no countable unit for gram labels', () => {
  assert.equal(u('100 g block', 100), null);
  assert.equal(u('100 g', 100), null);
  assert.equal(u('serving', 75), null);
  assert.equal(u('', 75), null);
  assert.equal(u('1 can drained', 0), null);
});

test('parseAmount: counts, words, fractions, grams', () => {
  assert.deepEqual(parseAmount('1 oreo double stuff'), { text: 'oreo double stuff', qty: 1 });
  assert.deepEqual(parseAmount('2 rotis'), { text: 'rotis', qty: 2 });
  assert.deepEqual(parseAmount('half a banana'), { text: 'banana', qty: 0.5 });
  assert.deepEqual(parseAmount('1/2 avocado'), { text: 'avocado', qty: 0.5 });
  assert.deepEqual(parseAmount('three eggs'), { text: 'eggs', qty: 3 });
  assert.deepEqual(parseAmount('150g rice'), { text: 'rice', grams: 150 });
  assert.deepEqual(parseAmount('200 ml of milk'), { text: 'milk', grams: 200 });
  assert.equal(parseAmount('oreo'), null);
  assert.equal(parseAmount('2'), null);
  assert.equal(fmtQty(2.3333), '2.33');
});
