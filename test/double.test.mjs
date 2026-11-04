import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildProfile, bookAt } from '../web/scripts/double/profile.mjs';
import { pickBook, pickEngine, level, searchFor } from '../web/scripts/double/choose.mjs';

const games = [
  { color: 'w', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6', rating: 1500, speed: 'blitz', result: 'win', end: 3 },
  { color: 'w', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', rating: 1510, speed: 'blitz', result: 'loss', end: 2 },
  { color: 'w', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', rating: 1490, speed: 'blitz', result: 'draw', end: 1 },
  { color: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', rating: 1480, speed: 'blitz', result: 'win', end: 4 },
  { color: 'b', moves: 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O', rating: 1480, speed: 'rapid', result: 'loss', end: 5 },
];
const openings = {};
{ const c = new Chess(); for (const m of 'e4 c5'.split(' ')) c.move(m); openings[c.fen().split(' ').slice(0, 4).join(' ')] = 'B20|Sicilian Defense'; }

test('a profile from a few games: openings, rating, style', () => {
  const p = buildProfile(games, { username: 'me', platform: 'lichess', openings });
  assert.equal(p.games, 5);
  assert.equal(p.speed, 'blitz');
  assert.equal(p.rating, Math.round((1500 + 1510 + 1490 + 1480) / 4));
  assert.deepEqual(p.firsts.white[0], { name: 'e4', n: 3 });
  assert.deepEqual(p.firsts.black.map((x) => x.name), ['e4 c5', 'd4 Nf6']);
  assert.equal(p.openings.black[0].name, 'Sicilian Defense');
  // As White after 1.e4 e5 they always played Nf3.
  const c = new Chess(); c.move('e4'); c.move('e5');
  assert.deepEqual(bookAt(p, c.fen()), { total: 2, moves: [{ san: 'Nf3', n: 2 }] });
  // Black's moves are only in the book where Black was to move.
  const s = new Chess(); s.move('e4');
  assert.deepEqual(bookAt(p, s.fen()).moves, [{ san: 'c5', n: 1 }]);
  assert.ok(p.stats.castleRate > 0.5);
  assert.ok(['Attacking', 'Positional', 'Balanced'].includes(p.style));
});

test('book moves come at the player’s own frequencies', () => {
  const p = buildProfile([...games, { color: 'w', moves: 'd4 d5', rating: 1500, speed: 'blitz', end: 0 }]);
  const start = new Chess().fen();
  const picks = { e4: 0, d4: 0 };
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) picks[pickBook(p, start, rnd).san]++;
  assert.ok(Math.abs(picks.e4 / 2000 - 0.75) < 0.04, JSON.stringify(picks)); // 3 of 4 White games
  assert.equal(pickBook(p, '8/8/8/4k3/8/8/8/4K2R w K - 0 1'), null, 'not a position from their games');
});

test('engine choice: strong players pick the best move, weak ones spread out, mates are never missed', () => {
  const fen = new Chess().fen();
  const lines = [{ score: { cp: 40 }, pv: ['e2e4'] }, { score: { cp: 30 }, pv: ['d2d4'] }, { score: { cp: 10 }, pv: ['g1f3'] }, { score: { cp: -150 }, pv: ['g2g4'] }];
  const count = (rating) => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = {};
    for (let i = 0; i < 2000; i++) { const u = pickEngine(lines, fen, { rating, aggression: 0.5 }, rnd).uci; n[u] = (n[u] || 0) + 1; }
    return n;
  };
  const gm = count(2800), novice = count(700);
  assert.ok(gm.e2e4 > 1100, JSON.stringify(gm));
  assert.ok((novice.e2e4 || 0) < gm.e2e4, JSON.stringify(novice));
  assert.ok((novice.g2g4 || 0) > (gm.g2g4 || 0), 'beginners slip more');
  const mate = pickEngine([{ score: { mate: 1 }, pv: ['d8h4'] }, { score: { cp: 0 }, pv: ['a7a6'] }], 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', { rating: 600 }, () => 0.001);
  assert.equal(mate.uci, 'd8h4');
  assert.equal(pickEngine([{ score: { cp: 0 }, pv: ['e7e5'] }], fen, { rating: 1500 }), null, 'an illegal (stale) line is ignored');
  assert.ok(level(600).T > level(2600).T);
  assert.ok(searchFor(2400).depth > searchFor(1000).depth);
});
