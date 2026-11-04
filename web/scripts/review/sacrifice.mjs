// Is a move a piece sacrifice? Chess rules only, no engine, so it's quick
// enough to run on every move of every game (the brilliant-move scan), and
// Node can test it (test/sacrifice.test.mjs).
//
// A move sacrifices material when, right after it, the opponent can win a
// knight, bishop, rook or queen by capturing, more than the move itself took.
// That covers a piece left hanging (even when taking it would lose: the
// classic brilliant move, where the engine's best reply declines it), a piece
// put en prise, and capturing into a recapture that costs more than it won.
// "Can win" is a static exchange: both sides keep capturing on that square
// with their least valuable piece, and either may stop when it pays.
import { Chess } from 'chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// What the side to move wins by starting captures on `sq` (0 if nothing pays).
// The first capture must be legal (so pins and checks count); after that
// both sides recapture with their least valuable attacker, x-rays included,
// using chess.js's quick attackers() rather than full move generation.
export function see(chess, sq) {
  const target = chess.get(sq);
  if (!target) return 0;
  const us = chess.turn();
  const them = us === 'w' ? 'b' : 'w';
  // The legal first captures, cheapest piece first.
  const firsts = chess.attackers(sq, us)
    .filter((from) => chess.moves({ square: from, verbose: true }).some((m) => m.to === sq))
    .map((from) => ({ from, type: chess.get(from).type }))
    .sort((a, b) => VALUE[a.type] - VALUE[b.type]);
  if (!firsts.length) return 0;
  const probe = new Chess(chess.fen());
  const taken = [VALUE[target.type]]; // value of what each capture takes
  let side = us;
  let next = firsts[0];
  for (let n = 0; n < 32 && next; n++) {
    const other = side === us ? them : us;
    probe.remove(next.from);
    probe.put({ type: next.type, color: side }, sq);
    // A king can't take a defended piece.
    if (next.type === 'k' && probe.attackers(sq, other).length) break;
    taken.push(VALUE[next.type]);
    side = other;
    const att = probe.attackers(sq, side).map((from) => ({ from, type: probe.get(from).type })).sort((a, b) => VALUE[a.type] - VALUE[b.type]);
    next = att[0] || null;
  }
  // gain[d]: net for whoever makes capture d, if both sides then play on well;
  // a capture is only made if it pays (>= 0).
  const n = taken.length - 1;
  if (!n) return 0;
  const gain = new Array(n);
  gain[n - 1] = taken[n - 1];
  for (let d = n - 2; d >= 0; d--) gain[d] = Math.max(0, taken[d] - gain[d + 1]);
  return Math.max(0, gain[0]);
}

const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

// How much material a move offers up: { net, piece, square } with net in
// pawns (what the opponent can win now, minus what the move captured), the
// piece they'd win and where. null if the move isn't legal there.
export function sacrificeOf(fenBefore, uci) {
  const chess = new Chess(fenBefore);
  let mv;
  try { mv = chess.move(uciMove(uci)); } catch { return null; }
  if (!mv) return null;
  let gained = mv.captured ? VALUE[mv.captured] : 0;
  if (mv.promotion) gained += VALUE[mv.promotion] - 1;
  // (After mate or stalemate there are no legal captures, so net stays <= 0.)
  // The mover's pieces (not pawns, not the king) the opponent attacks.
  const them = chess.turn();
  const mover = them === 'w' ? 'b' : 'w';
  let best = 0;
  let piece = null;
  let square = null;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== mover || p.type === 'p' || p.type === 'k') continue;
      if (VALUE[p.type] - gained < 2 || !chess.isAttacked(p.square, them)) continue;
      const s = see(chess, p.square);
      if (s > best) { best = s; piece = p.type; square = p.square; }
    }
  }
  return { net: best - gained, piece, square };
}

// A real piece sacrifice: at least a minor piece's worth less a pawn
// (so the exchange, rook for knight, counts; a pawn grab doesn't).
export function isPieceSacrifice(fenBefore, uci) {
  const s = sacrificeOf(fenBefore, uci);
  return !!s && s.net >= 2 && !!s.piece;
}
