// Labels every move of a game (Brilliant … Blunder) from Stockfish's lines,
// and says in a few words what went wrong with a bad move. The full review
// (review.mjs) and the quick mistake check on the counter (training/analyze.mjs)
// both use this, so they always agree. Pure apart from chess.js, so Node can
// test it.
import { Chess } from 'chess.js';
import { winPercent, classify, BAD } from './analysis.mjs';
import { sacrificeOf, VALUE } from './sacrifice.mjs';

function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'k') s += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return s;
}

export function playUci(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

// Material the mover is down after a move once the captures in the engine's
// best reply settle (positive = down).
export function materialDrop(fenBefore, fenAfter, afterLines, mover) {
  const before = balance(new Chess(fenBefore), mover);
  const chess = new Chess(fenAfter);
  const line = afterLines && afterLines[0] ? afterLines[0].pv : [];
  for (const uci of line.slice(0, 8)) {
    const probe = new Chess(chess.fen());
    const m = playUci(probe, uci);
    if (!m || (!m.captured && !m.promotion)) break;
    playUci(chess, uci);
  }
  return before - balance(chess, mover);
}

export function sanLine(fen, pv, max = 6) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const m = playUci(chess, uci);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// White's win chance at position i (null until analysed). k: see ACCURACY.
export function whiteWin(fens, results, i, k) {
  const r = results[i];
  if (!r || !r[0]) return null;
  const w = winPercent(r[0].score, k);
  return fens[i].split(' ')[1] === 'w' ? w : 100 - w;
}

// game: { fens, moves: [{ san, uci, from, to, color, captured }], legal, bookPlies, headers }
// results: Stockfish's lines for every position (results[i] is before move i).
// -> { wins, labels, info: [{ before, after, best, drop, isBest }] }
export function labelGame(game, results) {
  const n = game.moves.length;
  const wins = game.fens.map((_, i) => whiteWin(game.fens, results, i));
  const labels = [];
  const info = [];
  for (let i = 0; i < n; i++) {
    const m = game.moves[i];
    const white = m.color === 'w';
    const lines = results[i];
    const before = white ? wins[i] : 100 - wins[i];
    const after = white ? wins[i + 1] : 100 - wins[i + 1];
    const second = lines[1] ? winPercent(lines[1].score) : null;
    const best = lines[0].pv[0];
    const isBest = best === m.uci || (!!lines[1] && lines[1].pv[0] === m.uci && second >= before - 1);
    const prev = game.moves[i - 1];
    const drop = materialDrop(game.fens[i], game.fens[i + 1], results[i + 1], m.color);
    // A sacrifice: a piece the opponent can win right now (even if taking it
    // loses, which the engine's line wouldn't show), or a piece the engine's
    // line wins once the captures settle.
    const sac = sacrificeOf(game.fens[i], m.uci);
    const headers = game.headers || {};
    const rating = Number(white ? headers.WhiteElo : headers.BlackElo) || null;
    labels.push(classify({
      before, after, second, isBest, rating,
      legal: game.legal[i],
      book: i < (game.bookPlies || 0),
      sacrifice: (sac && sac.net >= 2 && !!sac.piece) || drop >= 3,
      recapture: !!(prev && prev.captured && m.captured && prev.to === m.to),
      oppLabel: labels[i - 1] || null,
    }));
    info.push({ before, after, best, drop, isBest });
  }
  return { wins, labels, info };
}

export function lossText(d) {
  if (d >= 8) return 'the queen';
  if (d >= 5) return 'a rook';
  if (d >= 3) return 'a piece';
  if (d >= 2) return 'two pawns';
  return 'a pawn';
}

// The kinds of mistake, for "what to work on".
export const KINDS = {
  mate: 'Allowed a mate',
  missedMate: 'Missed a mate',
  hung: 'Left a piece hanging',
  material: 'Lost material',
  missed: 'Missed a chance',
  position: 'Let the position slip',
};

// What went wrong with bad move i: { kind, why, bestSan, line }.
export function explain(game, results, label, i) {
  const m = game.moves[i];
  const lines = results[i];
  const afterLines = results[i + 1];
  const afterScore = afterLines && afterLines[0] ? afterLines[0].score : null;
  const bestScore = lines[0].score;
  const line = sanLine(game.fens[i], lines[0].pv);
  const drop = materialDrop(game.fens[i], game.fens[i + 1], afterLines, m.color);
  const sac = sacrificeOf(game.fens[i], m.uci);
  let kind;
  const why = [];
  if (afterScore && afterScore.mate > 0) { kind = 'mate'; why.push(`It allows mate in ${afterScore.mate}.`); }
  else if (bestScore.mate > 0) { kind = 'missedMate'; why.push(`There was mate in ${bestScore.mate}.`); }
  else if (sac && sac.net >= 2 && sac.piece && drop >= 2) { kind = 'hung'; why.push(`It leaves ${lossText(sac.net)} to be taken.`); }
  else if (drop >= 1) { kind = 'material'; why.push(`It loses ${lossText(drop)}.`); }
  else if (label === 'miss') { kind = 'missed'; why.push('Your opponent had just slipped, and this lets them off the hook.'); }
  else { kind = 'position'; why.push('The position gets a lot harder to hold.'); }
  if (label === 'miss' && kind !== 'missed') why.push('Your opponent had just slipped.');
  return { kind, why: why.join(' '), bestSan: line[0] || lines[0].pv[0], line: line.slice(1).join(' ') };
}

// Replays a game given as SAN moves (and an optional start FEN) into the
// shape labelGame wants. null if the moves don't play.
export function buildFromSan(moves, fen) {
  let chess;
  try { chess = new Chess(fen || undefined); } catch { return null; }
  const fens = [chess.fen()];
  const legal = [];
  const pieces = [];
  const out = [];
  const count = () => { let k = 0; for (const row of chess.board()) for (const sq of row) if (sq && 'nbrq'.includes(sq.type)) k++; return k; };
  pieces.push(count());
  for (const san of String(moves || '').split(' ').filter(Boolean)) {
    legal.push(chess.moves().length);
    let m;
    try { m = chess.move(san); } catch { return null; }
    if (!m) return null;
    out.push({ san: m.san, uci: m.from + m.to + (m.promotion || ''), from: m.from, to: m.to, color: m.color, captured: m.captured || null, piece: m.piece });
    fens.push(chess.fen());
    pieces.push(count());
  }
  let end = null;
  if (chess.isCheckmate()) end = [{ score: { mate: 0 }, pv: [] }];
  else if (chess.isStalemate() || chess.isInsufficientMaterial()) end = [{ score: { cp: 0 }, pv: [] }];
  return { fens, moves: out, legal, pieces, end };
}

export { BAD };
