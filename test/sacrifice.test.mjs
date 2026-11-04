import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { see, sacrificeOf, isPieceSacrifice } from '../web/scripts/review/sacrifice.mjs';
import { candidates, judge, windows } from '../web/scripts/brilliants/scan.mjs';
import { classify, isBrilliant, brilliantRule } from '../web/scripts/review/analysis.mjs';

const fenAfter = (sans) => { const c = new Chess(); for (const m of sans) c.move(m); return c.fen(); };

test('static exchange: what capturing on a square wins', () => {
  // A knight on e5 defended by a pawn, attacked by a pawn: winning it costs the pawn.
  const c = new Chess('4k3/8/3p4/4n3/3P4/8/8/4K3 w - - 0 1');
  assert.equal(see(c, 'e5'), 2); // dxe5 wins 3, dxe5 wins 1 back
  // Undefended queen: all of it.
  assert.equal(see(new Chess('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1'), 'd5'), 9);
  // Defended pawn attacked by a rook: not worth it.
  assert.equal(see(new Chess('4k3/8/2p5/3p4/8/8/8/3RK3 w - - 0 1'), 'd5'), 0);
});

test('Bxf7+ gives up a bishop for a pawn', () => {
  const fen = fenAfter(['e4', 'e5', 'Bc4', 'Nc6']);
  const s = sacrificeOf(fen, 'c4f7');
  assert.equal(s.piece, 'b');
  assert.equal(s.net, 2);
  assert.equal(isPieceSacrifice(fen, 'c4f7'), true);
});

test('Legal’s trap: leaving the queen to be taken is a sacrifice even though taking it loses', () => {
  const fen = fenAfter(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6']);
  const s = sacrificeOf(fen, 'f3e5');
  assert.equal(s.piece, 'q');
  assert.ok(s.net >= 5, `net ${s.net}`);
});

test('ordinary trades and pawn grabs are not sacrifices', () => {
  // 1.e4 d5 2.exd5 Qxd5: the queen takes a pawn and is safe.
  assert.equal(isPieceSacrifice(fenAfter(['e4', 'd5', 'exd5']), 'd8d5'), false);
  // Knight takes a defended knight: an even trade.
  assert.equal(isPieceSacrifice('4k3/8/3p4/4n3/8/5N2/8/4K3 w - - 0 1', 'f3e5'), false);
  // A pawn left hanging doesn't count.
  assert.equal(isPieceSacrifice(fenAfter(['e4', 'e5']), 'd2d4'), false);
  // Illegal move.
  assert.equal(sacrificeOf(new Chess().fen(), 'e2e5'), null);
});

test('candidates are my piece sacrifices, outside the book', () => {
  // Legal’s mate with White: 5.Nxe5 leaves the queen. 6.Bxf7+ isn't one:
  // the knight on e5 guards f7, so the king can't take the bishop.
  const game = { color: 'w', moves: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#' };
  const c = candidates(game);
  assert.deepEqual(c.map((x) => x.san), ['Nxe5']);
  assert.equal(c[0].ply, 9);
  // Black's moves aren't White's candidates; with Black, Bxd1 is a capture, not a sacrifice.
  assert.deepEqual(candidates({ ...game, color: 'b' }).map((x) => x.san), []);
  // Positions in the book are skipped.
  const book = {};
  const ch = new Chess();
  for (const m of game.moves.split(' ').slice(0, 9)) { ch.move(m); book[ch.fen().split(' ').slice(0, 4).join(' ')] = 'C41|Legal'; }
  assert.deepEqual(candidates(game, book).map((x) => x.san), []);
  // A mating sacrifice is judged without a second search.
  const mate = candidates({ color: 'w', moves: 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#' });
  assert.equal(mate.length, 0, 'Qxf7# leaves nothing to take');
});

test('judge: best move, sound, and not already winning', () => {
  const c = { uci: 'c4f7', legal: 30, mate: false, over: false };
  const lines = (cp1, cp2, uci1 = 'c4f7') => [{ score: { cp: cp1 }, pv: [uci1] }, { score: { cp: cp2 }, pv: ['g1f3'] }];
  // Best move, about level before, still fine after: brilliant.
  assert.equal(judge(c, lines(80, 20), [{ score: { cp: -70 }, pv: [] }], 1500), true);
  // Not the engine's move and clearly worse: no.
  assert.equal(judge(c, lines(80, 20, 'g1f3'), [{ score: { cp: 200 }, pv: [] }], 1500), false);
  // Already crushing without it: no.
  assert.equal(judge(c, lines(900, 800), [{ score: { cp: -900 }, pv: [] }], 1500), false);
});

test('brilliant is more generous at lower ratings', () => {
  const m = { sacrifice: true, isBest: false, before: 60, after: 56.5, second: 40, legal: 20 };
  assert.equal(isBrilliant({ ...m, rating: 2000 }), false); // 3.5% is too far from best up here
  assert.equal(isBrilliant({ ...m, rating: 700 }), true);
  assert.equal(brilliantRule(null), brilliantRule(1500));
  assert.equal(classify({ ...m, rating: 700, book: false, recapture: false, oppLabel: null }), 'brilliant');
  // Left worse off: never brilliant.
  assert.equal(isBrilliant({ ...m, isBest: true, after: 30, rating: 700 }), false);
});

test('scan windows cover the range, newest first', () => {
  const DAY = 86400000;
  const w = windows('lichess', 0, 20 * DAY);
  assert.deepEqual(w.map((x) => [x.since / DAY, x.until / DAY]), [[13, 20], [6, 13], [0, 6]]);
  assert.equal(windows('chesscom', 0, 20 * DAY).length, 1);
});
