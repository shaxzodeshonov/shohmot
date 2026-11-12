import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { parseLines, families, bookIndex, bookMove, isOwn, ownCount, playable, status, order, progress } from '../web/scripts/training/openings.mjs';
import { get, record, totals } from '../web/scripts/training/openings-store.mjs';
import { INTERVALS } from '../web/scripts/training/store.mjs';

const raw = [
  ['B20', 'Sicilian Defense', 'e4 c5'],
  ['B50', 'Sicilian Defense: Modern Variations', 'e4 c5 Nf3 d6'],
  ['B90', 'Sicilian Defense: Najdorf Variation, English Attack', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3'],
  ['C60', 'Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'],
  ['A00', 'Amar Opening', 'Nh3'],
];
const lines = parseLines(raw);
const by = (name) => lines.find((l) => l.name === name);

test('names split into a family and a variation', () => {
  const l = by('Sicilian Defense: Najdorf Variation, English Attack');
  assert.equal(l.family, 'Sicilian Defense');
  assert.equal(l.variation, 'Najdorf Variation, English Attack');
  assert.equal(by('Ruy Lopez').variation, '');
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length, 'ids are unique');
});

test('families are biggest first, lines shortest first', () => {
  const f = families(lines);
  assert.equal(f[0].name, 'Sicilian Defense');
  assert.deepEqual(f[0].lines.map((l) => l.moves.length), [2, 4, 11]);
});

test('who plays which ply', () => {
  assert.ok(isOwn(0, 'w') && !isOwn(1, 'w') && isOwn(1, 'b'));
  assert.equal(ownCount(by('Ruy Lopez'), 'w'), 3);
  assert.equal(ownCount(by('Ruy Lopez'), 'b'), 2);
  assert.ok(!playable(by('Amar Opening'), 'b'), 'Black makes no move in a one-ply line');
  assert.ok(playable(by('Amar Opening'), 'w'));
});

test('a book move in another variation is told apart from a wrong one', () => {
  const book = bookIndex(lines);
  const najdorf = by('Sicilian Defense: Najdorf Variation, English Attack');
  assert.equal(bookMove(book, najdorf, 1, 'c5'), 'Sicilian Defense');
  assert.equal(bookMove(book, najdorf, 1, 'h5'), null);
});

test('every line in the real list is a legal game, with unique ids', () => {
  const real = parseLines(JSON.parse(readFileSync(new URL('../public/opening-lines.json', import.meta.url))));
  assert.ok(real.length > 3000);
  assert.equal(new Set(real.map((l) => l.id)).size, real.length);
  for (const l of real) {
    const c = new Chess();
    for (const m of l.moves) c.move(m); // throws on an illegal move
  }
});

test('scheduling: new, then due, learning and learned', () => {
  const now = 1_000_000;
  assert.equal(status(null, now), 'new');
  const a = record('w', 'x1', true, now);
  assert.equal(a.due, now + INTERVALS[1]);
  assert.equal(status(get('w', 'x1'), now), 'learning');
  assert.equal(status(get('w', 'x1'), now + INTERVALS[1]), 'due');
  assert.equal(get('b', 'x1'), null, 'each side is learned separately');
  const b = record('w', 'x2', false, now);
  assert.ok(b.due > now && b.due < now + INTERVALS[1], 'a slip comes back soon');
  for (let k = 0; k < 5; k++) record('w', 'x3', true, now);
  assert.equal(status(get('w', 'x3'), now), 'learned');
  assert.equal(totals(now).learned, 1);
});

test('order: what is due first, then new lines shortest first, skipping lines with nothing to play', () => {
  const now = 2_000_000;
  const sic = by('Sicilian Defense: Modern Variations');
  record('b', sic.id, false, now - 10 * 60000 * 2);
  const q = order(lines, 'b', get, now);
  assert.equal(q[0], sic, 'due first');
  assert.ok(!q.includes(by('Amar Opening')));
  const fresh = q.slice(1).map((l) => l.moves.length);
  assert.deepEqual(fresh, [...fresh].sort((a, b) => a - b));
  const p = progress(lines, 'b', get, now);
  assert.equal(p.total, 4);
  assert.equal(p.due, 1);
  assert.equal(p.new, 3);
});
