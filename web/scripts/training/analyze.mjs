// The quick mistake check: Stockfish over every position of a game, at a
// lighter depth than the full review, then the same labeller (label.mjs).
// It runs in the browser on the counter page for each new game, and on the
// Training page for older games. What it finds goes to two places:
//   training/store.mjs  your mistakes, misses and blunders, to train on
//   brilliants/store.mjs  your brilliant moves
// A full review of a game later replaces both with its deeper answer.
import { EnginePool } from '../review/engine.mjs';
import { labelGame, buildFromSan, whiteWin } from '../review/label.mjs';
import { gameAccuracy, ACCURACY } from '../review/analysis.mjs';
import { loadBook, fetchWindow, windows } from '../brilliants/scan.mjs';
import { saveScanned } from '../brilliants/store.mjs';
import { isAnalyzed, saveScannedMistakes, mistakesOf } from './store.mjs';

export const QUICK = { depth: 12, movetime: 700 };
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

function bookPlies(fens, book) {
  let n = 0;
  for (let i = 1; i < fens.length; i++) { if (!book[epd(fens[i])]) break; n = i; }
  return n;
}

// One game from /api/moves ({ id, end, color, rating, speed, opponent, moves, fen?, result? }).
// Returns { labels, accuracy, items, brilliants } or null if it can't be read.
export async function analyzeGame(platform, username, g, { engine = 'lite', shouldStop = () => false, onPosition = () => {} } = {}) {
  const game = buildFromSan(g.moves, g.fen);
  if (!game || !game.moves.length) return null;
  const book = g.fen ? {} : await loadBook();
  game.bookPlies = bookPlies(game.fens, book);
  game.me = g.color;
  // The mover's rating sharpens the Brilliant rule; the opponent's isn't sent, so it's left out.
  game.headers = g.color === 'w' ? { WhiteElo: g.rating } : { BlackElo: g.rating };
  const total = game.fens.length;
  const results = new Array(total);
  if (game.end) results[total - 1] = game.end;
  // Book positions need no engine: the labeller calls those moves Book anyway,
  // but it still wants a line, so give them a level one.
  for (let i = 0; i < game.bookPlies; i++) results[i] = [{ depth: 0, score: { cp: 0 }, pv: [game.moves[i].uci] }];
  const jobs = [];
  game.fens.forEach((fen, i) => { if (!results[i]) jobs.push({ fen, i }); });
  const pool = new EnginePool(engine);
  let done = 0;
  try {
    await pool.run(jobs, {
      ...QUICK, multiPv: 2,
      onResult(k, lines) {
        if (shouldStop()) { pool.stop(); return; }
        results[jobs[k].i] = lines.map((l) => ({ depth: l.depth, score: l.score, pv: l.pv.slice(0, 8) }));
        onPosition(++done, jobs.length);
      },
    });
  } finally {
    pool.stop();
  }
  if (shouldStop() || results.some((r) => !r)) return null;
  const { labels } = labelGame(game, results);
  const consts = ACCURACY[platform === 'lichess' ? 'lichess' : 'chesscom'];
  const accWins = game.fens.map((_, i) => whiteWin(game.fens, results, i, consts.k));
  const acc = gameAccuracy(accWins, game.fens[0].split(' ')[1] === 'w', consts);
  const review = { labels, accuracy: { w: acc.white, b: acc.black } };
  const info = mistakesOf(game, results, review, { end: g.end, username, opponent: g.opponent, speed: g.speed, result: g.result || null });
  saveScannedMistakes(platform, g.id, info);
  const brilliants = [];
  labels.forEach((l, i) => {
    if (l === 'brilliant' && game.moves[i].color === game.me) brilliants.push({ ply: i + 1, san: game.moves[i].san, fen: game.fens[i], uci: game.moves[i].uci });
  });
  saveScanned(platform, g.id, { end: g.end, username, opponent: g.opponent, speed: g.speed, found: brilliants });
  return { labels, accuracy: review.accuracy[game.me], items: info.items, brilliants };
}

// Checks many games, newest first. pick(g) chooses which (e.g. losses only).
// onGame(platform, game, result) after each; onProgress({ done, total, note }).
export function analyzeMany({ accounts, since, until = Date.now(), pick = () => true, engine = 'lite', onGame = () => {}, onProgress = () => {}, onDone = () => {} }) {
  let stopped = false;
  const shouldStop = () => stopped;
  const p = { done: 0, total: 0, note: '' };
  const run = async () => {
    for (const a of accounts) {
      for (const w of windows(a.platform, since, until)) {
        if (stopped) return;
        p.note = `Loading games on ${a.username}…`;
        onProgress({ ...p });
        let games;
        try { games = await fetchWindow(a, w, shouldStop); } catch (err) { p.note = err.message; continue; }
        if (!games) return;
        const todo = games.filter((g) => pick(g) && !isAnalyzed(a.platform, g.id)).sort((x, y) => y.end - x.end);
        p.total += todo.length;
        for (const g of todo) {
          if (stopped) return;
          p.note = `Checking your game vs ${g.opponent}…`;
          onProgress({ ...p });
          const out = await analyzeGame(a.platform, a.username, g, { engine, shouldStop });
          if (stopped) return;
          p.done++;
          if (out) onGame(a.platform, g, out);
          onProgress({ ...p });
        }
      }
    }
  };
  const done = run().catch((err) => { p.note = err.message; }).finally(() => { onProgress({ ...p, note: stopped ? 'Paused.' : 'Done.' }); onDone({ ...p, stopped }); });
  return { done, stop() { stopped = true; } };
}
