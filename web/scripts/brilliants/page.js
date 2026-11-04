// The Brilliants page: runs the scan over your accounts and lists every
// brilliant move found, with a little board for each.
import { currentUser, freshUser, features } from '../session.js';
import { scan } from './scan.mjs';
import { brilliants, checkedCount } from './store.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const WEEKS = 26;
const FREE_DAYS = 7;
const SITE = { chesscom: 'Chess.com', lichess: 'Lichess' };
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const weekFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

let me = null;
let job = null;
let paused = false;
let since = 0;

const isPro = (u) => u && u.plan && u.plan !== 'free';
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(t) { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }

// ---------- little board ----------
const FILES = 'abcdefgh';
function boardHtml(fen, uci, flip) {
  const rows = fen.split(' ')[0].split('/');
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const r = flip ? y : 7 - y; // rank index 0..7 (rank 1 = 0)
      const f = flip ? 7 - x : x;
      const sq = FILES[f] + (r + 1);
      // piece at file f, rank r
      let col = 0, piece = null;
      for (const ch of rows[7 - r]) {
        if (/\d/.test(ch)) { col += Number(ch); continue; }
        if (col === f) { piece = ch; break; }
        col++;
      }
      const cls = ['mb-sq', (f + r) % 2 ? 'l' : 'd'];
      if (sq === from || sq === to) cls.push('hl');
      const img = piece ? `<img src="/pieces/${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toUpperCase()}.svg" alt="">` : '';
      cells.push(`<i class="${cls.join(' ')}">${img}</i>`);
    }
  }
  const xy = (s) => {
    const f = FILES.indexOf(s[0]), r = Number(s[1]) - 1;
    return flip ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
  };
  const a = xy(from), b = xy(to);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const ex = b.x - ux * 0.4, ey = b.y - uy * 0.4, px = -uy, py = ux;
  const pts = [[a.x + px * 0.09, a.y + py * 0.09], [ex + px * 0.09, ey + py * 0.09], [ex + px * 0.24, ey + py * 0.24], [b.x, b.y], [ex - px * 0.24, ey - py * 0.24], [ex - px * 0.09, ey - py * 0.09], [a.x - px * 0.09, a.y - py * 0.09]];
  const arrow = `<svg viewBox="0 0 8 8" aria-hidden="true"><polygon points="${pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ')}"/></svg>`;
  return `<div class="mb" role="img" aria-label="The position before the move">${cells.join('')}${arrow}</div>`;
}

// ---------- render ----------
function render() {
  const accounts = (me && me.accounts) || [];
  const all = brilliants(accounts).filter((b) => b.end >= since);
  const span = isPro(me) ? `the last ${WEEKS} weeks` : `the last ${FREE_DAYS} days`;
  $('#bz-title').textContent = all.length ? `${all.length} brilliant move${all.length === 1 ? '' : 's'}` : 'Your brilliant moves';
  $('#bz-sub').textContent = accounts.length
    ? `In ${span}, on ${accounts.map((a) => `${a.username} (${SITE[a.platform]})`).join(', ')}.`
    : 'Add a Chess.com or Lichess account on the counter first.';

  // By week (Pro) or by day (free)
  const pro = isPro(me);
  const unit = pro ? 7 * DAY : DAY;
  const n = pro ? WEEKS : FREE_DAYS;
  const bucket = (t) => (pro ? startOfWeek(t) : startOfDay(t));
  const first = bucket(Date.now()) - (n - 1) * unit;
  const counts = new Array(n).fill(0);
  for (const b of all) { const k = Math.round((bucket(b.end) - first) / unit); if (k >= 0 && k < n) counts[k]++; }
  const max = Math.max(1, ...counts);
  const label = (i) => `${pro ? 'Week of ' : ''}${weekFmt.format(first + i * unit)}`;
  $('#bz-weeks-h').textContent = pro ? 'By week' : 'By day';
  $('#bz-weeks').style.setProperty('--n', n);
  $('#bz-weeks').innerHTML = counts.map((c, i) => `<span class="bz-week" title="${esc(label(i))}: ${c}"><i style="height:${(c / max) * 100}%"></i><b>${c || ''}</b></span>`).join('');
  $('#bz-weeks').setAttribute('aria-label', counts.map((c, i) => `${label(i)}: ${c}`).join(', '));

  $('#bz-list').innerHTML = all.map((b) => {
    const qs = new URLSearchParams({ p: b.platform, u: b.username || '', id: b.id, t: String(b.end), ply: String(b.ply) });
    const moveNo = `${Math.ceil(b.ply / 2)}${b.ply % 2 ? '.' : '…'}`;
    return `<li class="bz-item">
      ${boardHtml(b.fen, b.uci, b.ply % 2 === 0)}
      <div class="bz-info">
        <p class="bz-move">${moveNo} ${esc(b.san)}<em>!!</em></p>
        <p class="muted">vs ${esc(b.opponent || 'opponent')}${b.speed ? ` · ${esc(b.speed[0].toUpperCase() + b.speed.slice(1))}` : ''} · ${SITE[b.platform]}</p>
        <p class="muted small">${esc(dateFmt.format(b.end))} · ${esc(b.username || '')}</p>
        <a class="btn" href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false">Open in review</a>
      </div>
    </li>`;
  }).join('') || `<li class="empty muted">${job ? 'None found yet. The scan is still going.' : 'No brilliant moves found in this range yet. They’re rare: most players find a handful a month.'}</li>`;
}

function progress(p) {
  const pct = p.note === 'Done.' ? 100 : p.windows ? (p.windowsDone / p.windows) * 100 : 0;
  $('#bz-bar').style.width = `${Math.max(2, pct)}%`;
  const parts = [`${p.checked.toLocaleString()} of ${p.games.toLocaleString()} games loaded so far are checked`, `${p.found} brilliant`];
  if (p.note && p.note !== 'Done.') parts.push(p.note);
  if (p.note === 'Done.') parts[0] = `All ${checkedCount(since).toLocaleString()} games checked`;
  if (p.errors.length) parts.push(`Skipped: ${p.errors.slice(-1)[0]}`);
  $('#bz-status').textContent = parts.join(' · ');
}

function start() {
  const accounts = (me && me.accounts) || [];
  if (!accounts.length) { $('#bz-status').textContent = 'No accounts to scan yet.'; $('#bz-toggle').hidden = true; return; }
  paused = false;
  $('#bz-toggle').textContent = 'Pause';
  job = scan({
    accounts,
    since,
    engine: $('#bz-engine').value,
    onProgress: progress,
    onFound: render,
    onDone: (p) => {
      job = null;
      $('#bz-toggle').textContent = p.stopped ? 'Resume' : 'Scan again';
      render();
    },
  });
  render();
}

function stop() {
  if (job) { job.stop(); job = null; }
  paused = true;
  $('#bz-toggle').textContent = 'Resume';
}

$('#bz-toggle').addEventListener('click', () => (job ? stop() : start()));
$('#bz-engine').addEventListener('change', () => {
  try { localStorage.setItem('shohmot-bz-engine', $('#bz-engine').value); } catch { /* */ }
  if (job) { stop(); start(); }
});
addEventListener('pagehide', () => { if (job) job.stop(); });

try { const e = localStorage.getItem('shohmot-bz-engine'); if (e) $('#bz-engine').value = e; } catch { /* */ }

function setUser(user) {
  me = user;
  since = isPro(me) ? startOfDay(Date.now()) - (WEEKS * 7 - 1) * DAY : startOfDay(Date.now()) - (FREE_DAYS - 1) * DAY;
  $('#banners').innerHTML = isPro(me) ? '' : `<div class="banner" data-kind="info"><p><b>Free scans your last ${FREE_DAYS} days.</b> Pro checks all ${WEEKS} weeks of games on every account.</p>${features().billing ? '<div class="banner-actions"><a class="btn btn-solid" href="/pricing.html">See Pro</a></div>' : ''}</div>`;
  render();
}

currentUser().then(async (user) => {
  if (user) setUser(user);
  const now = await freshUser();
  if (now) setUser(now);
  if (!paused && !job) start();
});
