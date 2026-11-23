// The Uzbek dictionary: every line keeps the placeholders of its English key,
// so numbers, moves, names and inner elements all land in the translation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import uz from '../web/i18n/uz.mjs';
import { tr } from '../web/scripts/tr.mjs';

const count = (s, re) => (s.match(re) || []).length;
const sorted = (s, re) => (s.match(re) || []).sort().join(' ');

test('every Uzbek line keeps its placeholders', () => {
  const wrong = [];
  for (const [en, out] of Object.entries(uz)) {
    if (typeof out !== 'string' || !out.trim()) { wrong.push(`empty: ${en}`); continue; }
    // {0} inner elements and {name} script values: the same set
    if (sorted(en, /\{\d+\}/g) !== sorted(out, /\{\d+\}/g)) wrong.push(`{n}: ${en}`);
    if (sorted(en, /\{[a-z]\w*\}/g) !== sorted(out, /\{[a-z]\w*\}/g)) wrong.push(`{name}: ${en}`);
    // %n numbers and %s moves: the same count. A line that names its numbers
    // (%1, %2…, to reorder them) may leave one out ("lost all 3" → "lost them all").
    if (/%[1-9]/.test(out) ? /%n/.test(out) : count(en, /%n/g) !== count(out, /%n/g)) wrong.push(`%n: ${en}`);
    if (count(en, /%s/g) !== count(out, /%s/g)) wrong.push(`%s: ${en}`);
    // %1…%9 only point at numbers the English has
    for (const m of out.matchAll(/%([1-9])/g)) if (Number(m[1]) > count(en, /%n/g)) wrong.push(`%${m[1]}: ${en}`);
  }
  assert.deepEqual(wrong, []);
});

test('keys are written the way the page matches them', () => {
  // Lines are matched with whitespace collapsed and trimmed.
  const bad = Object.keys(uz).filter((k) => k !== k.replace(/\s+/g, ' ').trim());
  assert.deepEqual(bad, []);
});

test('tr() outside a page fills in the English', () => {
  assert.equal(tr('Lost to {o}', { o: 'Magnus' }), 'Lost to Magnus');
  assert.equal(tr('Plain line'), 'Plain line');
  assert.equal(tr('{a} and {b}', { a: 'x' }), 'x and {b}');
});
