// Game review page: loads one game, runs Stockfish over every position and
// shows accuracy, move labels, best moves and the evaluation graph. The board
// is also an analysis board: pieces can be moved freely to try other moves
// (a "line" off the game), with a live engine showing the best moves ahead.
// Opened from the game list as /review.html?p=<platform>&u=<username>&id=<game id>&t=<end ms>
import { Chess } from '../vendor/chess.mjs';
import { EnginePool, LiveEngine, ENGINES } from './engine.mjs';
import { boardInput } from './board-input.mjs';
import { play, soundOf, isMuted, setMuted } from './sound.mjs';
import { cloudEvals } from './cloud.mjs';
import { newTree, play as playOn, toPgn } from './tree.mjs';
import { LABELS, BAD, ACCURACY, winPercent, moveAccuracy, gameAccuracy, classify, gameRating, phases } from './analysis.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: just don't cache */ } },
};

const params = new URLSearchParams(location.search);
const PLATFORM = params.get('p');
const USERNAME = params.get('u') || '';
const GAME_ID = params.get('id');
const SITE = PLATFORM === 'lichess' ? 'Lichess' : 'Chess.com';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// depth -> time cap per position (ms). The full network searches fewer
// positions a second, so it gets more time to reach the same depth.
const TIME_CAP = { lite: { 12: 1200, 16: 3000, 18: 5000, 22: 12000 }, full: { 12: 2500, 16: 6000, 18: 9000, 22: 20000 } };

// ---------- game ----------
let game;           // { headers, fens, moves, me, opening }
let official = null; // the site's own accuracy, { white, black }, if it reviewed the game
let results = [];   // engine lines per position, or undefined while pending
let review = null;  // per-move labels etc. once analysis is complete
let ply = 0;        // position shown: 0 = start, n = after the last move
let flipped = false;
let tab = 'report';
let pool = null;

// ---------- exploring ----------
// One line of moves tried on the board, branching off the game after
// `from` moves. vply is how far into it the board is (0 = on the game itself).
let line = null;    // { from, moves: [{ san, uci, from, to, color, captured, fen }] }
let vply = 0;
let sel = null;     // picked square
let targets = [];   // where the picked piece can go: [{ to, capture, promotion }]
let live = null;    // LiveEngine, once the review is done
let liveLines = { fen: null, lines: [] };
let engineOn = store.get('shohmot-review-live') !== false;
let input = null;   // board pointer handling
let promoting = false; // the promotion picker is open, so the board must not be redrawn

function curFen() { return vply ? line.moves[vply - 1].fen : game.fens[ply]; }
function curMove() { return vply ? line.moves[vply - 1] : ply ? game.moves[ply - 1] : null; }

function uciOf(m) { return m.from + m.to + (m.promotion || ''); }
function epd(fen) { return fen.split(' ').slice(0, 4).join(' '); }

function buildGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const replay = new Chess(history.length ? history[0].before : chess.fen());
  const fens = [replay.fen()];
  const legal = [];
  const pieces = [countPieces(replay)];
  const moves = history.map((m) => {
    legal.push(replay.moves().length);
    replay.move(m.san);
    fens.push(replay.fen());
    pieces.push(countPieces(replay));
    return { san: m.san, uci: uciOf(m), from: m.from, to: m.to, color: m.color, captured: m.captured || null, piece: m.piece };
  });
  const lower = USERNAME.toLowerCase();
  const me = (headers.Black || '').toLowerCase() === lower ? 'b' : 'w';
  return { headers, fens, moves, legal, pieces, me, end: endState(replay) };
}

function countPieces(chess) {
  let n = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && 'nbrq'.includes(sq.type)) n++;
  return n;
}

// The engine has nothing to say about a finished position, so score it here.
function endState(chess) {
  if (chess.isCheckmate()) return [{ score: { mate: 0 }, pv: [] }];
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return [{ score: { cp: 0 }, pv: [] }];
  return null;
}

// Book moves: the opening list knows the position after them, from move one on.
function applyBook(openings) {
  let bookPlies = 0;
  let opening = null;
  for (let i = 1; i < game.fens.length; i++) {
    const hit = openings[epd(game.fens[i])];
    if (!hit) break;
    bookPlies = i;
    opening = hit;
  }
  // Keep naming the opening past the book moves if a later position matches.
  for (let i = bookPlies + 1; i < Math.min(game.fens.length, 40); i++) {
    const hit = openings[epd(game.fens[i])];
    if (hit) opening = hit;
  }
  game.bookPlies = bookPlies;
  if (opening) {
    const [eco, name] = opening.split('|');
    game.opening = { eco, name };
  } else if (game.headers.Opening) {
    game.opening = { eco: game.headers.ECO || '', name: game.headers.Opening };
  }
}

// ---------- chess helpers ----------
function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) s += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return s;
}

function playUci(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

// Material the mover is down after a move once the captures in the engine's
// best reply settle (positive = down). Used for sacrifices and "this loses a knight".
function materialDrop(i) {
  const mover = game.moves[i].color;
  const before = balance(new Chess(game.fens[i]), mover);
  const chess = new Chess(game.fens[i + 1]);
  const line = results[i + 1] && results[i + 1][0] ? results[i + 1][0].pv : [];
  for (const uci of line.slice(0, 8)) {
    const probe = new Chess(chess.fen());
    const m = playUci(probe, uci);
    if (!m || (!m.captured && !m.promotion)) break;
    playUci(chess, uci);
  }
  return before - balance(chess, mover);
}

function sanLine(fen, pv, max = 6) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const m = playUci(chess, uci);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// ---------- scores ----------
// White's win chance at position i. k: see ACCURACY.
function whiteWin(i, k) {
  const r = results[i];
  if (!r || !r[0]) return null;
  const w = winPercent(r[0].score, k);
  return game.fens[i].split(' ')[1] === 'w' ? w : 100 - w;
}

// The score as White sees it, e.g. "+1.3", "-0.4", "M3", "-M2".
function evalText(i) {
  const r = results[i];
  return r && r[0] ? scoreText(r[0].score, game.fens[i]) : '';
}

// The same for any score, given the position it is for (scores are for the side to move).
function scoreText(s, fen) {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  if (s.mate != null) {
    if (s.mate === 0) return sign > 0 ? '0-1' : '1-0';
    const m = s.mate * sign;
    return m > 0 ? `M${m}` : `-M${-m}`;
  }
  const v = (s.cp * sign) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

function buildReview() {
  const n = game.moves.length;
  const wins = game.fens.map((_, i) => whiteWin(i));
  // Accuracy on each site's own scale, so it's comparable with what the site shows.
  const consts = ACCURACY[PLATFORM === 'lichess' ? 'lichess' : 'chesscom'];
  const accWins = game.fens.map((_, i) => whiteWin(i, consts.k));
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
    const isBest = best === m.uci || (lines[1] && lines[1].pv[0] === m.uci && second >= before - 1);
    const prev = game.moves[i - 1];
    const drop = materialDrop(i);
    const label = classify({
      before, after, second, isBest,
      legal: game.legal[i],
      book: i < game.bookPlies,
      sacrifice: drop >= 2,
      recapture: !!(prev && prev.captured && m.captured && prev.to === m.to),
      oppLabel: labels[i - 1] || null,
    });
    labels.push(label);
    const mover = (w) => (white ? w : 100 - w);
    info.push({ before, after, best, drop, accuracy: moveAccuracy(mover(accWins[i]), mover(accWins[i + 1]), consts.a) });
  }

  const accuracy = gameAccuracy(accWins, game.fens[0].split(' ')[1] === 'w', consts);
  const { middleStart, endStart } = phases(game.pieces, game.bookPlies);
  const phaseOf = (i) => (i < middleStart ? 0 : i < endStart ? 1 : 2);
  const phaseAcc = [0, 1, 2].map((p) => {
    const out = {};
    for (const c of ['w', 'b']) {
      const xs = info.filter((x, i) => phaseOf(i) === p && game.moves[i].color === c).map((x) => x.accuracy);
      out[c] = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
    }
    return out;
  });
  return { wins, labels, info, accuracy: { w: accuracy.white, b: accuracy.black }, phaseAcc };
}

// ---------- analysis ----------
function cacheKey(depth, engine) { return `shohmot-review:v2:${PLATFORM}:${GAME_ID}:${engine}:${depth}`; }

let run = 0; // bumps on every new analysis, so a stale one stops quietly

async function analyse() {
  const depth = Number($('#depth').value);
  const engine = $('#engine').value;
  const mine = ++run;
  if (pool) pool.stop();
  stopLive();
  pool = null;
  review = null;
  const total = game.fens.length;
  const cached = store.get(cacheKey(depth, engine));
  if (cached && cached.length === total) {
    results = cached;
    finish(depth);
    return;
  }

  results = new Array(total);
  if (game.end) results[total - 1] = game.end;

  // 1. Deep evaluations Lichess already has (mostly the opening).
  $('#progress').hidden = false;
  $('#progress-text').textContent = 'Looking for deep evaluations in the Lichess cloud…';
  $('#progress-bar').style.width = '0%';
  let fromCloud = 0;
  await cloudEvals(game.fens.slice(0, game.end ? total - 1 : total), {
    minDepth: depth + 4,
    shouldStop: () => mine !== run,
    onResult(i, lines) {
      results[i] = lines;
      fromCloud++;
      scheduleRender();
    },
  });
  if (mine !== run) return;

  // 2. Stockfish in the browser for everything else.
  const jobs = [];
  game.fens.forEach((fen, i) => { if (!results[i]) jobs.push({ fen, i }); });
  const note = fromCloud ? ` (${fromCloud} from the Lichess cloud)` : '';
  setProgress(0, jobs.length, note);
  pool = new EnginePool(engine);
  const thisPool = pool;
  let done = 0;
  try {
    await pool.run(jobs, {
      depth,
      movetime: TIME_CAP[engine][depth] || 3000,
      onResult(k, lines) {
        if (thisPool.stopped) return;
        // Keep the first 10 moves of each line; enough for arrows and text.
        results[jobs[k].i] = lines.map((l) => ({ depth: l.depth, score: l.score, pv: l.pv.slice(0, 10) }));
        setProgress(++done, jobs.length, note);
        scheduleRender();
      },
      onDownload(loaded, size) {
        if (thisPool.stopped) return;
        $('#progress-text').textContent = `Downloading Stockfish 19's network, ${Math.round(loaded / 1e6)} of ${Math.round(size / 1e6)} MB (only the first time; Lite starts at once)…`;
        $('#progress-bar').style.width = `${(loaded / size) * 100}%`;
      },
    });
  } catch (err) {
    if (thisPool.stopped || mine !== run) return;
    // The full build comes from unpkg; if that's blocked, the lite one still works.
    if (engine === 'full') {
      $('#engine').value = 'lite';
      return analyse();
    }
    showError(`Stockfish could not start in this browser (${err.message}).`);
    return;
  }
  if (thisPool.stopped || mine !== run) return;
  pool = null;
  store.set(cacheKey(depth, engine), results);
  finish(depth);
}

function finish(depth) {
  review = buildReview();
  $('#progress').hidden = true;
  $('#progress').dataset.depth = depth;
  render();
  follow();
}

// ---------- live engine ----------
// It starts once the review is done, so the two don't fight over the CPU.
function follow() {
  const chess = new Chess(curFen());
  if (!engineOn || !review || chess.isGameOver()) return;
  live ??= new LiveEngine($('#engine').value, (fen, lines) => {
    if (fen !== curFen()) return;
    liveLines = { fen, lines };
    scheduleLive();
  });
  live.show(curFen()).catch(() => { stopLive(); });
}

function stopLive() {
  if (live) live.stop();
  live = null;
  liveLines = { fen: null, lines: [] };
}

// Engine output comes in bursts; redraw at most every 80 ms.
let liveFrame = 0;
function scheduleLive() {
  if (liveFrame) return;
  liveFrame = setTimeout(() => {
    liveFrame = 0;
    renderLines();
    renderEvalBar();
    if (!input || !input.dragging) renderBoard();
    if (tab === 'moves' && vply) renderNote();
  }, 80);
}

// The live lines for the position on the board, if the engine has any yet.
function liveFor(fen) { return liveLines.fen === fen ? liveLines.lines : []; }

function setProgress(done, total, note = '') {
  $('#progress').hidden = false;
  $('#progress-text').textContent = done < total
    ? `${ENGINES[$('#engine').value].name} has looked at ${done} of ${total} positions${note}…`
    : 'Putting the review together…';
  $('#progress-bar').style.width = `${total ? (done / total) * 100 : 100}%`;
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
}

// ---------- rendering ----------
const FILES = 'abcdefgh';

function squareXY(sq) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
}

function renderBoard() {
  if (promoting) return;
  const chess = new Chess(curFen());
  const move = curMove();
  // Review labels only belong to the game's own moves.
  const label = !vply && move && review ? review.labels[ply - 1] : null;
  const to = new Map(targets.map((t) => [t.to, t]));
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const f = flipped ? 7 - x : x;
      const r = flipped ? y : 7 - y;
      const sq = FILES[f] + (r + 1);
      const p = chess.get(sq);
      const cls = ['sq', (f + r) % 2 ? 'light' : 'dark'];
      if (move && (sq === move.from || sq === move.to)) cls.push('last');
      if (sq === sel) cls.push('sel');
      const piece = p ? `<i class="pc" style="background-image:url(pieces/${p.color}${p.type.toUpperCase()}.svg)"></i>` : '';
      const coordF = y === 7 ? `<b class="cf">${FILES[f]}</b>` : '';
      const coordR = x === 0 ? `<b class="cr">${r + 1}</b>` : '';
      const badge = label && sq === move.to ? `<em class="badge" data-l="${label}" title="${LABELS[label].name}">${LABELS[label].mark}</em>` : '';
      const hint = to.has(sq) ? `<span class="${p ? 'hint cap' : 'hint'}"></span>` : '';
      cells.push(`<div class="${cls.join(' ')}" data-sq="${sq}"${label && move && (sq === move.from || sq === move.to) ? ` data-l="${label}"` : ''}>${piece}${coordF}${coordR}${badge}${hint}</div>`);
    }
  }
  // Green: what should have been played instead of a game move that wasn't best.
  // Blue: the live engine's best move from here.
  const arrows = [];
  if (label && !['best', 'book', 'forced', 'brilliant', 'great'].includes(label)) {
    const uci = review.info[ply - 1].best;
    if (uci) arrows.push(arrowPath(squareXY(uci.slice(0, 2)), squareXY(uci.slice(2, 4)), 'a-best'));
  }
  const best = liveFor(curFen())[0];
  if (engineOn && best && best.pv[0] && !sel) arrows.push(arrowPath(squareXY(best.pv[0].slice(0, 2)), squareXY(best.pv[0].slice(2, 4)), 'a-live'));
  const arrow = arrows.length ? `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true">${arrows.join('')}</svg>` : '';
  $('#board').innerHTML = cells.join('') + arrow;
  $('#board').setAttribute('aria-label', move ? `Position after ${moveNumber(vply ? line.from + vply - 1 : ply - 1)} ${move.san}` : 'Starting position');
}

function arrowPath(a, b, cls = '') {
  const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = b.x + 0.5, y2 = b.y + 0.5;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const head = 0.42, w = 0.09, hw = 0.24;
  const ex = x2 - ux * head, ey = y2 - uy * head;
  const px = -uy, py = ux;
  const pts = [
    [x1 + px * w, y1 + py * w], [ex + px * w, ey + py * w], [ex + px * hw, ey + py * hw],
    [x2, y2], [ex - px * hw, ey - py * hw], [ex - px * w, ey - py * w], [x1 - px * w, y1 - py * w],
  ];
  return `<polygon class="${cls}" points="${pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ')}"/>`;
}

function moveNumber(i) {
  const startBlack = game.fens[0].split(' ')[1] === 'b';
  const fullStart = Number(game.fens[0].split(' ')[5]) || 1;
  const k = i + (startBlack ? 1 : 0);
  const num = fullStart + Math.floor(k / 2);
  return k % 2 === 0 ? `${num}.` : `${num}…`;
}

// The eval bar follows the board: the review's score on the game's own
// moves, the live engine's score anywhere else.
function renderEvalBar() {
  const fen = curFen();
  let score = null;
  if (!vply && results[ply] && results[ply][0]) score = results[ply][0].score;
  else if (liveFor(fen)[0]) score = liveFor(fen)[0].score;
  else if (new Chess(fen).isCheckmate()) score = { mate: 0 };
  const toMove = fen.split(' ')[1];
  const w = score ? (toMove === 'w' ? winPercent(score) : 100 - winPercent(score)) : null;
  const bar = $('#evalbar');
  bar.classList.toggle('flipped', flipped);
  bar.querySelector('i').style.height = `${w == null ? 50 : w}%`;
  const span = bar.querySelector('span');
  span.textContent = score ? scoreText(score, fen).replace(/^\+/, '') : '';
  span.className = w != null && w < 50 ? 'black-ahead' : '';
}

function renderPlayers() {
  const h = game.headers;
  const top = flipped ? 'w' : 'b';
  const line = (c) => {
    const name = c === 'w' ? h.White : h.Black;
    const elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    const acc = review && review.accuracy[c];
    const you = c === game.me ? '<span class="you">You</span>' : '';
    return `<span class="pl-dot ${c}"></span><span class="pl-name">${esc(name || '?')}</span>${elo && elo !== '?' ? `<small>${esc(elo)}</small>` : ''}${you}${acc != null ? `<span class="pl-acc">${acc.toFixed(1)}</span>` : ''}`;
  };
  $('#player-top').innerHTML = line(top);
  $('#player-bottom').innerHTML = line(top === 'w' ? 'b' : 'w');
}

function renderGraph() {
  const n = game.fens.length;
  const step = n > 1 ? 1000 / (n - 1) : 1000;
  // Positions finish out of order (cloud first, then Stockfish from the end
  // backwards), so draw one filled shape per run of known positions.
  let d = '';
  let open = -1;
  for (let i = 0; i <= n; i++) {
    const w = i < n ? whiteWin(i) : null;
    if (w != null) {
      if (open < 0) { d += `M${(i * step).toFixed(1)},100`; open = i; }
      d += ` L${(i * step).toFixed(1)},${(100 - w).toFixed(2)}`;
    } else if (open >= 0) {
      d += ` L${((i - 1) * step).toFixed(1)},100 Z `;
      open = -1;
    }
  }
  $('#g-area').setAttribute('d', d);
  const now = $('#g-now');
  now.setAttribute('x1', ply * step);
  now.setAttribute('x2', ply * step);

  if (!review) { $('#g-dots').innerHTML = ''; return; }
  const dots = [];
  review.labels.forEach((l, i) => {
    if (!['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(l)) return;
    const w = review.wins[i + 1];
    dots.push(`<i data-l="${l}" style="left:${((i + 1) / (n - 1)) * 100}%;top:${100 - w}%" title="${esc(`${moveNumber(i)} ${game.moves[i].san}: ${LABELS[l].name}`)}"></i>`);
  });
  $('#g-dots').innerHTML = dots.join('');
}

function badge(l) { return `<em class="badge" data-l="${l}">${LABELS[l].mark}</em>`; }

function renderReport() {
  for (const h of document.querySelectorAll('#tab-report .sub-h')) h.hidden = !review;
  if (!review) {
    $('#acc').innerHTML = '<p class="muted">The report appears when Stockfish is done.</p>';
    $('#counts').innerHTML = '';
    $('#phases').innerHTML = '';
    $('#moments').innerHTML = '';
    return;
  }
  const me = game.me;
  const opp = me === 'w' ? 'b' : 'w';
  const name = (c) => esc((c === 'w' ? game.headers.White : game.headers.Black) || '?');
  const col = (c) => {
    const a = review.accuracy[c];
    const site = official && official[c === 'w' ? 'white' : 'black'];
    return `<div class="acc-col">
      <span class="acc-who">${c === me ? 'You' : name(c)}</span>
      <span class="acc-n">${a == null ? '–' : a.toFixed(1)}</span>
      <span class="acc-label">accuracy</span>
      <span class="acc-rating">Game rating <b>${a == null ? '–' : gameRating(a)}</b></span>
      ${site != null ? `<span class="acc-site" title="The accuracy ${SITE} gave this game in its own review">${SITE}: <b>${Number(site).toFixed(1)}</b></span>` : ''}
    </div>`;
  };
  const cloud = results.filter((r) => r && r[0] && r[0].cloud).length;
  const depths = results.filter((r) => r && r[0] && !r[0].cloud && r[0].depth).map((r) => r[0].depth).sort((x, y) => x - y);
  const deepest = depths.length ? depths[Math.floor(depths.length / 2)] : 0; // the typical depth reached
  $('#acc').innerHTML = col(me) + col(opp) + `<p class="acc-src">${esc(ENGINES[$('#engine').value].name)}${deepest ? `, depth ${deepest}` : ''}${cloud ? ` · ${cloud} position${cloud === 1 ? '' : 's'} from the Lichess cloud` : ''}</p>`;

  const count = (l, c) => review.labels.filter((x, i) => x === l && game.moves[i].color === c).length;
  const order = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  $('#counts').innerHTML = `<thead><tr><th></th><th>You</th><th>${name(opp)}</th></tr></thead><tbody>${order
    .filter((l) => l !== 'forced' || count(l, me) + count(l, opp) > 0)
    .map((l) => {
      const a = count(l, me), b = count(l, opp);
      return `<tr data-l="${l}"><th>${badge(l)} ${LABELS[l].name}</th>
        <td>${a ? `<button type="button" class="jump" data-l="${l}" title="Show your ${LABELS[l].name.toLowerCase()} moves">${a}</button>` : '<span class="zero">0</span>'}</td>
        <td>${b || '<span class="zero">0</span>'}</td></tr>`;
    }).join('')}</tbody>`;

  const pName = ['Opening', 'Middlegame', 'Endgame'];
  const cell = (v) => (v == null ? '<span class="zero">–</span>' : `<span class="ph" data-q="${quality(v)}">${v.toFixed(0)}</span>`);
  $('#phases').innerHTML = `<tbody>${review.phaseAcc.map((p, k) => `<tr><th>${pName[k]}</th><td>${cell(p[me])}</td><td>${cell(p[opp])}</td></tr>`).join('')}</tbody>`;

  const moments = [];
  review.labels.forEach((l, i) => {
    if (game.moves[i].color !== me) return;
    if (BAD.has(l) && l !== 'inaccuracy' || l === 'brilliant' || l === 'great') {
      moments.push(`<li><button type="button" data-ply="${i + 1}">${badge(l)}<span>${moveNumber(i)} ${esc(game.moves[i].san)}</span><small>${LABELS[l].name}</small></button></li>`);
    }
  });
  $('#moments').innerHTML = moments.join('') || '<li class="muted">No big moments: no mistakes, misses or blunders. Nice.</li>';
}

function quality(acc) {
  return acc >= 90 ? 'best' : acc >= 80 ? 'good' : acc >= 65 ? 'inaccuracy' : acc >= 50 ? 'mistake' : 'blunder';
}

function renderMoves() {
  const out = [];
  const n = game.moves.length;
  // The tried line goes right under the row of the game move it replaces.
  const after = line ? Math.min(n - 1, line.from + (game.moves[line.from] && game.moves[line.from].color === 'w' ? 1 : 0)) : -1;
  game.moves.forEach((m, i) => {
    const l = review ? review.labels[i] : null;
    const num = m.color === 'w' || i === 0 ? `<span class="num">${moveNumber(i).replace('…', '.')}</span>${m.color === 'b' ? '<span></span>' : ''}` : '';
    const on = !vply && i + 1 === ply;
    out.push(`${num}<button type="button" class="mv${on ? ' on' : ''}" data-ply="${i + 1}"${l ? ` data-l="${l}"` : ''}>${esc(m.san)}${l && l !== 'best' && l !== 'excellent' && l !== 'good' ? badge(l) : ''}</button>`);
    if (i === after) out.push(variationHtml());
  });
  if (line && after < 0) out.push(variationHtml());
  const list = $('#moves');
  list.innerHTML = `<li>${out.join('')}</li>`;
  const on = list.querySelector('.mv.on, .vm.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function variationHtml() {
  const bits = line.moves.map((m, k) => {
    const i = line.from + k;
    const num = m.color === 'w' || k === 0 ? `<span class="vnum">${moveNumber(i)}</span>` : '';
    return `${num}<button type="button" class="vm${vply === k + 1 ? ' on' : ''}" data-vply="${k + 1}">${esc(m.san)}</button>`;
  });
  return `<div class="var"><span class="var-h">Your line</span>${bits.join(' ')}<button type="button" class="var-x" data-go="drop" title="Remove this line" aria-label="Remove this line">×</button></div>`;
}

function renderNote() {
  const el = $('#note');
  if (vply) {
    const m = curMove();
    const best = liveFor(curFen())[0];
    const end = gameOverText(new Chess(curFen()));
    el.innerHTML = `<p class="note-h" data-l="explore"><span>${moveNumber(line.from + vply - 1)} ${esc(m.san)}</span><small class="ev">${end || (best ? scoreText(best.score, curFen()) : '')}</small></p>
      <p class="muted">You're trying your own moves from move ${moveNumber(line.from).replace(/[.…]$/, '')} of the game${end ? '.' : '. The engine lines above show where it goes.'}</p>
      <p><button type="button" class="btn" data-go="game">Back to the game</button></p>`;
    return;
  }
  if (ply === 0) {
    el.innerHTML = `<p class="note-h">Starting position</p><p class="muted">${game.opening ? `${esc(game.opening.name)}${game.opening.eco ? ` (${esc(game.opening.eco)})` : ''}. ` : ''}Use ← → to step through the game.</p>`;
    return;
  }
  const i = ply - 1;
  const m = game.moves[i];
  const who = m.color === game.me ? 'You' : 'Your opponent';
  if (!review) {
    el.innerHTML = `<p class="note-h">${moveNumber(i)} ${esc(m.san)}</p><p class="muted">${results[ply] ? `Evaluation ${evalText(ply)}.` : 'Waiting for Stockfish…'}</p>`;
    return;
  }
  const l = review.labels[i];
  const info = review.info[i];
  const lines = results[i];
  const isAn = /^(inaccuracy|excellent|book)/.test(l) ? 'an' : 'a';
  const head = l === 'book' ? `${esc(m.san)} is a book move`
    : l === 'forced' ? `${esc(m.san)} was the only legal move`
    : l === 'best' ? `${esc(m.san)} is the best move`
    : `${esc(m.san)} is ${l === 'brilliant' || l === 'great' ? '' : `${isAn} `}${LABELS[l].name.toLowerCase()}${l === 'brilliant' || l === 'great' ? '!' : ''}`;

  const said = [];
  const afterLines = results[ply];
  const afterScore = afterLines && afterLines[0] ? afterLines[0].score : null;
  if (l === 'brilliant') said.push(`${who === 'You' ? 'You' : 'They'} gave up material and the position holds up.`);
  if (l === 'great') said.push('It was the only move that kept the position together.');
  if (BAD.has(l)) {
    if (afterScore && afterScore.mate > 0) said.push(`It allows mate in ${afterScore.mate}.`);
    else if (info.drop >= 1) said.push(`It loses ${lossText(info.drop)}.`);
    if (l === 'miss') said.push(`${who === 'You' ? 'Your opponent' : 'You'} had just slipped, and this lets them off the hook.`);
    const bestScore = lines[0].score;
    if (bestScore.mate > 0) said.push(`There was mate in ${bestScore.mate}.`);
    if (!said.length) said.push(`The evaluation goes from ${evalText(i)} to ${evalText(ply)}.`);
  }
  let best = '';
  if (!['best', 'book', 'forced', 'brilliant', 'great'].includes(l) && info.best) {
    const line = sanLine(game.fens[i], lines[0].pv);
    best = `<p class="best-line"><span>Best was</span> <b>${esc(line[0] || info.best)}</b>${line.length > 1 ? ` <small>${esc(line.slice(1).join(' '))}</small>` : ''}</p>`;
  }
  el.innerHTML = `<p class="note-h" data-l="${l}">${badge(l)}<span>${head}</span><small class="ev">${evalText(ply)}</small></p>${said.length ? `<p>${said.join(' ')}</p>` : ''}${best}`;
}

function lossText(d) {
  if (d >= 8) return 'the queen';
  if (d >= 5) return 'a rook';
  if (d >= 3) return 'a piece';
  if (d >= 2) return 'two pawns';
  return 'a pawn';
}

function gameOverText(chess) {
  if (chess.isCheckmate()) return 'Checkmate';
  if (chess.isStalemate()) return 'Stalemate';
  if (chess.isDraw()) return 'Draw';
  return '';
}

// The engine's top lines for the position on the board, Chess.com style:
// the score, then the moves it expects. Clicking a move plays the line up to it.
function renderLines() {
  $('#live-toggle').setAttribute('aria-pressed', String(engineOn));
  const body = $('#lines-body');
  const depth = $('#lines-depth');
  depth.textContent = '';
  if (!engineOn) { body.innerHTML = '<p class="muted">Engine lines are off.</p>'; return; }
  const fen = curFen();
  const end = gameOverText(new Chess(fen));
  if (end) { body.innerHTML = `<p class="muted">${end}.</p>`; return; }
  if (!review) { body.innerHTML = '<p class="muted">Live lines start when the review is done.</p>'; return; }
  const lines = liveFor(fen);
  if (!lines.length) { body.innerHTML = '<p class="muted">Thinking…</p>'; return; }
  depth.textContent = `depth ${lines[0].depth}`;
  const next = vply ? line.from + vply : ply; // move index of the next move
  const toMove = fen.split(' ')[1];
  body.innerHTML = lines.map((l, k) => {
    const w = toMove === 'w' ? winPercent(l.score) : 100 - winPercent(l.score);
    const moves = sanLine(fen, l.pv, 12).map((san, j) => {
      const white = (j % 2 === 0) === (toMove === 'w');
      const num = white || j === 0 ? `<span class="vnum">${moveNumber(next + j)}</span>` : '';
      return `${num}<button type="button" class="lm" data-line="${k}" data-n="${j + 1}">${esc(san)}</button>`;
    }).join(' ');
    return `<div class="line"><b class="sc${w < 50 ? ' black' : ''}">${scoreText(l.score, fen)}</b><span class="lmoves">${moves}</span></div>`;
  }).join('');
}

function render() {
  renderBoard();
  renderEvalBar();
  renderPlayers();
  renderGraph();
  renderLines();
  if (tab === 'report') renderReport();
  else { renderNote(); renderMoves(); }
  $('#next-bad').disabled = !review;
}

// Every change of position comes through here: draw, sound, follow with the engine.
function moved(sound) {
  sel = null;
  targets = [];
  if (tab !== 'moves') setTab('moves');
  else render();
  if (sound) play(sound);
  follow();
}

// Jump to a game position (leaving any tried line in the move list).
function go(to) {
  const before = ply;
  const wasLine = vply;
  ply = Math.max(0, Math.min(game.fens.length - 1, to));
  vply = 0;
  if (ply === before && !wasLine) return moved(null);
  moved(ply > before ? soundOf(game.moves[ply - 1]) : 'move');
}

// One step back or forward along whatever line the board is on.
function step(d) {
  if (vply) {
    const next = Math.max(0, Math.min(line.moves.length, vply + d));
    if (next === vply) return;
    vply = next;
    return moved(d > 0 ? soundOf(curMove()) : 'move');
  }
  go(ply + d);
}

function goLine(k) {
  ply = line.from;
  vply = Math.max(0, Math.min(line.moves.length, k));
  moved(soundOf(curMove()));
}

// Plays a move on the board (uci), from wherever the board is. The game's own
// next move just steps forward; anything else starts or extends the tried line.
function playMove(uci, { quiet = false } = {}) {
  const chess = new Chess(curFen());
  const m = playUci(chess, uci);
  if (!m) return false;
  const entry = { san: m.san, uci: uciOf(m), from: m.from, to: m.to, color: m.color, captured: m.captured || null, fen: chess.fen() };
  if (!vply && game.moves[ply] && game.moves[ply].uci === entry.uci) {
    ply++;
  } else if (!vply) {
    line = { from: ply, moves: [entry] };
    vply = 1;
  } else if (line.moves[vply] && line.moves[vply].uci === entry.uci) {
    vply++;
  } else {
    line.moves = line.moves.slice(0, vply).concat(entry);
    vply++;
  }
  if (!quiet) moved(soundOf(entry));
  return true;
}

// Plays the first n moves of live line k.
function playLine(k, n) {
  const l = liveFor(curFen())[k];
  if (!l) return;
  let last = null;
  for (const uci of l.pv.slice(0, n)) {
    if (!playMove(uci, { quiet: true })) break;
    last = curMove();
  }
  if (last) moved(soundOf(last));
}

// ---------- moving pieces ----------
function squareAt(x, y) {
  const r = $('#board').getBoundingClientRect();
  const cx = Math.floor(((x - r.left) / r.width) * 8);
  const cy = Math.floor(((y - r.top) / r.height) * 8);
  if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
  return flipped ? FILES[7 - cx] + (cy + 1) : FILES[cx] + (8 - cy);
}

function pick(sq) {
  const chess = new Chess(curFen());
  const p = chess.get(sq);
  if (!p || p.color !== chess.turn()) return false;
  sel = sq;
  targets = chess.moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, promotion: !!m.promotion }));
  renderBoard();
  return true;
}

async function dropOn(from, to) {
  const t = targets.find((x) => x.to === to);
  if (!t) return;
  let promo = '';
  if (t.promotion) {
    promo = await askPromotion(new Chess(curFen()).turn(), to);
    if (!promo) { sel = null; targets = []; renderBoard(); return; }
  }
  playMove(from + to + promo);
}

// A little column of pieces on the promotion square, like on Chess.com.
function askPromotion(color, to) {
  return new Promise((resolve) => {
    const { x, y } = squareXY(to);
    const box = document.createElement('div');
    box.className = 'promo';
    box.style.setProperty('--x', x);
    box.style.setProperty('--y', y < 4 ? y : y - 3);
    const order = y < 4 ? ['q', 'n', 'r', 'b'] : ['b', 'r', 'n', 'q'];
    box.innerHTML = order.map((p) => `<button type="button" data-p="${p}" aria-label="${PIECE_NAME[p]}"><i class="pc" style="background-image:url(pieces/${color}${p.toUpperCase()}.svg)"></i></button>`).join('');
    const outside = (e) => { if (!box.contains(e.target)) done(null); };
    const done = (v) => { promoting = false; box.remove(); document.removeEventListener('pointerdown', outside, true); resolve(v); };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) done(b.dataset.p); });
    $('#board').append(box);
    promoting = true;
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  });
}

function setTab(t) {
  tab = t;
  for (const b of $('#tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === t));
  $('#tab-report').hidden = t !== 'report';
  $('#tab-moves').hidden = t !== 'moves';
  render();
}

function nextOfMine(test) {
  if (!review) return;
  const n = review.labels.length;
  for (let k = 1; k <= n; k++) {
    const i = (ply - 1 + k) % n;
    if (game.moves[i].color === game.me && test(review.labels[i])) return go(i + 1);
  }
}

function showError(text) {
  const el = $('#error');
  el.textContent = text;
  el.hidden = false;
  $('#progress').hidden = true;
}

// ---------- start ----------
function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ply],[data-vply],[data-go],[data-tab],[data-line],.jump');
    if (!t || !game) return;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.classList.contains('jump')) return nextOfMine((l) => l === t.dataset.l);
    if (t.dataset.ply) return go(Number(t.dataset.ply));
    if (t.dataset.vply) return goLine(Number(t.dataset.vply));
    if (t.dataset.line) return playLine(Number(t.dataset.line), Number(t.dataset.n));
    const g = t.dataset.go;
    if (g === 'game') return go(line ? line.from : ply);
    if (g === 'drop') { const back = vply ? line.from : ply; line = null; vply = 0; return go(back); }
    if (g === 'start') return go(0);
    if (g === 'end') return go(game.fens.length - 1);
    step(g === 'next' ? 1 : -1);
  });
  $('#live-toggle').addEventListener('click', () => {
    engineOn = !engineOn;
    store.set('shohmot-review-live', engineOn);
    if (engineOn) follow(); else stopLive();
    render();
  });
  const sound = $('#sound');
  const showSound = () => { sound.setAttribute('aria-pressed', String(!isMuted())); sound.title = isMuted() ? 'Sound off (M)' : 'Sound on (M)'; };
  sound.addEventListener('click', () => { setMuted(!isMuted()); showSound(); if (!isMuted()) play('move'); });
  showSound();
  input = boardInput($('#board'), {
    squareAt,
    selected: () => sel,
    pick: (sq) => !!game && pick(sq),
    isTarget: (sq) => targets.some((t) => t.to === sq),
    move: (from, to) => { dropOn(from, to); },
    clear: () => { if (sel) { sel = null; targets = []; renderBoard(); } },
    redraw: () => renderBoard(),
  });
  $('#next-bad').addEventListener('click', () => nextOfMine((l) => BAD.has(l)));
  // The analysis board gets the game (with any tried line in place of the
  // rest of it) and opens on the position shown here.
  $('#to-analysis').addEventListener('click', (e) => {
    if (!game) return;
    const moves = vply ? game.moves.slice(0, line.from).concat(line.moves) : game.moves;
    let n = newTree(game.fens[0]);
    const root = n;
    for (const m of moves) n = playOn(n, m.uci) || n;
    const pgn = toPgn(root, { White: game.headers.White || '?', Black: game.headers.Black || '?' });
    const at = vply ? line.from + vply : ply;
    e.currentTarget.href = `analysis.html#${new URLSearchParams({ pgn, ply: at, flip: flipped ? '1' : '0' })}`;
  });
  $('#flip').addEventListener('click', () => { flipped = !flipped; render(); });
  $('#depth').addEventListener('change', analyse);
  $('#engine').addEventListener('change', analyse);
  $('#graph').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    go(Math.round(((e.clientX - r.left) / r.width) * (game.fens.length - 1)));
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!game) return;
    const keys = {
      ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => go(0), End: () => go(game.fens.length - 1),
      f: () => $('#flip').click(), n: () => $('#next-bad').click(), m: () => $('#sound').click(),
      Escape: () => { sel = null; targets = []; renderBoard(); },
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });
}

function renderHead() {
  const h = game.headers;
  const opp = game.me === 'w' ? h.Black : h.White;
  const r = h.Result;
  const won = (r === '1-0' && game.me === 'w') || (r === '0-1' && game.me === 'b');
  const lost = (r === '1-0' && game.me === 'b') || (r === '0-1' && game.me === 'w');
  $('#title').innerHTML = won ? `You beat ${esc(opp)}` : lost ? `You lost to <span class="n-lost">${esc(opp)}</span>` : r === '1/2-1/2' ? `You drew with ${esc(opp)}` : `You vs ${esc(opp)}`;
  document.title = `${$('#title').textContent} · Shohmot`;
  const bits = [SITE];
  const date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) bits.push(new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  if (h.TimeControl) bits.push(timeControl(h.TimeControl));
  if (game.opening) bits.push(`${game.opening.name}${game.opening.eco ? ` (${game.opening.eco})` : ''}`);
  if (h.Termination && /won|drawn|abandon/i.test(h.Termination)) bits.push(h.Termination);
  $('#meta').textContent = bits.join(' · ');
}

function timeControl(tc) {
  if (tc.includes('/')) return 'Daily';
  // Seconds plus increment, e.g. "180+2" -> "3+2", "60" -> "1 min".
  const [base, inc] = tc.split('+').map(Number);
  if (Number.isNaN(base)) return tc;
  if (!inc) return base >= 60 ? `${base / 60} min` : `${base} sec`;
  return `${base >= 60 || base === 0 ? base / 60 : `${base}s`}+${inc}`;
}

async function main() {
  wire();
  if (!PLATFORM || !GAME_ID || !USERNAME) {
    $('#title').textContent = 'No game picked';
    return showError('Open a game from the game list on the home page.');
  }
  const savedDepth = store.get('shohmot-review-depth');
  if (savedDepth && $('#depth').querySelector(`option[value="${savedDepth}"]`)) $('#depth').value = String(savedDepth);
  $('#depth').addEventListener('change', () => store.set('shohmot-review-depth', Number($('#depth').value)));
  // The full engine is the most accurate, but it's a 99 MB download, so phones
  // start on lite unless full was picked before.
  const savedEngine = store.get('shohmot-review-engine');
  const phone = matchMedia('(max-width: 43.75em)').matches || (navigator.connection && navigator.connection.saveData);
  $('#engine').value = savedEngine || (phone ? 'lite' : 'full');
  $('#engine').addEventListener('change', () => store.set('shohmot-review-engine', $('#engine').value));

  let data;
  try {
    const qs = new URLSearchParams({ platform: PLATFORM, username: USERNAME, id: GAME_ID, end: params.get('t') || '' });
    const res = await fetch(`/api/game?${qs}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    $('#title').textContent = 'Could not load this game';
    return showError(err.message);
  }
  try {
    game = buildGame(data.pgn);
  } catch {
    $('#title').textContent = 'Could not read this game';
    return showError('Only standard chess games can be reviewed.');
  }
  if (!game.moves.length) {
    $('#title').textContent = 'Nothing to review';
    return showError('This game has no moves.');
  }
  official = data.official || null;
  const link = $('#site-link');
  link.href = data.url;
  link.textContent = `Open on ${SITE}`;
  link.hidden = false;

  try {
    applyBook(await fetch('/openings.json').then((r) => r.json()));
  } catch {
    game.bookPlies = 0;
  }
  flipped = game.me === 'b';
  ply = 0;
  renderHead();
  $('#grid').hidden = false;
  $('#panel-game').hidden = false;
  render();
  analyse();
}

main();
