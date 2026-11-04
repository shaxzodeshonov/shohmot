// Finds the brilliant moves in every game on your accounts, in the browser.
//
// Checking every move of every game with Stockfish would take hours, but a
// brilliant move is always a piece sacrifice, and spotting those needs only
// the rules of chess. So:
//   1. each game's moves come from /api/moves, a window of time at a time;
//   2. chess.js replays every game and keeps your moves that offer up a piece
//      (sacrifice.mjs): usually none to three a game, found in milliseconds;
//   3. Stockfish looks only at those positions, before and after the move,
//      and the same rule as the full review (isBrilliant) decides;
//   4. what's found is kept (store.mjs), so a game is never checked twice.
import { Chess } from 'chess.js';
import { EnginePool } from '../review/engine.mjs';
import { winPercent, isBrilliant } from '../review/analysis.mjs';
import { sacrificeOf } from '../review/sacrifice.mjs';
import { isChecked, saveScanned } from './store.mjs';

const DAY = 86400000;
// Window sizes per site: Chess.com keeps games in monthly archives; Lichess
// streams games at about 20 a second, so a week keeps each answer quick.
const WINDOW = { chesscom: 30 * DAY, lichess: 7 * DAY };
const DEPTH = 14;
const MOVETIME = 1500;

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The opening book, so book moves (gambits!) aren't counted.
let bookPromise = null;
export function loadBook() {
  bookPromise ??= fetch('/openings.json').then((r) => r.json()).catch(() => ({}));
  return bookPromise;
}

// Your moves in one game that sacrifice a piece. Pure, for the tests.
// game: { moves: 'e4 e5 …', color: 'w'|'b', fen? }; book: { [epd]: … }
export function candidates(game, book = {}) {
  let chess;
  try { chess = new Chess(game.fen || undefined); } catch { return []; }
  const out = [];
  const sans = String(game.moves || '').split(' ').filter(Boolean);
  let inBook = !game.fen;
  for (let i = 0; i < sans.length; i++) {
    const fen = chess.fen();
    const mine = chess.turn() === game.color;
    let m;
    try { m = chess.move(sans[i]); } catch { break; }
    if (!m) break;
    if (inBook) inBook = !!book[epd(chess.fen())];
    if (!mine || inBook) continue;
    const uci = uciOf(m);
    const sac = sacrificeOf(fen, uci);
    if (!sac || sac.net < 2 || !sac.piece) continue;
    // Only now the slower checks: a forced move is never brilliant.
    const legal = new Chess(fen).moves().length;
    if (legal <= 1) continue;
    out.push({ ply: i + 1, san: m.san, uci, fen, fenAfter: chess.fen(), legal, piece: sac.piece, mate: chess.isCheckmate(), over: chess.isGameOver() });
  }
  return out;
}

// Stockfish's lines before and after a candidate -> brilliant or not.
export function judge(c, before, after, rating) {
  if (!before || !before[0]) return false;
  const best = winPercent(before[0].score);
  const second = before[1] ? winPercent(before[1].score) : null;
  const isBest = before[0].pv[0] === c.uci || (!!before[1] && before[1].pv[0] === c.uci && second >= best - 1);
  let afterWin;
  if (c.mate) afterWin = 100;
  else if (c.over) afterWin = 50;
  else if (after && after[0]) afterWin = 100 - winPercent(after[0].score); // scores are for the side to move
  else return false;
  return isBrilliant({ sacrifice: true, before: best, after: afterWin, second, isBest, rating, legal: c.legal, book: false });
}

// The windows to ask for, newest first, so recent games show up first.
export function windows(platform, since, until) {
  const out = [];
  for (let to = until; to > since; to -= WINDOW[platform]) out.push({ since: Math.max(since, to - WINDOW[platform]), until: to });
  return out;
}

export async function fetchWindow(account, w, shouldStop) {
  const qs = new URLSearchParams({ platform: account.platform, username: account.username, since: String(Math.floor(w.since)), until: String(Math.floor(w.until)) });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (shouldStop()) return null;
    let res;
    try { res = await fetch(`/api/moves?${qs}`); } catch { await sleep(5000); continue; }
    if (res.status === 429) { await sleep(60000); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.games || [];
  }
  throw new Error('The chess site is busy right now.');
}

// Runs the scan. accounts: [{ platform, username }]. onProgress gets
// { windows, windowsDone, games, candidates, checked, found, note } as it goes;
// onFound(platform, gameId) when a game turns out to have a brilliant move.
// Returns a handle with stop().
export function scan({ accounts, since, until = Date.now(), engine = 'lite', onProgress = () => {}, onFound = () => {}, onDone = () => {} }) {
  let stopped = false;
  let pool = null;
  const shouldStop = () => stopped;
  const p = { windows: 0, windowsDone: 0, games: 0, candidates: 0, checked: 0, found: 0, note: '', errors: [] };
  const jobs = [];
  for (const a of accounts) for (const w of windows(a.platform, since, until)) jobs.push({ a, w });
  p.windows = jobs.length;

  const run = async () => {
    const book = await loadBook();
    onProgress({ ...p });
    for (const { a, w } of jobs) {
      if (stopped) return;
      let games;
      try {
        p.note = `Loading games on ${a.username}…`;
        onProgress({ ...p });
        games = await fetchWindow(a, w, shouldStop);
      } catch (err) {
        p.errors.push(`${a.username}: ${err.message}`);
        p.windowsDone++;
        continue;
      }
      if (!games || stopped) return;
      const todo = games.filter((g) => !isChecked(a.platform, g.id));
      p.games += games.length;
      p.checked += games.length - todo.length;
      // Step 2: the rules-only pass, a few games at a time so the page stays responsive.
      const pending = [];
      for (let i = 0; i < todo.length; i++) {
        if (stopped) return;
        const g = todo[i];
        const cands = candidates(g, book);
        if (cands.length) { pending.push({ g, cands }); p.candidates += cands.length; } else {
          saveScanned(a.platform, g.id, { end: g.end, found: [] });
          p.checked++;
        }
        if (i % 8 === 7) { p.note = `Looking for sacrifices on ${a.username}…`; onProgress({ ...p }); await sleep(0); }
      }
      // Step 3: Stockfish on the candidates only.
      if (pending.length) {
        const list = [];
        for (const item of pending) for (const c of item.cands) {
          c.before = list.push({ fen: c.fen }) - 1;
          c.after = c.over ? -1 : list.push({ fen: c.fenAfter }) - 1;
        }
        const results = new Array(list.length);
        p.note = `Stockfish is checking ${p.candidates} sacrifice${p.candidates === 1 ? '' : 's'}…`;
        onProgress({ ...p });
        pool = new EnginePool(engine);
        try {
          await pool.run(list, {
            depth: DEPTH, movetime: MOVETIME, multiPv: 2,
            onResult(k, lines) {
              results[k] = lines;
              // Finish each game as soon as all its positions are in.
              for (let j = pending.length - 1; j >= 0; j--) {
                const { g, cands } = pending[j];
                if (!cands.every((c) => results[c.before] && (c.after < 0 || results[c.after]))) continue;
                pending.splice(j, 1);
                const found = cands.filter((c) => judge(c, results[c.before], c.after < 0 ? null : results[c.after], g.rating))
                  .map((c) => ({ ply: c.ply, san: c.san, fen: c.fen, uci: c.uci }));
                saveScanned(a.platform, g.id, { end: g.end, username: a.username, opponent: g.opponent, speed: g.speed, found });
                p.checked++;
                if (found.length) { p.found += found.length; onFound(a.platform, g.id); }
                onProgress({ ...p });
              }
            },
          });
        } finally {
          pool.stop();
          pool = null;
        }
      }
      p.windowsDone++;
      onProgress({ ...p });
    }
  };

  const done = run().catch((err) => { p.errors.push(err.message); }).finally(() => { p.note = stopped ? 'Paused.' : 'Done.'; onProgress({ ...p }); onDone({ ...p, stopped }); });
  return {
    done,
    stop() { stopped = true; if (pool) pool.stop(); },
  };
}
