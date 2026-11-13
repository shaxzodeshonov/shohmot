// The Opening training page. Pick an opening (a family of named lines such as
// the Sicilian Defense) and a side; the trainer takes you through every
// variation in it. The other side's moves are played for you and you play yours
// from memory. A line you haven't seen is shown first, with an arrow on each of
// your moves; after that it's a drill, and a line played right the first time
// comes back on a growing schedule, while a slip brings it back in minutes.
import { Chess } from 'chess.js';
import { boardInput } from '../review/board-input.mjs';
import { play, soundOf } from '../review/sound.mjs';
import { freshUser } from '../session.js';
import { track } from '../track.js';
import { drawBoard, squareAtPoint } from './board.mjs';
import { get, record, totals } from './openings-store.mjs';
import { parseLines, families, bookIndex, bookMove, isOwn, playable, status, order, progress } from './openings.mjs';
import { startTimer } from './timer.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIDE = { w: 'White', b: 'Black' };
const LATER = ['', 'a day', '3 days', 'a week', '3 weeks'];
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const STATUS = { new: 'New', due: 'Due', learning: 'Learning', learned: 'Learned' };

let lines = [];
let fams = [];
let book = new Map();
let color = 'w';
let fam = null;        // { name, lines } being trained
let queue = [];        // the lines still to come in this session
let session = { at: 0, total: 0 };
let line = null;
let mode = 'drill';    // study (arrows, no marks) | drill (from memory)
let phase = 'idle';    // idle | opponent | ask | reveal | done
let chess = new Chess();
let flipped = false;
let i = 0;             // the next ply to play
let clean = true;      // no hint, second try or reveal so far in this line
let tries = 0;         // wrong tries on this move
let sel = null;
let targets = [];
let arrow = null;
let last = null;
let gen = 0;           // bumps when a line is left, so a waiting opponent move is dropped

try { color = localStorage.getItem('shohmot-openings:side') === 'b' ? 'b' : 'w'; } catch { /* private mode */ }

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- board ----------
const renderBoard = () => drawBoard($('#board'), { chess, flipped, last, sel, targets, arrow });
const legalFrom = (sq) => chess.moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured }));
const uciOf = (san) => { const m = chess.moves({ verbose: true }).find((x) => x.san === san); return m ? m.from + m.to + (m.promotion || '') : null; };

boardInput($('#board'), {
  squareAt: (x, y) => squareAtPoint($('#board'), x, y, flipped),
  selected: () => sel,
  pick(sq) {
    if (phase !== 'ask') return false;
    const p = chess.get(sq);
    if (!p || p.color !== chess.turn()) return false;
    sel = sq;
    targets = legalFrom(sq);
    renderBoard();
    return true;
  },
  isTarget: (sq) => targets.some((t) => t.to === sq),
  move: (from, to) => attempt(from, to),
  clear() { sel = null; targets = []; renderBoard(); },
  redraw: renderBoard,
});

// ---------- the line on screen ----------
function renderMoves() {
  const out = [];
  for (let k = 0; k < line.moves.length; k++) {
    if (k % 2 === 0) out.push(`<span class="no">${k / 2 + 1}.</span>`);
    const shown = mode === 'study' || phase === 'done' || k < i;
    const cls = `mv${k < i ? ' played' : ''}${k === i && phase !== 'done' ? ' now' : ''}${isOwn(k, color) ? ' own' : ''}`;
    out.push(shown ? `<span class="${cls}">${esc(line.moves[k])}</span>` : `<span class="${cls}" role="img" aria-label="move to find">···</span>`);
  }
  $('#op-moves').innerHTML = out.join(' ');
}

function renderPanel() {
  const side = SIDE[color];
  const prompt = {
    opponent: `${SIDE[color === 'w' ? 'b' : 'w']} plays…`,
    ask: mode === 'study' ? `Your move: follow the arrow.` : `Your move, ${side}.`,
    reveal: 'Here’s the move.',
    done: mode === 'study' ? 'That’s the line.' : clean ? 'Line complete!' : 'Done, with a few slips.',
  }[phase];
  $('#op-prompt').textContent = prompt;
  $('#op-count').textContent = `${fam.name} · line ${session.at} of ${session.total} · ${mode === 'study' ? 'new: study it first' : 'from memory'}`;
  $('#op-name').innerHTML = `<b>${esc(line.name)}</b> <span class="muted">${esc(line.eco)} · ${Math.ceil(line.moves.length / 2)} move${line.moves.length > 2 ? 's' : ''}</span>`;
  $('#op-top').innerHTML = `<span class="pl-dot ${flipped ? 'w' : 'b'}"></span>${flipped ? 'White' : 'Black'}`;
  $('#op-bottom').innerHTML = `<span class="pl-dot ${flipped ? 'b' : 'w'}"></span>You (${side})`;
  const asking = phase === 'ask' || phase === 'opponent';
  $('#op-hint').hidden = !(asking && mode === 'drill');
  $('#op-show').hidden = !(asking && mode === 'drill');
  $('#op-hint').disabled = $('#op-show').disabled = phase !== 'ask';
  $('#op-study').hidden = !(asking && mode === 'drill');
  const done = phase === 'done';
  $('#op-again').hidden = !(done && mode === 'study');
  $('#op-retry').hidden = !(done && mode === 'drill');
  $('#op-next').hidden = !(done && queue.length > 0);
  renderMoves();
}

// ---------- playing a line ----------
function step() {
  let m;
  try { m = chess.move(line.moves[i]); } catch { m = null; }
  if (!m) { toast('That line has a move this board can’t play. Skipping it.'); gen++; phase = 'done'; return false; }
  last = { from: m.from, to: m.to };
  play(soundOf(m));
  i++;
  arrow = null;
  return true;
}

// Plays the other side's moves until it's your turn, or the line is over.
async function run(g) {
  phase = 'opponent';
  renderPanel();
  while (i < line.moves.length && !isOwn(i, color)) {
    await sleep(i === 0 ? 500 : 420);
    if (g !== gen) return;
    if (!step()) { renderBoard(); renderPanel(); return; }
    renderBoard();
    renderMoves();
  }
  if (g !== gen) return;
  if (i >= line.moves.length) { complete(); return; }
  phase = 'ask';
  if (mode === 'study') arrow = { uci: uciOf(line.moves[i]), cls: '' };
  renderBoard();
  renderPanel();
}

function attempt(from, to) {
  sel = null;
  targets = [];
  if (phase !== 'ask') { renderBoard(); return; }
  const probe = new Chess(chess.fen());
  let m;
  try { m = probe.move({ from, to, promotion: 'q' }); } catch { renderBoard(); return; }
  if (m.san === line.moves[i]) {
    chess = probe;
    last = { from: m.from, to: m.to };
    play(soundOf(m));
    i++;
    tries = 0;
    arrow = null;
    $('#op-feedback').innerHTML = '';
    renderBoard();
    run(gen);
    return;
  }
  renderBoard();
  if (mode === 'study') {
    $('#op-feedback').innerHTML = `<p class="tr-bad"><b>${esc(m.san)} isn’t the move in this line.</b> Follow the arrow.</p>`;
    return;
  }
  clean = false;
  tries++;
  const other = bookMove(book, line, i, m.san);
  const msg = other ? `<b>${esc(m.san)} is a real book move</b>, but ${other.split(':')[0] === line.family ? `it’s another ${esc(line.family)} variation` : `it belongs to the ${esc(other.split(':')[0])}`}, not this line.` : `<b>${esc(m.san)} isn’t it.</b>`;
  if (tries >= 2) { reveal(msg); return; }
  $('#op-feedback').innerHTML = `<p class="tr-bad">${msg} One more try.</p>`;
  renderMoves();
}

async function reveal(msg = '') {
  if (phase !== 'ask') return;
  const g = gen;
  clean = false;
  phase = 'reveal';
  arrow = { uci: uciOf(line.moves[i]), cls: '' };
  $('#op-feedback').innerHTML = `<p class="tr-bad">${msg} <b>The line plays ${esc(line.moves[i])}</b> (the green arrow).</p>`;
  renderBoard();
  renderPanel();
  await sleep(1200);
  if (g !== gen) return;
  tries = 0;
  if (step()) { renderBoard(); run(g); } else { renderBoard(); renderPanel(); }
}

function hint() {
  if (phase !== 'ask' || mode !== 'drill') return;
  const uci = uciOf(line.moves[i]);
  const from = uci.slice(0, 2);
  clean = false;
  sel = from;
  targets = legalFrom(from);
  renderBoard();
  $('#op-feedback').innerHTML = `<p class="muted">Hint: it’s a ${PIECE[chess.get(from).type]} move.</p>`;
}

function complete() {
  phase = 'done';
  arrow = null;
  const fb = $('#op-feedback');
  if (mode === 'study') {
    fb.innerHTML = '<p class="tr-ok"><b>That’s the whole line.</b> Now play your side of it from memory.</p>';
  } else {
    const e = record(color, line.id, clean);
    track(clean ? 'opening_solved' : 'opening_failed');
    const when = e.box >= 5 ? 'Learned: it won’t come back.' : `It comes back in ${LATER[Math.min(4, e.box)]}.`;
    fb.innerHTML = clean
      ? `<p class="tr-ok"><b>Not a single slip.</b> ${esc(when)}</p>`
      : '<p class="tr-bad"><b>A few slips.</b> The line is above: it comes back in a few minutes for another go.</p>';
    if (!queue.length) fb.insertAdjacentHTML('beforeend', '<p class="muted small">That was the last line in this set.</p>');
    renderStats();
    renderPicker();
    renderVariations();
  }
  renderBoard();
  renderPanel();
  const btn = [$('#op-again'), $('#op-next'), $('#op-retry')].find((b) => !b.hidden);
  if (btn) btn.focus();
}

function startLine(l, forced) {
  gen++;
  line = l;
  mode = forced || (get(color, l.id) ? 'drill' : 'study');
  chess = new Chess();
  flipped = color === 'b';
  i = 0;
  clean = true;
  tries = 0;
  sel = null;
  targets = [];
  arrow = null;
  last = null;
  $('#op-feedback').innerHTML = '';
  $('#op-pick').hidden = true;
  $('#op-drill').hidden = false;
  renderBoard();
  renderVariations();
  run(gen);
}

function startFamily(f, only = null) {
  fam = f;
  queue = order(f.lines, color, get);
  if (only) queue = [only, ...queue.filter((l) => l !== only)];
  const next = queue.shift();
  session = { at: 1, total: next ? queue.length + 1 : 0 };
  const url = new URL(location.href);
  url.searchParams.set('family', f.name);
  url.searchParams.set('side', color);
  history.replaceState(null, '', url);
  $('#op-vars-sec').hidden = !f.lines.length;
  renderVariations();
  if (next) { startLine(next); if (matchMedia('(max-width: 50rem)').matches) $('#op-main').scrollIntoView({ block: 'start' }); return; }
  caughtUp();
}

function caughtUp() {
  gen++;
  line = null;
  phase = 'idle';
  chess = new Chess();
  flipped = color === 'b';
  last = arrow = sel = null;
  targets = [];
  renderBoard();
  $('#op-pick').hidden = true;
  $('#op-drill').hidden = false;
  $('#op-count').textContent = fam.name;
  $('#op-prompt').textContent = 'You’re caught up.';
  $('#op-name').innerHTML = `Every ${esc(fam.name)} line you can play as ${SIDE[color]} is learned or scheduled for later. Pick any variation below to practise it anyway.`;
  $('#op-moves').innerHTML = '';
  $('#op-feedback').innerHTML = '';
  for (const id of ['#op-hint', '#op-show', '#op-again', '#op-next', '#op-retry', '#op-study']) $(id).hidden = true;
  $('#op-top').innerHTML = '';
  $('#op-bottom').innerHTML = '';
}

function next() {
  const l = queue.shift();
  if (!l) return;
  session.at++;
  startLine(l);
}

function leave() {
  gen++;
  fam = line = null;
  phase = 'idle';
  queue = [];
  chess = new Chess();
  flipped = false;
  last = arrow = sel = null;
  targets = [];
  renderBoard();
  $('#op-top').innerHTML = '';
  $('#op-bottom').innerHTML = '';
  $('#op-drill').hidden = true;
  $('#op-pick').hidden = false;
  $('#op-vars-sec').hidden = true;
  const url = new URL(location.href);
  url.searchParams.delete('family');
  url.searchParams.delete('side');
  history.replaceState(null, '', url);
  renderPicker();
}

// ---------- the lists ----------
function renderStats() {
  const t = totals();
  $('#op-stats').innerHTML = `<div><dt>Due</dt><dd>${t.due}</dd></div><div><dt>Learned</dt><dd>${t.learned}</dd></div><div><dt>Lines tried</dt><dd>${t.tried}</dd></div>`;
}

function renderPicker() {
  if (!fams.length) return;
  const q = $('#op-q').value.trim().toLowerCase();
  const dueLines = lines.filter((l) => playable(l, color) && status(get(color, l.id)) === 'due');
  const due = $('#op-due');
  due.hidden = !dueLines.length;
  if (dueLines.length) due.innerHTML = `<button class="btn btn-solid" type="button" id="op-due-go">Review ${dueLines.length} due line${dueLines.length === 1 ? '' : 's'}</button>`;
  const rows = [];
  for (const f of fams) {
    if (q && !f.name.toLowerCase().includes(q) && !f.lines.some((l) => l.eco.toLowerCase() === q || l.name.toLowerCase().includes(q))) continue;
    const p = progress(f.lines, color, get);
    if (!p.total) continue;
    const pct = (p.learned / p.total) * 100;
    rows.push(`<li><button type="button" class="op-fam" data-fam="${esc(f.name)}">
      <span class="op-fam-n">${esc(f.name)}</span>
      <span class="op-fam-c">${p.due ? `<b>${p.due} due</b> · ` : ''}${p.learned} / ${p.total} learned</span>
      <span class="op-fam-bar" aria-hidden="true"><i style="--w:${pct.toFixed(1)}%"></i></span>
    </button></li>`);
  }
  $('#op-fams').innerHTML = rows.join('') || '<li class="muted op-none">No opening matches that.</li>';
}

function renderVariations() {
  if (!fam) return;
  const rows = fam.lines.filter((l) => playable(l, color)).map((l) => {
    const s = status(get(color, l.id));
    const label = l.variation || l.name;
    return `<li><button type="button" class="op-var" data-id="${l.id}"${l === line ? ' aria-current="true"' : ''}>
      <span class="op-var-n">${esc(label)}</span>
      <span class="op-var-s" data-s="${s}">${STATUS[s]}</span>
    </button></li>`;
  });
  $('#op-vars-h').textContent = `Every ${fam.name} line`;
  $('#op-vars-sub').textContent = `${rows.length} lines you play as ${SIDE[color]}, shortest first. Pick one to train it now.`;
  $('#op-vars').innerHTML = rows.join('');
}

// ---------- events ----------
$('#op-fams').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fam]');
  if (!b) return;
  const f = fams.find((x) => x.name === b.dataset.fam);
  if (f) startFamily(f);
});
$('#op-vars').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  const l = fam.lines.find((x) => x.id === b.dataset.id);
  if (!l) return;
  startFamily(fam, l);
});
$('#op-due').addEventListener('click', (e) => {
  if (!e.target.closest('#op-due-go')) return;
  // Everything due, across every opening, oldest first.
  const dueLines = order(lines, color, get).filter((l) => status(get(color, l.id)) === 'due');
  if (!dueLines.length) return;
  fam = { name: 'Due lines', lines: dueLines };
  queue = dueLines.slice(1);
  session = { at: 1, total: dueLines.length };
  $('#op-vars-sec').hidden = true;
  startLine(dueLines[0]);
});
$('#op-q').addEventListener('input', renderPicker);
$('#op-back').addEventListener('click', leave);
$('#op-next').addEventListener('click', next);
$('#op-hint').addEventListener('click', hint);
$('#op-show').addEventListener('click', () => reveal());
$('#op-again').addEventListener('click', () => startLine(line, 'drill'));
$('#op-retry').addEventListener('click', () => startLine(line, 'drill'));
$('#op-study').addEventListener('click', () => startLine(line, 'study'));
for (const b of document.querySelectorAll('[data-color]')) {
  b.addEventListener('click', () => {
    if (b.dataset.color === color) return;
    color = b.dataset.color;
    try { localStorage.setItem('shohmot-openings:side', color); } catch { /* private mode */ }
    syncSide();
    if (fam) leave(); else renderPicker();
  });
}
function syncSide() {
  for (const b of document.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, button')) return;
  if (e.key === 'Enter') { for (const id of ['#op-next', '#op-again', '#op-retry']) { const b = $(id); if (b && !b.hidden) { b.click(); break; } } }
  if (e.key === 'Escape') { sel = null; targets = []; renderBoard(); }
});
addEventListener('pagehide', () => { gen++; });

// ---------- start ----------
async function start() {
  syncSide();
  renderStats();
  renderBoard();
  try {
    lines = parseLines(await fetch('/opening-lines.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
  } catch {
    $('#op-pick-p').textContent = 'The opening list didn’t load. Check your connection and reload the page.';
    $('#op-q').disabled = true;
    return;
  }
  fams = families(lines);
  book = bookIndex(lines);
  renderPicker();
  const want = new URLSearchParams(location.search);
  if (want.get('side') === 'b' || want.get('side') === 'w') { color = want.get('side'); syncSide(); renderPicker(); }
  const f = fams.find((x) => x.name === want.get('family'));
  if (f) startFamily(f);
}

freshUser(); // signs you out of this page if the session is gone
start();

// Time on the openings counts toward the day's focus time (shown on Training).
startTimer();
