// The play-yourself page: build a double from someone's public games, show
// their style, and play a game against it.
import { Chess } from 'chess.js';
import { boardInput } from '../review/board-input.mjs';
import { play as sound, soundOf } from '../review/sound.mjs';
import { LinesEngine } from '../review/engine.mjs';
import { fetchWindow, windows, loadBook } from '../brilliants/scan.mjs';
import { currentUser, signedIn } from '../session.js';
import { track } from '../track.js';
import { buildProfile } from './profile.mjs';
import { pickBook, pickEngine, searchFor } from './choose.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const SITE = { chesscom: 'Chess.com', lichess: 'Lichess' };
const FILES = 'abcdefgh';
const MAX_GAMES = 400;
const CACHE_MS = 12 * 3600000;

let profile = null;
let chess = null;
let me = 'w';          // the colour the visitor plays
let flipped = false;
let sel = null;
let targets = [];
let last = null;
let thinking = false;
let over = false;
let engine = null;
let played = [];       // [{ san, by: 'you'|'double', how }]

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000); }
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } },
};

// ---------- building the double ----------
async function loadGames(platform, username, onProgress) {
  const until = Date.now();
  const all = [];
  // 30 days first; quiet players get up to 90.
  for (const days of [30, 90]) {
    const since = until - days * DAY;
    const from = days === 30 ? until : until - 30 * DAY; // the second pass only adds older games
    for (const w of windows(platform, since, from)) {
      const got = await fetchWindow({ platform, username }, w, () => false);
      all.push(...(got || []));
      onProgress(all.length);
      if (all.length >= MAX_GAMES) break;
    }
    if (all.length >= 40 || all.length >= MAX_GAMES) break;
  }
  // Windows can overlap at their edges, so count each game once.
  const seen = new Set();
  return all.filter((g) => !seen.has(g.id) && seen.add(g.id)).sort((a, b) => b.end - a.end).slice(0, MAX_GAMES);
}

async function build(platform, username) {
  const key = `shohmot-double:${platform}:${username.toLowerCase()}`;
  const cached = store.get(key);
  if (cached && Date.now() - cached.builtAt < CACHE_MS) return cached;
  const say = (m) => { $('#py-status').textContent = m; };
  say(`Loading ${username}’s games from ${SITE[platform]}…`);
  const [games, openings] = await Promise.all([
    loadGames(platform, username, (n) => say(`Loading ${username}’s games from ${SITE[platform]}… ${n} so far`)),
    loadBook(),
  ]);
  if (!games.length) throw new Error(`No recent standard games on ${username} (${SITE[platform]}). Play a few and try again.`);
  say(`Learning from ${games.length} games…`);
  await new Promise((r) => setTimeout(r, 30));
  const p = buildProfile(games, { username, platform, openings });
  p.displayName = username;
  store.set(key, p);
  return p;
}

// ---------- profile card ----------
const pctText = (x) => `${Math.round(x * 100)}%`;
function renderProfile() {
  const p = profile;
  const s = p.stats;
  const white = p.firsts.white.map((f) => `1.${esc(f.name)} <small>${f.n}</small>`).join(', ') || '–';
  const black = p.firsts.black.map((f) => { const [a, b] = f.name.split(' '); return `1.${esc(a)} ${esc(b)} <small>${f.n}</small>`; }).join(', ') || '–';
  const named = (list) => list.map((o) => esc(o.name)).join(', ') || '–';
  $('#py-profile').innerHTML = `
    <div class="py-head">
      <div class="py-av" aria-hidden="true">${esc([...p.displayName][0].toUpperCase())}</div>
      <div><h2 id="py-name">${esc(p.displayName)}’s double</h2>
        <p class="muted">${esc(p.style)} player · about ${p.rating} in ${esc(p.speed)} · learnt from ${p.games} games on ${SITE[p.platform]}</p></div>
    </div>
    <div class="py-traits">${p.traits.map((t) => `<span class="py-trait" title="${esc(t.text)}">${esc(t.name)}</span>`).join('') || '<span class="muted small">Play more games for a sharper picture.</span>'}</div>
    <div class="py-grid">
      <div><h3>As White</h3><p>${white}</p><p class="muted small">${named(p.openings.white)}</p></div>
      <div><h3>As Black</h3><p>${black}</p><p class="muted small">${named(p.openings.black)}</p></div>
      <div><h3>How you play</h3>
        <p class="py-bars">
          <span>Captures</span><i style="--w:${Math.min(100, s.captureRate * 250)}%"></i><b>${pctText(s.captureRate)}</b>
          <span>Checks</span><i style="--w:${Math.min(100, s.checkRate * 700)}%"></i><b>${pctText(s.checkRate)}</b>
          <span>Castles</span><i style="--w:${s.castleRate * 100}%"></i><b>${pctText(s.castleRate)}</b>
          <span>Queens off early</span><i style="--w:${s.queenTradeRate * 100}%"></i><b>${pctText(s.queenTradeRate)}</b>
        </p>
        <p class="muted small">Games last ${Math.round(s.avgMoves)} moves on average${s.castleMove ? `; you castle around move ${Math.round(s.castleMove)}` : ''}.</p>
      </div>
    </div>
    <ul class="py-trait-list">${p.traits.map((t) => `<li><b>${esc(t.name)}:</b> ${esc(t.text)}</li>`).join('')}</ul>`;
  $('#py-profile').hidden = false;
}

// ---------- board ----------
function squareXY(sq) {
  const f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
}
function renderBoard() {
  const to = new Set(targets.map((t) => t.to));
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const f = flipped ? 7 - x : x, r = flipped ? y : 7 - y;
      const sq = FILES[f] + (r + 1);
      const p = chess.get(sq);
      const cls = ['sq', (f + r) % 2 ? 'light' : 'dark'];
      if (last && (sq === last.from || sq === last.to)) cls.push('last');
      if (sq === sel) cls.push('sel');
      const king = p && p.type === 'k' && p.color === chess.turn() && chess.inCheck() ? ' style="box-shadow: inset 0 0 0 100vmax rgb(220 79 66 / .45)"' : '';
      cells.push(`<div class="${cls.join(' ')}" data-sq="${sq}"${king}>${p ? `<i class="pc" style="background-image:url(pieces/${p.color}${p.type.toUpperCase()}.svg)"></i>` : ''}${y === 7 ? `<b class="cf">${FILES[f]}</b>` : ''}${x === 0 ? `<b class="cr">${r + 1}</b>` : ''}${to.has(sq) ? `<span class="${p ? 'hint cap' : 'hint'}"></span>` : ''}</div>`);
    }
  }
  $('#board').innerHTML = cells.join('');
}
function squareAt(x, y) {
  const r = $('#board').getBoundingClientRect();
  if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
  const cx = Math.floor(((x - r.left) / r.width) * 8), cy = Math.floor(((y - r.top) / r.height) * 8);
  return FILES[flipped ? 7 - cx : cx] + ((flipped ? cy : 7 - cy) + 1);
}
boardInput($('#board'), {
  squareAt,
  selected: () => sel,
  pick(sq) {
    if (!chess || over || thinking || chess.turn() !== me) return false;
    const p = chess.get(sq);
    if (!p || p.color !== me) return false;
    sel = sq;
    targets = chess.moves({ square: sq, verbose: true }).map((m) => ({ to: m.to }));
    renderBoard();
    return true;
  },
  isTarget: (sq) => targets.some((t) => t.to === sq),
  move: (from, to) => { sel = null; targets = []; playMove({ from, to, promotion: 'q' }, 'you'); },
  clear() { sel = null; targets = []; renderBoard(); },
  redraw: renderBoard,
});

// ---------- the game ----------
const HOW = { book: 'from your games', engine: 'past your openings, playing at your level', style: 'a move in your style', slip: 'a slip, the kind players at your level make' };

function renderMoves() {
  const rows = [];
  for (let i = 0; i < played.length; i += 2) {
    const a = played[i], b = played[i + 1];
    const cell = (h) => (h ? `<span class="mv-${h.by}" title="${h.by === 'double' ? esc(HOW[h.how] || '') : 'you'}">${esc(h.san)}${h.how === 'book' ? '<sup>📖</sup>' : ''}</span>` : '');
    rows.push(`<li><small>${i / 2 + 1}.</small>${cell(a)}${cell(b)}</li>`);
  }
  $('#py-moves').innerHTML = rows.join('');
  $('#py-moves').scrollTop = 1e6;
}

function names() {
  const them = `${profile.displayName}’s double`;
  $('#py-top').innerHTML = `<span class="pl-dot ${me === 'w' ? 'b' : 'w'}"></span>${esc(them)} <small>~${profile.rating}</small>`;
  $('#py-bottom').innerHTML = `<span class="pl-dot ${me}"></span>You`;
}

function endText() {
  if (chess.isCheckmate()) return chess.turn() === me ? `Checkmate. Your double beat you!` : 'Checkmate! You beat yourself.';
  if (chess.isStalemate()) return 'Stalemate: a draw.';
  if (chess.isThreefoldRepetition()) return 'A draw by repetition.';
  if (chess.isInsufficientMaterial()) return 'A draw: nobody can mate.';
  if (chess.isDraw()) return 'A draw.';
  return null;
}

function finish(text) {
  over = true;
  thinking = false;
  $('#py-note').innerHTML = `<b>${esc(text)}</b>`;
  $('#py-resign').hidden = true;
  $('#py-new').hidden = false;
  $('#py-share').hidden = false;
  const pgnHash = new URLSearchParams({ pgn: chess.pgn(), side: me });
  $('#py-review').href = `/review.html#${pgnHash}`;
  $('#py-review').hidden = false;
  track('double_game');
}

function playMove(move, by, how) {
  let m;
  try { m = chess.move(move); } catch { renderBoard(); return; }
  if (!m) { renderBoard(); return; }
  last = { from: m.from, to: m.to };
  played.push({ san: m.san, by, how });
  sound(soundOf(m));
  renderBoard();
  renderMoves();
  const end = endText();
  if (end) return finish(end);
  if (by === 'you') doubleMoves();
}

async function doubleMoves() {
  if (over || chess.turn() === me) return;
  thinking = true;
  $('#py-note').textContent = 'Your double is thinking…';
  const fen = chess.fen();
  const started = Date.now();
  let pick = pickBook(profile, fen);
  if (!pick) {
    try {
      engine ??= new LinesEngine('lite', 4);
      const lines = await engine.lines(fen, searchFor(profile.rating));
      if (over || chess.fen() !== fen) return;
      pick = pickEngine(lines, fen, profile);
    } catch (err) {
      $('#py-note').textContent = `Stockfish couldn’t start in this browser (${err.message}).`;
      thinking = false;
      return;
    }
  }
  // A moment's pause, so book moves don't arrive instantly.
  const wait = Math.max(0, 450 - (Date.now() - started));
  await new Promise((r) => setTimeout(r, wait));
  if (over || chess.fen() !== fen || !pick) { thinking = false; return; }
  thinking = false;
  playMove(pick.san, 'double', pick.how);
  if (!over) {
    const why = pick.how === 'book' ? `you played ${pick.san} here in ${pick.n} of ${pick.of} game${pick.of === 1 ? '' : 's'}` : HOW[pick.how];
    $('#py-note').innerHTML = `Your double played <b>${esc(pick.san)}</b> <span class="muted">(${esc(why)})</span>. Your move.`;
  }
}

function start() {
  const pickC = document.querySelector('#py-color [aria-pressed="true"]').dataset.c;
  me = pickC === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pickC;
  flipped = me === 'b';
  chess = new Chess();
  played = [];
  last = null;
  over = false;
  $('#py-setup').hidden = true;
  $('#py-resign').hidden = false;
  $('#py-new').hidden = true;
  $('#py-review').hidden = true;
  $('#py-share').hidden = true;
  names();
  renderBoard();
  renderMoves();
  $('#py-note').textContent = me === 'w' ? 'You’re White. Your move.' : 'You’re Black.';
  if (me === 'b') doubleMoves();
}

// ---------- wiring ----------
$('#py-color').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b) return;
  for (const x of document.querySelectorAll('#py-color button')) x.setAttribute('aria-pressed', String(x === b));
});
$('#py-start').addEventListener('click', start);
$('#py-new').addEventListener('click', () => { $('#py-setup').hidden = false; $('#py-new').hidden = true; $('#py-review').hidden = true; $('#py-share').hidden = true; $('#py-note').textContent = ''; });
$('#py-resign').addEventListener('click', () => { if (!over && confirm('Resign this game?')) finish('You resigned. Your double wins this one.'); });
$('#py-share').addEventListener('click', async () => {
  const url = `${location.origin}/play-yourself.html?u=${encodeURIComponent(`${profile.platform}:${profile.displayName}`)}`;
  const text = `Can you beat my chess double? It plays like me.`;
  if (navigator.share) { navigator.share({ title: 'My chess double', text, url }).catch(() => {}); return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied: send it to a friend.'); } catch { prompt('Copy this link:', url); }
});

async function go(platform, username) {
  $('#py-go').disabled = true;
  try {
    profile = await build(platform, username);
    $('#py-status').textContent = `${profile.games} games read. Your double is ready.`;
    renderProfile();
    $('#py-play').hidden = false;
    chess = new Chess();
    flipped = false;
    names();
    renderBoard();
    $('#py-setup').hidden = false;
    $('#py-profile').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    track('double_built');
  } catch (err) {
    $('#py-status').textContent = err.message;
  } finally {
    $('#py-go').disabled = false;
  }
}

$('#py-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = $('#py-user').value.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(u)) { $('#py-status').textContent = 'Usernames are 2–30 letters, numbers, - or _.'; return; }
  window.history.replaceState(null, '', `?u=${encodeURIComponent(`${$('#py-site').value}:${u}`)}`);
  go($('#py-site').value, u);
});

// ?u=lichess:name (a shared challenge link) builds that double straight away.
const shared = new URLSearchParams(location.search).get('u');
if (shared && /^(lichess|chesscom):[A-Za-z0-9_-]{2,30}$/.test(shared)) {
  const [platform, username] = shared.split(':');
  $('#py-site').value = platform;
  $('#py-user').value = username;
  go(platform, username);
} else if (signedIn()) {
  // Signed in: offer their own accounts.
  currentUser().then((u) => {
    const accts = (u && u.accounts) || [];
    if (!accts.length) return;
    $('#py-site').value = accts[0].platform;
    $('#py-user').value = accts[0].username;
    if (accts.length > 1) {
      $('#py-mine').innerHTML = `<span class="muted small">Your accounts:</span> ${accts.map((a) => `<button class="btn" type="button" data-p="${a.platform}" data-u="${esc(a.username)}">${esc(a.username)} <small>${SITE[a.platform]}</small></button>`).join('')}`;
      $('#py-mine').hidden = false;
    }
  });
}
$('#py-mine').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-u]');
  if (!b) return;
  $('#py-site').value = b.dataset.p;
  $('#py-user').value = b.dataset.u;
  $('#py-form').requestSubmit();
});
addEventListener('pagehide', () => { if (engine) engine.stop(); });
