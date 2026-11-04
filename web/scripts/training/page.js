// The Training page: one position at a time from your own mistakes. Find the
// better move (the engine's choice, or one nearly as good) on the first try
// and the position comes back later on a growing schedule; miss it and it
// comes back soon. Free accounts train FREE_PER_DAY positions a day.
import { Chess } from 'chess.js';
import { boardInput } from '../review/board-input.mjs';
import { play, soundOf } from '../review/sound.mjs';
import { LABELS } from '../review/analysis.mjs';
import { KINDS } from '../review/label.mjs';
import { currentUser, freshUser, features, unlocked } from '../session.js';
import { track } from '../track.js';
import { queue, record, stats, doneToday, LEARNED } from './store.mjs';
import { analyzeMany } from './analyze.mjs';

export const FREE_PER_DAY = 5;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILES = 'abcdefgh';
const DAY = 86400000;
const SITE = { chesscom: 'Chess.com', lichess: 'Lichess' };
const PHASES = ['Opening', 'Middlegame', 'Endgame'];
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

let me = null;
let list = [];
let at = 0;
let item = null;
let chess = null;
let flipped = false;
let sel = null;
let targets = [];
let tries = 0;
let state = 'ask'; // ask | right | wrong | shown | done
let arrow = null;  // { uci, cls }
let last = null;   // { from, to } of the move on the board
const focusGame = new URLSearchParams(location.search).get('game');

const isPro = (u) => unlocked(u);
const limited = () => !isPro(me) && doneToday() >= FREE_PER_DAY;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- board ----------
function squareXY(sq) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
}
function arrowPath(uci, cls) {
  const a = squareXY(uci.slice(0, 2)), b = squareXY(uci.slice(2, 4));
  const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = b.x + 0.5, y2 = b.y + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, px = -uy, py = ux;
  const ex = x2 - ux * 0.42, ey = y2 - uy * 0.42, w = 0.09, hw = 0.24;
  const pts = [[x1 + px * w, y1 + py * w], [ex + px * w, ey + py * w], [ex + px * hw, ey + py * hw], [x2, y2], [ex - px * hw, ey - py * hw], [ex - px * w, ey - py * w], [x1 - px * w, y1 - py * w]];
  return `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true"><polygon class="${cls}" points="${pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ')}"/></svg>`;
}

function renderBoard() {
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
      const piece = p ? `<i class="pc" style="background-image:url(pieces/${p.color}${p.type.toUpperCase()}.svg)"></i>` : '';
      const cf = y === 7 ? `<b class="cf">${FILES[f]}</b>` : '';
      const cr = x === 0 ? `<b class="cr">${r + 1}</b>` : '';
      const hint = to.has(sq) ? `<span class="${p ? 'hint cap' : 'hint'}"></span>` : '';
      cells.push(`<div class="${cls.join(' ')}" data-sq="${sq}"${last && sq === last.to && last.l ? ` data-l="${last.l}"` : ''}>${piece}${cf}${cr}${hint}</div>`);
    }
  }
  $('#board').innerHTML = cells.join('') + (arrow ? arrowPath(arrow.uci, arrow.cls) : '');
}

function squareAt(x, y) {
  const r = $('#board').getBoundingClientRect();
  if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
  const cx = Math.floor(((x - r.left) / r.width) * 8), cy = Math.floor(((y - r.top) / r.height) * 8);
  const f = flipped ? 7 - cx : cx, rk = flipped ? cy : 7 - cy;
  return FILES[f] + (rk + 1);
}

const input = boardInput($('#board'), {
  squareAt,
  selected: () => sel,
  pick(sq) {
    if (state !== 'ask' && state !== 'wrong') return false;
    const p = chess.get(sq);
    if (!p || p.color !== chess.turn()) return false;
    sel = sq;
    targets = chess.moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured, promotion: m.promotion }));
    renderBoard();
    return true;
  },
  isTarget: (sq) => targets.some((t) => t.to === sq),
  move: (from, to) => attempt(from, to),
  clear() { sel = null; targets = []; renderBoard(); },
  redraw: renderBoard,
});

// ---------- one position ----------
const moveNo = (ply) => `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
const side = () => (chess.turn() === 'w' ? 'White' : 'Black');

function show(i) {
  at = i;
  item = list[i] || null;
  tries = 0;
  sel = null;
  targets = [];
  arrow = null;
  last = null;
  $('#tr-feedback').innerHTML = '';
  if (!item) return renderEmpty();
  if (limited()) return renderLimit();
  $('#tr-main').hidden = false;
  chess = new Chess(item.fen);
  flipped = chess.turn() === 'b';
  state = 'ask';
  $('#tr-count').textContent = `Position ${i + 1} of ${list.length}${focusGame && item.key.startsWith(`${focusGame}:`) ? ' · from the game you just played' : ''}`;
  $('#tr-prompt').textContent = `Find the better move for ${side()}.`;
  $('#tr-context').innerHTML = `In your game vs <b>${esc(item.opponent || 'your opponent')}</b>${item.speed ? ` (${esc(item.speed)})` : ''} on ${esc(dateFmt.format(item.end))}, you played <b class="nw-move" data-l="${item.label}">${moveNo(item.ply)} ${esc(item.san)}${LABELS[item.label].mark}</b> here. ${esc(item.why)}`;
  $('#tr-top').innerHTML = `<span class="pl-dot ${flipped ? 'w' : 'b'}"></span>${esc(flipped ? 'White' : 'Black')}`;
  $('#tr-bottom').innerHTML = `<span class="pl-dot ${flipped ? 'b' : 'w'}"></span>You (${side()} to move)`;
  const qs = new URLSearchParams({ p: item.platform, u: item.username || '', id: item.id, t: String(item.end), ply: String(item.ply) });
  $('#tr-review').href = `/review.html?${qs}`;
  $('#tr-review').hidden = true;
  $('#tr-next').hidden = true;
  $('#tr-show').hidden = false;
  $('#tr-hint').hidden = false;
  renderBoard();
}

function finish(solved, html) {
  state = solved ? 'right' : 'shown';
  record(item.key, solved);
  track(solved ? 'puzzle_solved' : 'puzzle_failed');
  $('#tr-feedback').innerHTML = html;
  $('#tr-show').hidden = true;
  $('#tr-hint').hidden = true;
  $('#tr-next').hidden = false;
  $('#tr-review').hidden = false;
  renderStats();
  renderWork();
  $('#tr-next').focus();
}

async function attempt(from, to) {
  sel = null;
  targets = [];
  const probe = new Chess(chess.fen());
  let m;
  try { m = probe.move({ from, to, promotion: 'q' }); } catch { renderBoard(); return; }
  const uci = m.from + m.to + (m.promotion || '');
  const good = uci === item.best || (item.alts || []).includes(uci);
  play(soundOf(m));
  if (good) {
    chess = probe;
    last = { from: m.from, to: m.to, l: 'best' };
    const first = tries === 0;
    const other = uci !== item.best ? ` Stockfish’s first choice was ${esc(item.bestSan)}, but this is nearly as good.` : '';
    const line = item.line ? ` <span class="muted">The line goes on ${esc(item.line)}.</span>` : '';
    const next = first ? (item.box + 1 >= LEARNED ? 'Learned: it won’t come back.' : `It comes back in ${['', 'a day', '3 days', 'a week', '3 weeks'][Math.min(4, item.box + 1)]}.`) : 'Right on the second try: it comes back soon for another go.';
    renderBoard();
    finish(first, `<p class="tr-ok"><b>${first ? 'Correct!' : 'That’s it.'}</b> ${esc(m.san)} is the move.${other}${line}</p><p class="muted small">${esc(next)}</p>`);
    return;
  }
  tries++;
  const same = uci === item.played;
  last = null;
  renderBoard();
  if (tries >= 2) {
    arrow = { uci: item.best, cls: '' };
    renderBoard();
    finish(false, `<p class="tr-bad"><b>Not quite.</b> The move was <b>${esc(item.bestSan)}</b> (the green arrow).${item.line ? ` <span class="muted">Then ${esc(item.line)}.</span>` : ''}</p><p class="muted small">It comes back in a few minutes for another go.</p>`);
    return;
  }
  state = 'wrong';
  $('#tr-feedback').innerHTML = `<p class="tr-bad"><b>${same ? 'That’s the move you played in the game.' : `${esc(m.san)} isn’t it.`}</b> One more try.</p>`;
}

function hint() {
  if (!item || !chess) return;
  const from = item.best.slice(0, 2);
  const p = chess.get(from);
  sel = from;
  targets = [];
  renderBoard();
  $('#tr-feedback').innerHTML = `<p class="muted">Hint: it’s a ${({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[p.type]} move.</p>`;
  tries = Math.max(tries, 1); // a hinted solve doesn't count as first try
}

function reveal() {
  arrow = { uci: item.best, cls: '' };
  renderBoard();
  finish(false, `<p class="tr-bad"><b>The move was ${esc(item.bestSan)}</b> (the green arrow).${item.line ? ` <span class="muted">Then ${esc(item.line)}.</span>` : ''}</p><p class="muted small">It comes back in a few minutes for another go.</p>`);
}

function renderEmpty() {
  $('#tr-main').hidden = false;
  chess = new Chess();
  flipped = false;
  renderBoard();
  $('#tr-count').textContent = '';
  const s = stats();
  $('#tr-prompt').textContent = s.total ? 'Nothing due right now.' : 'No positions yet.';
  $('#tr-context').textContent = s.total
    ? `You’ve trained everything that’s due. ${s.learned} learned so far. Play some games: the counter checks each one and adds your mistakes here.`
    : 'Play a game with the counter open: Shohmot checks it and adds every mistake you made here. Or check your older losses below.';
  for (const id of ['#tr-show', '#tr-hint', '#tr-next', '#tr-review']) $(id).hidden = true;
}

function renderLimit() {
  $('#tr-main').hidden = false;
  $('#tr-count').textContent = '';
  $('#tr-prompt').textContent = `That’s your ${FREE_PER_DAY} positions for today.`;
  $('#tr-context').innerHTML = `Free accounts train ${FREE_PER_DAY} positions a day. ${features().billing ? '<a href="/pricing.html">Pro</a> has no limit, and checks all your older games too.' : 'Come back tomorrow for more.'}`;
  for (const id of ['#tr-show', '#tr-hint', '#tr-next', '#tr-review']) $(id).hidden = true;
}

// ---------- stats ----------
function renderStats() {
  const s = stats();
  $('#tr-stats').innerHTML = `<div><dt>To train</dt><dd>${s.due}</dd></div><div><dt>Learned</dt><dd>${s.learned}</dd></div><div><dt>Games checked</dt><dd>${s.games}</dd></div>`;
}

function bars(title, entries) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return `<div class="tr-bars"><h3>${title}</h3>${entries.map(([name, n]) => `<p><span>${esc(name)}</span><i style="--w:${(n / max) * 100}%"></i><b>${n}</b></p>`).join('')}</div>`;
}

function renderWork() {
  const s = stats();
  if (!s.total) { $('#tr-work').innerHTML = '<p class="muted">Once a few games are checked, this shows the kinds of mistakes you make most.</p>'; return; }
  const kinds = Object.entries(KINDS).map(([k, name]) => [name, s.kinds[k] || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const phases = PHASES.map((name, i) => [name, s.phases[i] || 0]);
  const top = kinds[0];
  const tip = {
    'Left a piece hanging': 'Before every move, check what your opponent can take. Most hung pieces are lost to a simple capture.',
    'Allowed a mate': 'Look at your king before you move: which checks does your opponent have after it?',
    'Missed a mate': 'When their king is short of squares, look at every check first.',
    'Lost material': 'Count attackers and defenders before you start a trade.',
    'Missed a chance': 'After your opponent’s move, ask what it left undefended.',
    'Let the position slip': 'These are slower mistakes: compare a couple of candidate moves before you play.',
  }[top[0]];
  $('#tr-work').innerHTML = `<p class="tr-tip"><b>Most often: ${esc(top[0].toLowerCase())}</b> (${top[1]} of ${s.total}). ${esc(tip)}</p><div class="tr-work-grid">${bars('By kind', kinds)}${bars('By phase', phases)}</div>`;
}

// ---------- older games ----------
let oldJob = null;
$('#tr-old-go').addEventListener('click', () => {
  if (oldJob) { oldJob.stop(); oldJob = null; $('#tr-old-go').textContent = 'Check my losses'; return; }
  const accounts = (me && me.accounts) || [];
  if (!accounts.length) { toast('Add a chess account on the counter first.'); return; }
  const days = isPro(me) ? 26 * 7 : 7;
  $('#tr-old-go').textContent = 'Pause';
  $('#tr-old-bar-wrap').hidden = false;
  let added = 0;
  oldJob = analyzeMany({
    accounts,
    since: Date.now() - days * DAY,
    pick: (g) => g.result === 'loss',
    onGame: (_, __, out) => { added += out.items.length; list = queue({ game: focusGame }); renderStats(); renderWork(); if (!item) show(0); },
    onProgress: (p) => {
      $('#tr-old-bar').style.width = `${p.total ? (p.done / p.total) * 100 : 2}%`;
      $('#tr-old-status').textContent = `${p.done} of ${p.total} losses checked · ${added} new positions${p.note && p.note !== 'Done.' ? ` · ${p.note}` : ''}`;
    },
    onDone: (p) => {
      oldJob = null;
      $('#tr-old-go').textContent = p.stopped ? 'Resume' : 'Check again';
      if (!p.stopped) $('#tr-old-status').textContent = `Done: ${p.done} losses checked from the last ${isPro(me) ? '26 weeks' : '7 days'}, ${added} new positions.${isPro(me) || !features().billing ? '' : ' Pro goes back 26 weeks.'}`;
    },
  });
});
addEventListener('pagehide', () => { if (oldJob) oldJob.stop(); });

// ---------- start ----------
$('#tr-next').addEventListener('click', () => {
  list = queue({ game: focusGame });
  // The one just done is no longer due, so the next due one is now first.
  show(0);
});
$('#tr-show').addEventListener('click', reveal);
$('#tr-hint').addEventListener('click', hint);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'Enter' && !$('#tr-next').hidden) $('#tr-next').click();
  if (e.key === 'Escape') { sel = null; targets = []; renderBoard(); }
});

function setUser(u) {
  me = u;
  $('#banners').innerHTML = isPro(me) || !features().billing ? '' : `<div class="banner" data-kind="info"><p><b>Free: ${FREE_PER_DAY} positions a day</b>, and older games from the last 7 days. Pro trains without a limit and checks 26 weeks of games.</p>${features().billing ? '<div class="banner-actions"><a class="btn btn-solid" href="/pricing.html">See Pro</a></div>' : ''}</div>`;
}

currentUser().then(async (u) => {
  if (u) setUser(u);
  list = queue({ game: focusGame });
  renderStats();
  renderWork();
  show(0);
  const fresh = await freshUser();
  if (fresh) { setUser(fresh); if (limited() !== !item) show(at); }
});
void input;
