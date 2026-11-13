// Your training days, kept in this browser: how long you focused, how many
// games you reviewed start to end and how many positions you solved, a day at
// a time; and today's session, the handful of games the coach lines up for a
// start-to-end review.
//
// { v: 1,
//   days: { "2026-11-13": { t: seconds focused, g: games reviewed, p: positions solved } },
//   reviewed: { "<platform>:<id>": ms },   games reviewed start to end
//   session: { day, games: [{ key, platform, id, u, e, o, r, n, sp, acc }] } }
//
// It's read from storage on every call, not cached: the review page and the
// Training page are often open in two tabs, and both write here.

const KEY = 'shohmot-focus:v1';
const DAY = 86400000;
const KEEP_DAYS = 90;
export const SESSION_GAMES = 5;
// A full review of one game, start to end, takes about this long.
export const MIN_PER_GAME = 5;

const pad = (n) => String(n).padStart(2, '0');
// The day in the visitor's own time zone: a session at 11 pm counts for that evening.
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Noon of the day before, so a 23- or 25-hour day (clock changes) can't skip or repeat one.
export function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d, 12).getTime() - DAY);
}

let memory = null; // where there's no storage (tests, private mode)
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { s = memory; }
  if (!s || s.v !== 1) s = { v: 1, days: {}, reviewed: {}, session: null };
  s.days ||= {};
  s.reviewed ||= {};
  return s;
}
function save(s) {
  const days = Object.keys(s.days).sort();
  for (const k of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete s.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { memory = s; }
}
export function reset() { memory = null; try { localStorage.removeItem(KEY); } catch { /* no storage */ } }

const EMPTY = { t: 0, g: 0, p: 0 };
export const dayOf = (key) => ({ ...EMPTY, ...(load().days[key] || {}) });
export const today = (now = Date.now()) => dayOf(dayKey(now));
export const yesterday = (now = Date.now()) => dayOf(dayBefore(dayKey(now)));

function add(field, n, now) {
  const s = load();
  const k = dayKey(now);
  s.days[k] = { ...EMPTY, ...(s.days[k] || {}) };
  s.days[k][field] += n;
  save(s);
  return s.days[k];
}
export const addSeconds = (n, now = Date.now()) => add('t', n, now);
export const addSolved = (now = Date.now()) => add('p', 1, now);

// The last `n` days, oldest first, today last: [{ key, t, g, p }].
export function lastDays(n = 7, now = Date.now()) {
  const out = [];
  let k = dayKey(now);
  for (let i = 0; i < n; i++) { out.unshift({ key: k, ...dayOf(k) }); k = dayBefore(k); }
  return out;
}

// Days in a row with any training, ending today (or yesterday, if today hasn't started yet).
export function streak(now = Date.now()) {
  const s = load();
  const on = (k) => { const d = s.days[k]; return !!d && (d.t >= 60 || d.g > 0 || d.p > 0); };
  let k = dayKey(now);
  if (!on(k)) k = dayBefore(k);
  let n = 0;
  while (on(k)) { n++; k = dayBefore(k); }
  return n;
}

// ---------- the session ----------
export const wasReviewed = (key) => !!load().reviewed[key];

// Pure: which games to line up. `games` is the training store's
// { "<platform>:<id>": { e, u, o, sp, acc, r, n } }; the newest ones with
// mistakes that haven't been reviewed start to end come first.
export function pickGames(games, reviewed = {}, n = SESSION_GAMES) {
  return Object.entries(games)
    .filter(([k, g]) => g.n > 0 && g.u && !reviewed[k])
    .sort((a, b) => b[1].e - a[1].e)
    .slice(0, n)
    .map(([key, g]) => ({ key, platform: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1), u: g.u, e: g.e, o: g.o, r: g.r, n: g.n, sp: g.sp, acc: g.acc }));
}

export const picksFrom = (games, n = SESSION_GAMES) => pickGames(games, load().reviewed, n);

// Today's session, with each game's `done`; null if none was started today.
export function session(now = Date.now()) {
  const s = load();
  if (!s.session || s.session.day !== dayKey(now)) return null;
  const games = s.session.games.map((g) => ({ ...g, done: !!s.reviewed[g.key] }));
  const done = games.filter((g) => g.done).length;
  return { day: s.session.day, games, done, total: games.length, complete: done === games.length, next: games.find((g) => !g.done) || null };
}

export function startSession(games, now = Date.now()) {
  const s = load();
  s.session = { day: dayKey(now), games: pickGames(games, s.reviewed) };
  save(s);
  return session(now);
}

// A game was gone through start to end. Counts once, on the day it was finished.
export function markReviewed(key, now = Date.now()) {
  const s = load();
  if (s.reviewed[key]) return false;
  s.reviewed[key] = now;
  // Old marks only matter while the game can still be picked: keep the newest 500.
  const all = Object.entries(s.reviewed).sort((a, b) => b[1] - a[1]);
  for (const [k] of all.slice(500)) delete s.reviewed[k];
  const k = dayKey(now);
  s.days[k] = { ...EMPTY, ...(s.days[k] || {}) };
  s.days[k].g++;
  save(s);
  return true;
}

export function reviewUrl(g) {
  return `/review.html?${new URLSearchParams({ p: g.platform, u: g.u || '', id: g.id, t: String(g.e), session: '1' })}`;
}

// ---------- words ----------
// "4 min", "1 h 12 min"; under a minute is "0 min" only once nothing else would show.
export function minutes(sec) {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
// The running clock: "04:12", "1:04:12".
export function clock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
