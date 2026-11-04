// Turns a labelled game into the training positions store.mjs keeps. Kept
// apart from the store because it needs the move labeller (and chess.js),
// which pages that only read the store shouldn't have to load.
import { BAD, winPercent, phases } from '../review/analysis.mjs';
import { explain } from '../review/label.mjs';

// Pure: a labelled game -> what to keep. game is buildFromSan's or the
// review's shape with .me ('w'|'b'); review is { labels, accuracy? }.
export function mistakesOf(game, results, review, meta) {
  const items = [];
  const { middleStart, endStart } = game.pieces ? phases(game.pieces, game.bookPlies || 0) : { middleStart: 0, endStart: Infinity };
  review.labels.forEach((label, i) => {
    const m = game.moves[i];
    if (m.color !== game.me || !BAD.has(label) || label === 'inaccuracy') return;
    const lines = results[i];
    if (!lines || !lines[0] || !lines[0].pv[0]) return;
    const best = lines[0].pv[0];
    const bestWin = winPercent(lines[0].score);
    // Other moves nearly as good also count as solving it.
    const alts = lines.slice(1).filter((l) => l.pv[0] && l.pv[0] !== m.uci && winPercent(l.score) >= bestWin - 3).map((l) => l.pv[0]);
    const x = explain(game, results, label, i);
    items.push({
      ply: i + 1, label, kind: x.kind, why: x.why, phase: i < middleStart ? 0 : i < endStart ? 1 : 2,
      fen: game.fens[i], played: m.uci, san: m.san, best, alts, bestSan: x.bestSan, line: x.line,
    });
  });
  return {
    end: meta.end, username: meta.username, opponent: meta.opponent, speed: meta.speed, result: meta.result,
    accuracy: review.accuracy ? review.accuracy[game.me] : null, items,
  };
}
