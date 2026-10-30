// Analysis board: play out any position, try as many lines as you like (each
// one a variation in the move tree, like Chess.com's analysis board) and see
// a live Stockfish's top 3 lines, eval bar and best-move arrow as you go.
// "Simulate game" lets Stockfish play on from the board, against itself or
// against you. The analysis is kept in the browser, so it's still there
// after a reload.
// Opened bare for a new board, or as /analysis.html#pgn=<PGN>&ply=<n> from a
// game review to carry on from that game.
import { Chess } from '../vendor/chess.mjs';
import { LiveEngine, MoveEngine } from './engine.mjs';
import { boardInput } from './board-input.mjs';
import { winPercent } from './analysis.mjs';
import { play as playSound, soundOf, isMuted, setMuted } from './sound.mjs';
import { START, newTree, play, pathTo, lineEnd, onMainLine, cut, promote, numText, moveNo, toPgn, fromPgn, addressOf, nodeAt } from './tree.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: just don't keep it */ } },
};
const SAVE_KEY = 'shohmot-analysis';
const FILES = 'abcdefgh';
const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

let root = newTree();
let cur = root;
let headers = {};   // White / Black names, when the analysis came from a game
let byId = new Map();
let flipped = false;
let openings = {};
let sel = null;     // picked square
let targets = [];   // where the picked piece can go: [{ to, promotion }]
let input = null;
let promoting = false;
let live = null;
let liveLines = { fen: null, lines: [] };
let engineOn = store.get('shohmot-review-live') !== false;

// ---------- keeping the analysis ----------
function save() {
  store.set(SAVE_KEY, { pgn: toPgn(root, headers), at: addressOf(cur), flipped });
}

function load(pgn, at = null) {
  const parsed = fromPgn(pgn);
  root = parsed.root;
  headers = { White: parsed.headers.White, Black: parsed.headers.Black };
  for (const k of Object.keys(headers)) if (!headers[k] || headers[k] === '?') delete headers[k];
  cur = at ? nodeAt(root, at) : root;
}

function loadFen(fen) {
  root = newTree(new Chess(fen).fen());
  headers = {};
  cur = root;
}

function index() {
  byId = new Map();
  const walk = (n) => { byId.set(n.id, n); n.children.forEach(walk); };
  walk(root);
}

// ---------- engine ----------
function follow() {
  if (hintsHidden()) { stopLive(); return; }
  if (!engineOn) return;
  const fen = cur.fen;
  if (new Chess(fen).isGameOver()) { liveLines = { fen: null, lines: [] }; return; }
  live ??= new LiveEngine($('#engine').value, (f, lines) => {
    if (f !== cur.fen) return;
    liveLines = { fen: f, lines };
    scheduleLive();
  });
  live.show(fen).catch(() => {
    // The full build comes from unpkg; if that's blocked, the lite one still works.
    stopLive();
    if ($('#engine').value === 'full') { $('#engine').value = 'lite'; follow(); }
  });
}

function stopLive() {
  if (live) live.stop();
  live = null;
  liveLines = { fen: null, lines: [] };
}

let liveFrame = 0;
function scheduleLive() {
  if (liveFrame) return;
  liveFrame = setTimeout(() => {
    liveFrame = 0;
    renderLines();
    renderEvalBar();
    if (!input || !input.dragging) renderBoard();
  }, 80);
}

const liveFor = (fen) => (liveLines.fen === fen ? liveLines.lines : []);

// ---------- text ----------
function scoreText(s, fen) {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  if (s.mate != null) {
    if (s.mate === 0) return sign > 0 ? '0-1' : '1-0';
    const m = s.mate * sign;
    return m > 0 ? `M${m}` : `-M${-m}`;
  }
  const v = (s.cp * sign) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function gameOverText(chess) {
  if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
  if (chess.isStalemate()) return 'Stalemate';
  if (chess.isInsufficientMaterial()) return 'Draw: not enough material';
  if (chess.isThreefoldRepetition()) return 'Draw by repetition';
  if (chess.isDraw()) return 'Draw';
  return '';
}

function epd(fen) { return fen.split(' ').slice(0, 4).join(' '); }

// The opening of the deepest named position on the way to this one.
function openingOf(node) {
  for (let n = node; n; n = n.parent) {
    const hit = openings[epd(n.fen)];
    if (hit) {
      const [eco, name] = hit.split('|');
      return `${name}${eco ? ` (${eco})` : ''}`;
    }
  }
  return node === root ? (root.fen === START ? 'Starting position' : 'Custom position') : '';
}

// ---------- board ----------
function squareXY(sq) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
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

function renderBoard() {
  if (promoting) return;
  const chess = new Chess(cur.fen);
  const last = cur.parent ? cur : null;
  // The king in check gets a red glow, as on Chess.com.
  let checked = null;
  if (chess.inCheck()) {
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) checked = p.square;
  }
  const to = new Map(targets.map((t) => [t.to, t]));
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const f = flipped ? 7 - x : x;
      const r = flipped ? y : 7 - y;
      const sq = FILES[f] + (r + 1);
      const p = chess.get(sq);
      const cls = ['sq', (f + r) % 2 ? 'light' : 'dark'];
      if (last && (sq === last.from || sq === last.to)) cls.push('last');
      if (sq === sel) cls.push('sel');
      if (sq === checked) cls.push('check');
      const piece = p ? `<i class="pc" style="background-image:url(pieces/${p.color}${p.type.toUpperCase()}.svg)"></i>` : '';
      const coordF = y === 7 ? `<b class="cf">${FILES[f]}</b>` : '';
      const coordR = x === 0 ? `<b class="cr">${r + 1}</b>` : '';
      const hint = to.has(sq) ? `<span class="${p ? 'hint cap' : 'hint'}"></span>` : '';
      cells.push(`<div class="${cls.join(' ')}" data-sq="${sq}">${piece}${coordF}${coordR}${hint}</div>`);
    }
  }
  const best = liveFor(cur.fen)[0];
  const arrow = engineOn && !hintsHidden() && best && best.pv[0] && !sel
    ? `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true">${arrowPath(squareXY(best.pv[0].slice(0, 2)), squareXY(best.pv[0].slice(2, 4)), 'a-live')}</svg>`
    : '';
  $('#board').innerHTML = cells.join('') + arrow;
  $('#board').setAttribute('aria-label', last ? `Position after ${numText(last)} ${last.san}` : 'Starting position');
}

function renderEvalBar() {
  const fen = cur.fen;
  const chess = new Chess(fen);
  let score = liveFor(fen)[0] ? liveFor(fen)[0].score : null;
  if (chess.isCheckmate()) score = { mate: 0 };
  else if (chess.isDraw() || chess.isStalemate()) score = { cp: 0 };
  const toMove = fen.split(' ')[1];
  const w = score && engineOn && !hintsHidden() ? (toMove === 'w' ? winPercent(score) : 100 - winPercent(score)) : null;
  const bar = $('#evalbar');
  bar.classList.toggle('flipped', flipped);
  bar.querySelector('i').style.height = `${w == null ? 50 : w}%`;
  const span = bar.querySelector('span');
  span.textContent = w != null ? scoreText(score, fen).replace(/^\+/, '').replace(/\.(\d)\d$/, '.$1') : '';
  span.className = w != null && w < 50 ? 'black-ahead' : '';
}

function renderPlayers() {
  const top = flipped ? 'w' : 'b';
  const row = (c) => `<span class="pl-dot ${c}"></span><span class="pl-name">${esc(headers[c === 'w' ? 'White' : 'Black'] || (c === 'w' ? 'White' : 'Black'))}</span>`;
  $('#player-top').innerHTML = row(top);
  $('#player-bottom').innerHTML = row(top === 'w' ? 'b' : 'w');
}

// ---------- engine lines ----------
function renderLines() {
  $('#live-toggle').setAttribute('aria-pressed', String(engineOn));
  const body = $('#lines-body');
  const depth = $('#lines-depth');
  depth.textContent = '';
  if (!engineOn) { body.innerHTML = '<p class="muted">Engine lines are off.</p>'; return; }
  const fen = cur.fen;
  const end = gameOverText(new Chess(fen));
  if (end) { body.innerHTML = `<p class="muted">${end}.</p>`; return; }
  const lines = liveFor(fen);
  if (!lines.length) { body.innerHTML = '<p class="muted">Thinking…</p>'; return; }
  depth.textContent = `depth ${lines[0].depth}`;
  const toMove = fen.split(' ')[1];
  const fullNo = Number(fen.split(' ')[5]) || 1;
  body.innerHTML = lines.map((l, k) => {
    const w = toMove === 'w' ? winPercent(l.score) : 100 - winPercent(l.score);
    const chess = new Chess(fen);
    const moves = [];
    for (const [j, uci] of l.pv.slice(0, 12).entries()) {
      let m;
      try { m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { break; }
      const white = m.color === 'w';
      const n = fullNo + Math.floor((j + (toMove === 'b' ? 1 : 0)) / 2);
      const num = white || j === 0 ? `<span class="vnum">${n}${white ? '.' : '...'}</span>` : '';
      moves.push(`${num}<button type="button" class="lm" data-line="${k}" data-n="${j + 1}">${esc(m.san)}</button>`);
    }
    return `<div class="line"><b class="sc${w < 50 ? ' black' : ''}">${scoreText(l.score, fen)}</b><span class="lmoves">${moves.join(' ')}</span></div>`;
  }).join('');
}

// ---------- move tree ----------
// The main line goes in rows (number, White, Black). A move's variations sit
// in an indented block under its row, and a line that branches again nests
// another block inside; past three levels deep they go inline in brackets.
function mv(n, cls = 'mv') {
  return `<button type="button" class="${cls}${n === cur ? ' on' : ''}" data-id="${n.id}">${esc(n.san)}</button>`;
}

function variations(alts, depth) {
  if (depth >= 3) return alts.map((v) => `<span class="paren">(${lineHtml(v, depth)})</span>`).join(' ');
  return `<div class="vars">${alts.map((v) => `<div class="vline">${lineHtml(v, depth)}</div>`).join('')}</div>`;
}

function lineHtml(start, depth) {
  const parts = [`<span class="vnum">${numText(start)}</span>${mv(start, 'vm')}`];
  let n = start;
  let force = false;
  while (n.children.length) {
    const [main, ...alts] = n.children;
    const num = main.color === 'w' || force ? `<span class="vnum">${numText(main)}</span>` : '';
    parts.push(`${num}${mv(main, 'vm')}`);
    force = false;
    if (alts.length) { parts.push(variations(alts, depth + 1)); force = true; }
    n = main;
  }
  return parts.join(' ');
}

function renderTree() {
  const out = [];
  let row = null;
  const dots = '<span class="mv dots">…</span>';
  const close = () => { if (row) out.push(`<div class="mrow">${row.join('')}</div>`); row = null; };
  let n = root;
  while (n.children.length) {
    const [main, ...alts] = n.children;
    if (main.color === 'w') {
      close();
      row = [`<span class="num">${moveNo(main)}.</span>`, mv(main)];
      if (alts.length) { row.push(dots); close(); out.push(variations(alts, 1)); }
    } else {
      if (!row) row = [`<span class="num">${moveNo(main)}.</span>`, dots];
      row.push(mv(main));
      close();
      if (alts.length) out.push(variations(alts, 1));
    }
    n = main;
  }
  close();
  const tree = $('#tree');
  tree.innerHTML = out.join('') || '<p class="muted empty">Move a piece to start. Every move you try is kept: going back and playing something else adds a variation.</p>';
  const on = tree.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function renderOpening() {
  const el = $('#opening');
  el.textContent = openingOf(cur) || ' ';
  el.title = el.textContent;
}

function render() {
  renderOpening();
  renderBoard();
  renderEvalBar();
  renderPlayers();
  renderLines();
  renderTree();
  renderSim();
}

// ---------- moving around ----------
// Every change of position comes through here: draw, sound, engine, save.
// how: 'move' for a move played on the board, 'keep' for a take-back, and
// 'nav' for jumping around, which pauses a running simulation.
function show(node, sound, how = 'nav') {
  if (how === 'nav' && sim.running) { sim.running = false; sim.token++; }
  cur = node;
  sel = null;
  targets = [];
  liveLines = { fen: null, lines: [] };
  render();
  if (sound) playSound(sound);
  follow();
  save();
  if (sim.running) simTick();
}

function step(d) {
  if (d < 0 && cur.parent) show(cur.parent, 'move');
  if (d > 0 && cur.children[0]) show(cur.children[0], soundOf(cur.children[0]));
}

function playMove(uci) {
  const next = play(cur, uci);
  if (!next) return false;
  index();
  show(next, soundOf(next), 'move');
  return true;
}

// Plays the first n moves of live line k.
function playLine(k, n) {
  const l = liveFor(cur.fen)[k];
  if (!l) return;
  let node = cur;
  for (const uci of l.pv.slice(0, n)) {
    const next = play(node, uci);
    if (!next) break;
    node = next;
  }
  index();
  if (node !== cur) show(node, soundOf(node));
}

// ---------- pieces ----------
function squareAt(x, y) {
  const r = $('#board').getBoundingClientRect();
  const cx = Math.floor(((x - r.left) / r.width) * 8);
  const cy = Math.floor(((y - r.top) / r.height) * 8);
  if (cx < 0 || cx > 7 || cy < 0 || cy > 7) return null;
  return flipped ? FILES[7 - cx] + (cy + 1) : FILES[cx] + (8 - cy);
}

function pick(sq) {
  if (engineToMove()) return false;
  const chess = new Chess(cur.fen);
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
    promo = await askPromotion(new Chess(cur.fen).turn(), to);
    if (!promo) { sel = null; targets = []; renderBoard(); return; }
  }
  playMove(from + to + promo);
}

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

// ---------- simulating a game ----------
// Stockfish plays on from the board: both sides, to watch a game unfold, or
// one side against you. Its moves go into the move tree like any other, so
// simulating from the middle of a line makes a variation.
const LEVELS = [
  { skill: 0, movetime: 150 },   // Beginner
  { skill: 3, movetime: 250 },   // Casual
  { skill: 7, movetime: 400 },   // Intermediate
  { skill: 11, movetime: 600 },  // Advanced
  { skill: 15, movetime: 900 },  // Expert
  { skill: 20, movetime: 1500 }, // Maximum
];
// The least time between moves when Stockfish plays both sides (ms), so the game can be followed.
const GAP = { slow: 1600, normal: 800, fast: 150 };
const SIM_KEY = 'shohmot-simulate';
const simSaved = store.get(SIM_KEY) || {};
const sim = {
  open: false,
  running: false,
  started: false, // has run since the panel opened, so Start reads "Resume"
  thinking: false,
  token: 0,       // bumps whenever a pending engine move should be dropped
  players: { w: simSaved.w || 'engine', b: simSaved.b || 'engine' },
  level: Number.isInteger(simSaved.level) ? simSaved.level : 2,
  speed: simSaved.speed || 'normal',
  error: '',
};
let mover = null;

function saveSim() { store.set(SIM_KEY, { w: sim.players.w, b: sim.players.b, level: sim.level, speed: sim.speed }); }
const human = () => sim.players.w === 'you' || sim.players.b === 'you';
const sideToMove = () => cur.fen.split(' ')[1];
// While you play Stockfish, its lines, arrow and eval bar would give the moves away.
function hintsHidden() { return sim.open && human(); }
function engineToMove() { return sim.running && sim.players[sideToMove()] === 'engine'; }

// Moves the simulation on: asks Stockfish for a move when it's its turn.
function simTick() {
  sim.thinking = false;
  if (sim.running && new Chess(cur.fen).isGameOver()) sim.running = false;
  if (!engineToMove()) return renderSim();
  const token = ++sim.token;
  const fen = cur.fen;
  const started = Date.now();
  sim.thinking = true;
  renderSim();
  mover ??= new MoveEngine($('#engine').value);
  mover.pick(fen, LEVELS[sim.level]).then(async (uci) => {
    const gap = human() ? 300 : GAP[sim.speed];
    const left = gap - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    if (token !== sim.token || !sim.running || cur.fen !== fen) return;
    if (!uci || !playMove(uci)) { sim.running = false; sim.thinking = false; renderSim(); }
  }).catch(() => {
    if (token !== sim.token) return;
    if (mover) mover.stop();
    mover = null;
    // The full build comes from unpkg; if that's blocked, the lite one still works.
    if ($('#engine').value === 'full') { $('#engine').value = 'lite'; simTick(); return; }
    sim.running = false;
    sim.thinking = false;
    sim.error = 'Stockfish could not start in this browser.';
    renderSim();
  });
}

function startSim() {
  if (new Chess(cur.fen).isGameOver() || (sim.players.w === 'you' && sim.players.b === 'you')) return;
  // Playing one side: your pieces go at the bottom.
  if (!sim.started && sim.players.w !== sim.players.b) flipped = sim.players.b === 'you';
  sim.running = true;
  sim.started = true;
  sim.error = '';
  sim.token++;
  render();
  follow();
  simTick();
}

function pauseSim() {
  sim.running = false;
  sim.thinking = false;
  sim.token++;
  renderSim();
}

function openSim() {
  sim.open = true;
  sim.started = false;
  sim.error = '';
  render();
  follow();
  $('#sim-go').focus();
}

function closeSim() {
  pauseSim();
  sim.open = false;
  if (mover) mover.stop();
  mover = null;
  render();
  follow();
  $('#sim-open').focus();
}

// Takes back your last move (and Stockfish's reply to it): back to the last
// position where it was your move.
function takeBack() {
  let n = cur.parent;
  while (n && sim.players[n.fen.split(' ')[1]] !== 'you') n = n.parent;
  if (!n) return;
  sim.token++;
  sim.thinking = false;
  show(n, 'move', 'keep');
}

function renderSim() {
  const box = $('#sim');
  box.hidden = !sim.open;
  $('#lines').hidden = sim.open;
  $('#sim-open').hidden = sim.open;
  if (!sim.open) return;
  for (const seg of box.querySelectorAll('.seg')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === sim.players[seg.dataset.side]));
  }
  $('#sim-level').value = String(sim.level);
  $('#sim-speed').value = sim.speed;
  // Speed only matters when Stockfish plays both sides.
  $('#sim-speed-wrap').hidden = human();

  const over = gameOverText(new Chess(cur.fen));
  const side = sideToMove() === 'w' ? 'White' : 'Black';
  const nobody = sim.players.w === 'you' && sim.players.b === 'you';
  let status;
  if (sim.error) status = sim.error;
  else if (over) status = `<b>${over}.</b> Go back a move or two to play it differently.`;
  else if (nobody) status = 'Pick Stockfish for at least one side.';
  else if (sim.running && sim.thinking) status = `<span class="think">Stockfish is thinking for ${side}</span>`;
  else if (sim.running) status = `<b>Your move</b> as ${side}.`;
  else if (sim.started) status = 'Paused. Resume carries on from the position on the board.';
  else if (human()) status = `Play Stockfish from the position on the board. ${side} to move.`;
  else status = `Stockfish plays both sides from the position on the board. ${side} to move.`;
  const el = $('#sim-status');
  el.innerHTML = status;
  el.dataset.state = over ? 'over' : sim.running ? (sim.thinking ? 'thinking' : 'you') : 'idle';

  const go = $('#sim-go');
  go.textContent = sim.running ? 'Pause' : sim.started ? 'Resume' : 'Start';
  go.dataset.state = sim.running ? 'pause' : 'play';
  go.disabled = !sim.running && (!!over || nobody);
  $('#sim-undo').hidden = !human();
  $('#sim-undo').disabled = !cur.parent;
}

// ---------- tools ----------
let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    // No clipboard access: show it in the load box to copy by hand.
    $('#load-text').value = text;
    $('#load-error').hidden = true;
    $('#load-dialog').showModal();
    $('#load-text').select();
  }
}

function fresh(newRoot) {
  stopLive();
  index();
  show(newRoot ?? cur, null);
}

function loadText(text) {
  const t = text.trim();
  if (!t) throw new Error('Paste a PGN or a FEN first.');
  // A FEN is one line of six fields with eight ranks.
  if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}\s+[wb]\b/.test(t)) {
    try { loadFen(t); } catch { throw new Error('That FEN is not a legal position.'); }
    flipped = cur.fen.split(' ')[1] === 'b';
  } else {
    load(t);
    cur = root;
  }
}

let menuFor = null;
function openMenu(node, x, y) {
  const menu = $('#menu');
  menuFor = node;
  menu.querySelector('[data-act="promote"]').hidden = onMainLine(node);
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}
function closeMenu() { $('#menu').hidden = true; menuFor = null; }

// ---------- start ----------
function wire() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu')) closeMenu();
    const t = e.target.closest('[data-id],[data-go],[data-line]');
    if (!t) return;
    if (t.dataset.id) {
      const node = byId.get(Number(t.dataset.id));
      if (node && node !== cur) show(node, soundOf(node));
      return;
    }
    if (t.dataset.line) return playLine(Number(t.dataset.line), Number(t.dataset.n));
    const g = t.dataset.go;
    if (g === 'start') return cur !== root && show(root, 'move');
    if (g === 'end') { const end = lineEnd(cur); return end !== cur && show(end, soundOf(end)); }
    step(g === 'next' ? 1 : -1);
  });
  $('#tree').addEventListener('contextmenu', (e) => {
    const t = e.target.closest('[data-id]');
    if (!t) return;
    e.preventDefault();
    openMenu(byId.get(Number(t.dataset.id)), e.clientX, e.clientY);
  });
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !menuFor) return;
    const node = menuFor;
    closeMenu();
    if (b.dataset.act === 'promote') { promote(node); show(cur, null); }
    else {
      // Deleting the line the board is on moves the board back to where it branched.
      const onIt = pathTo(cur).includes(node);
      const back = cut(node);
      index();
      show(onIt ? back : cur, null);
    }
  });

  $('#sim-open').addEventListener('click', openSim);
  $('#sim-close').addEventListener('click', closeSim);
  $('#sim-go').addEventListener('click', () => (sim.running ? pauseSim() : startSim()));
  $('#sim-undo').addEventListener('click', takeBack);
  $('#sim').addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    sim.players[b.closest('.seg').dataset.side] = b.dataset.v;
    saveSim();
    sim.token++;
    render();
    follow();
    simTick();
  });
  $('#sim-level').addEventListener('change', () => { sim.level = Number($('#sim-level').value); saveSim(); });
  $('#sim-speed').addEventListener('change', () => { sim.speed = $('#sim-speed').value; saveSim(); });

  $('#live-toggle').addEventListener('click', () => {
    engineOn = !engineOn;
    store.set('shohmot-review-live', engineOn);
    if (engineOn) follow(); else stopLive();
    render();
  });
  $('#engine').addEventListener('change', () => {
    store.set('shohmot-review-engine', $('#engine').value);
    stopLive();
    if (mover) mover.stop();
    mover = null;
    sim.token++;
    if (sim.running) simTick();
    render();
    follow();
  });
  const sound = $('#sound');
  const showSound = () => { sound.setAttribute('aria-pressed', String(!isMuted())); sound.title = isMuted() ? 'Sound off (M)' : 'Sound on (M)'; };
  sound.addEventListener('click', () => { setMuted(!isMuted()); showSound(); if (!isMuted()) playSound('move'); });
  showSound();
  $('#flip').addEventListener('click', () => { flipped = !flipped; render(); save(); });

  $('#new').addEventListener('click', () => {
    if (root.children.length && !confirm('Clear this analysis and start again from the starting position?')) return;
    root = newTree();
    headers = {};
    flipped = false;
    fresh(root);
  });
  $('#load').addEventListener('click', () => {
    $('#load-text').value = '';
    $('#load-error').hidden = true;
    $('#load-dialog').showModal();
  });
  $('#load-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value !== 'load') return;
    try {
      loadText($('#load-text').value);
    } catch (err) {
      e.preventDefault();
      $('#load-error').textContent = err.message;
      $('#load-error').hidden = false;
      return;
    }
    fresh(cur);
  });
  $('#copy-pgn').addEventListener('click', () => copy(toPgn(root, headers), 'PGN'));
  $('#copy-fen').addEventListener('click', () => copy(cur.fen, 'FEN'));

  input = boardInput($('#board'), {
    squareAt,
    selected: () => sel,
    pick,
    isTarget: (sq) => targets.some((t) => t.to === sq),
    move: (from, to) => { dropOn(from, to); },
    clear: () => { if (sel) { sel = null; targets = []; renderBoard(); } },
    redraw: () => renderBoard(),
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space on a focused button already presses it.
    if (e.key === ' ' && e.target.closest('button')) return;
    const keys = {
      ArrowLeft: () => step(-1), ArrowRight: () => step(1),
      ArrowUp: () => cur !== root && show(root, 'move'),
      ArrowDown: () => { const end = lineEnd(cur); if (end !== cur) show(end, soundOf(end)); },
      Home: () => cur !== root && show(root, 'move'),
      End: () => { const end = lineEnd(cur); if (end !== cur) show(end, soundOf(end)); },
      f: () => $('#flip').click(), m: () => $('#sound').click(),
      ' ': () => { if (sim.open && !$('#sim-go').disabled) $('#sim-go').click(); },
      Escape: () => { closeMenu(); sel = null; targets = []; renderBoard(); },
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });
}

function restore() {
  // A game handed over from the review page wins over the saved analysis.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('pgn')) {
    try {
      load(hash.get('pgn'));
      let n = root;
      for (let k = Number(hash.get('ply')) || 0; k > 0 && n.children[0]; k--) n = n.children[0];
      cur = n;
      flipped = hash.get('flip') === '1';
      history.replaceState(null, '', location.pathname);
      return;
    } catch { /* fall through to the saved analysis */ }
  }
  const saved = store.get(SAVE_KEY);
  if (saved && saved.pgn) {
    try {
      load(saved.pgn, saved.at);
      flipped = !!saved.flipped;
      return;
    } catch { /* start fresh */ }
  }
  root = newTree();
  cur = root;
}

async function main() {
  const savedEngine = store.get('shohmot-review-engine');
  const phone = matchMedia('(max-width: 43.75em)').matches || (navigator.connection && navigator.connection.saveData);
  $('#engine').value = savedEngine || (phone ? 'lite' : 'full');
  wire();
  restore();
  index();
  render();
  follow();
  save();
  try {
    openings = await fetch('/openings.json').then((r) => r.json());
    renderOpening();
  } catch { /* no opening names */ }
}

main();
