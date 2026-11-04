// The coach dashboard: an invite link, and each student's week, from the
// same game data the counter uses (/api/state), a few students at a time.
import { api, currentUser } from './session.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const SITE = { chesscom: 'Chess.com', lichess: 'Lichess' };
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000); }
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function ago(t) {
  const s = Math.round((t - Date.now()) / 1000);
  if (-s < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (-s < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
const postRating = (g) => (g.ratingDiff != null ? g.rating + g.ratingDiff : g.rating);

// One student's week from their accounts' games.
export function weekOf(accounts, now = Date.now()) {
  const today = startOfDay(now);
  const week = now - 7 * DAY;
  const games = accounts.flatMap((a) => a.games.map((g) => ({ ...g, account: a })));
  const recent = games.filter((g) => g.end >= week).sort((x, y) => y.end - x.end);
  // Rating change on the type they played most this week.
  const bySpeed = {};
  for (const g of recent) if (g.rated && g.rating != null) (bySpeed[g.speed] ||= []).push(g);
  const main = Object.entries(bySpeed).sort((x, y) => y[1].length - x[1].length)[0];
  let rating = null;
  if (main) {
    const [speed, list] = main;
    const sorted = list.slice().sort((x, y) => x.end - y.end);
    const before = games.filter((g) => g.speed === speed && g.rated && g.end < week && g.rating != null).sort((x, y) => x.end - y.end).pop();
    const from = before ? postRating(before) : sorted[0].rating;
    const to = postRating(sorted[sorted.length - 1]);
    rating = { speed, rating: to, change: to - from };
  }
  return {
    today: recent.filter((g) => g.end >= today).length,
    week: recent.length,
    lost: recent.filter((g) => g.result === 'loss').length,
    rating,
    last: games.length ? Math.max(...games.map((g) => g.end)) : null,
    recent,
  };
}

let students = [];
const data = new Map(); // student id -> week, or { error }

function row(s) {
  const w = data.get(s.id);
  const accts = s.accounts.map((a) => `${esc(a.username)} <small>${SITE[a.platform]}</small>`).join(', ') || '<small>No chess accounts yet</small>';
  const who = `<td><b>${esc(s.name)}</b><span class="c-accts">${accts}</span></td>`;
  const remove = `<td><button class="link-btn" type="button" data-remove="${esc(s.id)}">Remove</button></td>`;
  if (!s.accounts.length) return `<tr>${who}<td colspan="5" class="muted">They haven’t added a chess account.</td>${remove}</tr>`;
  if (!w) return `<tr>${who}<td colspan="5" class="muted">Loading…</td>${remove}</tr>`;
  if (w.error) return `<tr>${who}<td colspan="5" class="muted">${esc(w.error)}</td>${remove}</tr>`;
  const rating = w.rating ? `${w.rating.rating} <em class="${w.rating.change >= 0 ? 'up' : 'down'}">${w.rating.change >= 0 ? '+' : '−'}${Math.abs(w.rating.change)}</em> <small>${esc(w.rating.speed)}</small>` : '–';
  const lostPct = w.week ? Math.round((w.lost / w.week) * 100) : 0;
  return `<tr class="c-row" data-id="${esc(s.id)}" tabindex="0" aria-expanded="false">${who}<td>${w.today}</td><td>${w.week}</td><td>${w.lost}${w.week ? ` <small>${lostPct}%</small>` : ''}</td><td>${rating}</td><td>${w.last ? esc(ago(w.last)) : '–'}</td>${remove}</tr>
    <tr class="c-games" data-for="${esc(s.id)}" hidden><td colspan="7"><ol>${w.recent.slice(0, 12).map((g) => {
      const qs = new URLSearchParams({ p: g.account.platform, u: g.account.username, id: g.id, t: String(g.end), coach: '1' });
      const ok = g.variant === 'chess' || g.variant === 'standard';
      return `<li><span class="res ${g.result}">${g.result === 'win' ? 'Won' : g.result === 'draw' ? 'Draw' : 'Lost'}</span> vs ${esc(g.opponent)} <small>${esc(g.speed)} · ${esc(dayFmt.format(g.end))}</small>${ok ? ` <a class="btn" href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false">Review</a>` : ''}</li>`;
    }).join('') || '<li class="muted">No games this week.</li>'}</ol></td></tr>`;
}

function render() {
  const rows = students.slice().sort((a, b) => ((data.get(b.id) || {}).last || 0) - ((data.get(a.id) || {}).last || 0));
  $('#c-rows').innerHTML = rows.map(row).join('') || '<tr><td colspan="7" class="muted">No students yet. Send them your invite link.</td></tr>';
}

async function load(s) {
  if (!s.accounts.length) return;
  const q = s.accounts.map((a) => `${a.platform}:${a.username}`).join(',');
  try {
    const res = await fetch(`/api/state?accounts=${encodeURIComponent(q)}&days=8`);
    if (!res.ok) throw new Error(`Couldn’t load their games (${res.status}).`);
    const { accounts } = await res.json();
    data.set(s.id, weekOf(accounts));
  } catch (err) { data.set(s.id, { error: err.message }); }
  render();
}

async function loadAll() {
  const queue = students.slice();
  const worker = async () => { while (queue.length) await load(queue.shift()); };
  await Promise.all([worker(), worker(), worker()]);
}

function showInvite(code) {
  $('#c-link').value = `${location.origin}/join.html?code=${code}`;
}

$('#c-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#c-link').value); toast('Invite link copied.'); } catch { $('#c-link').select(); }
});
$('#c-new').addEventListener('click', async () => {
  if (!confirm('Make a new invite link? The old one stops working; students who already joined stay.')) return;
  try { showInvite((await api('/api/coach', { action: 'invite' })).code); toast('New link ready.'); } catch (err) { toast(err.message); }
});
$('#c-rows').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const s = students.find((x) => x.id === rm.dataset.remove);
    if (!s || !confirm(`Remove ${s.name}? They stop being your student, and you stop seeing their games.`)) return;
    try { students = (await api('/api/coach', { action: 'remove', student: s.id })).students; render(); toast(`${s.name} removed.`); } catch (err) { toast(err.message); }
    return;
  }
  const r = e.target.closest('.c-row');
  if (r && !e.target.closest('a, button')) {
    const g = document.querySelector(`.c-games[data-for="${r.dataset.id}"]`);
    if (g) { g.hidden = !g.hidden; r.setAttribute('aria-expanded', String(!g.hidden)); }
  }
});
$('#c-rows').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('c-row')) e.target.click(); });

currentUser().then(async () => {
  const res = await fetch('/api/coach', { cache: 'no-store' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { $('#c-rows').innerHTML = `<tr><td colspan="7" class="muted">${esc(out.error || 'Couldn’t load this.')}</td></tr>`; return; }
  if (!out.canCoach) {
    $('#banners').innerHTML = '<div class="banner" data-kind="info"><p><b>Coaching isn’t on for your account.</b></p></div>';
    $('#c-rows').innerHTML = '';
    return;
  }
  $('#invite-box').hidden = false;
  showInvite(out.code);
  students = out.students || [];
  $('#c-seats').insertAdjacentText('beforeend', ` ${students.length} of ${out.seats} places used.`);
  render();
  loadAll();
});
