import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winPercent, moveAccuracy, gameAccuracy, classify, gameRating, phases } from '../public/review/analysis.mjs';

const near = (a, b, eps = 0.1) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test('win chance is 50 at equal, symmetric, and capped by mate', () => {
  near(winPercent({ cp: 0 }), 50);
  near(winPercent({ cp: 100 }) + winPercent({ cp: -100 }), 100);
  near(winPercent({ cp: 100 }), 59.1);
  assert.equal(winPercent({ mate: 3 }), 100);
  assert.equal(winPercent({ mate: -2 }), 0);
  assert.equal(winPercent({ mate: 0 }), 0);
  // Beyond ±10 pawns it stops growing.
  assert.equal(winPercent({ cp: 3000 }), winPercent({ cp: 1000 }));
});

test('move accuracy is 100 for no loss and falls with the loss', () => {
  assert.equal(moveAccuracy(60, 60), 100);
  assert.equal(moveAccuracy(60, 70), 100);
  near(moveAccuracy(60, 50), 64.6, 0.5);
  assert.equal(moveAccuracy(100, 0), 0);
});

test('game accuracy: perfect play is near 100, a blunder drags it down', () => {
  const flat = Array(41).fill(50);
  const a = gameAccuracy(flat);
  assert.equal(Math.round(a.white), 100);
  assert.equal(Math.round(a.black), 100);

  // White blunders on their 10th move (ply 18 -> 19).
  const wins = flat.slice();
  for (let i = 19; i < wins.length; i++) wins[i] = 10;
  const b = gameAccuracy(wins);
  assert.ok(b.white < 80, `white ${b.white}`);
  assert.ok(b.black > 95, `black ${b.black}`);
});

test('game accuracy with Black moving first swaps the sides', () => {
  // White's win chance drops on the first move: a slip by whoever moved first.
  const w = gameAccuracy([50, 20, 20, 20, 20, 20], true);
  assert.ok(w.white < w.black);
  // It rises on the first move: Black moved first and slipped.
  const b = gameAccuracy([50, 80, 80, 80, 80, 80], false);
  assert.ok(b.black < b.white);
});

const base = { before: 55, after: 55, second: 50, isBest: false, legal: 30, book: false, sacrifice: false, recapture: false, oppLabel: null };

test('labels follow expected-points thresholds', () => {
  assert.equal(classify({ ...base, isBest: true }), 'best');
  assert.equal(classify({ ...base, after: 54 }), 'excellent');
  assert.equal(classify({ ...base, after: 52 }), 'good');
  assert.equal(classify({ ...base, after: 48 }), 'inaccuracy');
  assert.equal(classify({ ...base, after: 40 }), 'mistake');
  assert.equal(classify({ ...base, after: 20 }), 'blunder');
});

test('book and forced moves come first', () => {
  assert.equal(classify({ ...base, book: true, after: 0 }), 'book');
  assert.equal(classify({ ...base, legal: 1, after: 0 }), 'forced');
});

test('brilliant needs a sound sacrifice in a game that is not already won', () => {
  assert.equal(classify({ ...base, isBest: true, sacrifice: true }), 'brilliant');
  assert.equal(classify({ ...base, isBest: true, sacrifice: true, before: 99, after: 99, second: 98 }), 'best');
  assert.equal(classify({ ...base, sacrifice: true, after: 30 }), 'blunder');
});

test('great is the only good move, but not a plain recapture', () => {
  assert.equal(classify({ ...base, isBest: true, second: 30 }), 'great');
  assert.equal(classify({ ...base, isBest: true, second: 30, recapture: true }), 'best');
  assert.equal(classify({ ...base, isBest: true, before: 99, after: 99, second: 95 }), 'best');
});

test('miss: letting an opponent blunder go unpunished', () => {
  const chance = { ...base, before: 85, after: 55 };
  assert.equal(classify({ ...chance, oppLabel: 'blunder' }), 'miss');
  assert.equal(classify({ ...chance, oppLabel: 'good' }), 'blunder');
  // Throwing the game away is still a blunder.
  assert.equal(classify({ ...chance, after: 10, oppLabel: 'blunder' }), 'blunder');
});

test('game rating rises with accuracy', () => {
  assert.equal(gameRating(null), null);
  assert.equal(gameRating(80), 1600);
  assert.ok(gameRating(90) > gameRating(70));
  assert.equal(gameRating(100), 3100);
});

test('phases: book, then middlegame by move 12 or trades, endgame when few pieces are left', () => {
  const pieces = [...Array(30).fill(14), ...Array(10).fill(8), ...Array(10).fill(4)];
  assert.deepEqual(phases(pieces, 8), { middleStart: 24, endStart: 40 });
  const trades = [...Array(10).fill(14), ...Array(20).fill(10)];
  assert.deepEqual(phases(trades, 4), { middleStart: 10, endStart: 30 });
  assert.deepEqual(phases(Array(10).fill(14), 4), { middleStart: 10, endStart: 10 });
});

test('engine stretches cover every position once, from the end backwards', async () => {
  const { stretches } = await import('../public/review/engine.mjs');
  const runs = stretches(19, 8);
  assert.deepEqual(runs[0], [18, 17, 16, 15, 14, 13, 12, 11]);
  assert.deepEqual(runs.at(-1), [2, 1, 0]);
  assert.deepEqual(runs.flat().sort((a, b) => a - b), Array.from({ length: 19 }, (_, i) => i));
  assert.deepEqual(stretches(0), []);
});

test('cloud scores turn from White\'s side to the side to move', async () => {
  const { cloudLines } = await import('../public/review/cloud.mjs');
  const black = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const lines = cloudLines({ depth: 50, pvs: [{ moves: 'e7e5 g1f3', cp: 22 }, { moves: 'c7c6', mate: 3 }] }, black);
  assert.deepEqual(lines[0].score, { cp: -22 });
  assert.deepEqual(lines[0].pv, ['e7e5', 'g1f3']);
  assert.deepEqual(lines[1].score, { mate: -3 });
  assert.equal(lines[0].depth, 50);
  const white = black.replace(' b ', ' w ');
  assert.deepEqual(cloudLines({ depth: 50, pvs: [{ moves: 'e2e4', cp: 22 }] }, white)[0].score, { cp: 22 });
});

test('Chess.com constants: perfect play is 100, one blunder costs less than on Lichess', async () => {
  const { ACCURACY } = await import('../public/review/analysis.mjs');
  const flat = Array(41).fill(50);
  assert.equal(Math.round(gameAccuracy(flat, true, ACCURACY.chesscom).white), 100);
  // White throws away a won position on move 10, everything else is perfect.
  const cps = Array(41).fill(300);
  for (let i = 19; i < cps.length; i++) cps[i] = -300;
  const acc = (c) => gameAccuracy(cps.map((cp) => winPercent({ cp }, c.k)), true, c).white;
  assert.ok(acc(ACCURACY.chesscom) > acc(ACCURACY.lichess), `${acc(ACCURACY.chesscom)} vs ${acc(ACCURACY.lichess)}`);
  assert.ok(acc(ACCURACY.chesscom) < 95);
});
