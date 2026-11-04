// How the double picks a move, like the player it copies:
//   1. In a position from their own games, a move they played there, as often
//      as they played it.
//   2. Otherwise, one of Stockfish's top lines, chosen the way a player of
//      their rating would: the stronger they are, the more often the best
//      move; forcing moves (captures, checks) are favoured for attacking
//      players and quiet ones for positional players; and now and then a slip,
//      as often as players at that level make one.
// Pure (rnd is passed in), so Node can test it.
import { Chess } from 'chess.js';
import { winPercent } from '../review/analysis.mjs';
import { bookAt } from './profile.mjs';

// How human the choice is at a rating: T, the spread of the choice in
// win-chance points (bigger = more random), and slip, the chance per move of
// picking a clearly worse line. Rough figures, fitted by eye to how often
// players at these levels go wrong.
const LEVELS = [
  { rating: 600, T: 9, slip: 0.12 },
  { rating: 1000, T: 6.5, slip: 0.08 },
  { rating: 1400, T: 4.5, slip: 0.05 },
  { rating: 1800, T: 3, slip: 0.03 },
  { rating: 2200, T: 1.8, slip: 0.015 },
  { rating: 2600, T: 0.9, slip: 0.006 },
  { rating: 3000, T: 0.4, slip: 0.002 },
];
export function level(rating) {
  const r = Math.max(LEVELS[0].rating, Math.min(LEVELS[LEVELS.length - 1].rating, Number(rating) || 1200));
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1], b = LEVELS[i];
    if (r <= b.rating) {
      const t = (r - a.rating) / (b.rating - a.rating);
      return { T: a.T + (b.T - a.T) * t, slip: a.slip + (b.slip - a.slip) * t };
    }
  }
  return LEVELS[LEVELS.length - 1];
}

// How deep and long the engine looks, by rating: weaker doubles need less.
export function searchFor(rating) {
  const r = Number(rating) || 1200;
  return r >= 2200 ? { depth: 16, movetime: 1200 } : r >= 1600 ? { depth: 13, movetime: 900 } : { depth: 11, movetime: 700 };
}

export function pickBook(profile, fen, rnd = Math.random) {
  const at = bookAt(profile, fen);
  if (!at) return null;
  const chess = new Chess(fen);
  const legal = new Set(chess.moves());
  const moves = at.moves.filter((m) => legal.has(m.san));
  const total = moves.reduce((s, m) => s + m.n, 0);
  if (!total) return null;
  let x = rnd() * total;
  for (const m of moves) {
    x -= m.n;
    if (x < 0) return { san: m.san, how: 'book', n: m.n, of: total };
  }
  return { san: moves[0].san, how: 'book', n: moves[0].n, of: total };
}

// lines: Stockfish's [{ score, pv }] for fen, best first.
export function pickEngine(lines, fen, profile, rnd = Math.random) {
  const usable = lines.filter((l) => l && l.pv && l.pv[0]);
  if (!usable.length) return null;
  const { T, slip } = level(profile.rating);
  // Only lines whose first move is legal here (a stale answer could be for another position).
  const opts = usable.map((l) => {
    const probe = new Chess(fen);
    let m = null;
    try { m = probe.move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] }); } catch { m = null; }
    return m && { uci: l.pv[0], san: m.san, win: winPercent(l.score), forcing: !!m.captured || m.san.includes('+'), mate: l.score.mate != null && l.score.mate > 0, mateIn: l.score.mate };
  }).filter(Boolean);
  if (!opts.length) return null;
  const best = opts[0];
  // Never miss a mate in one or two: everyone sees those.
  if (best.mate && best.mateIn <= 2) return { uci: best.uci, san: best.san, how: 'engine' };
  // A slip: a line clearly worse than the best, if there is one.
  const worse = opts.filter((o) => best.win - o.win >= 8);
  if (worse.length && rnd() < slip) {
    const o = worse[Math.floor(rnd() * worse.length)];
    return { uci: o.uci, san: o.san, how: 'slip' };
  }
  // The usual choice: softmax over win chance, plus the player's taste.
  const taste = (profile.aggression ?? 0.5) - 0.5; // -0.5 quiet … +0.5 attacking
  const weights = opts.map((o) => Math.exp((o.win - best.win + (o.forcing ? taste * 6 : -taste * 2)) / T));
  const sum = weights.reduce((s, w) => s + w, 0);
  let x = rnd() * sum;
  for (let i = 0; i < opts.length; i++) {
    x -= weights[i];
    if (x < 0) return { uci: opts[i].uci, san: opts[i].san, how: i === 0 ? 'engine' : 'style' };
  }
  return { uci: best.uci, san: best.san, how: 'engine' };
}
