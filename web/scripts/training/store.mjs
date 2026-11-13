// Your mistakes, kept in this browser as training positions.
//
// Every game that's been checked (by the counter's quick check or a full
// review) is listed under `games`; each mistake, miss or blunder you made
// becomes an item under `items`, which comes back on a spaced-repetition
// schedule: solve it and it returns after 1, 3, 7 and 21 days, then it's
// learned; miss it and it comes back in 10 minutes.
//
// { v: 1, games: { "<platform>:<id>": { e, s: 'scan'|'review', u, o, sp, acc, r, n, seen } },
//   items: { "<platform>:<id>:<ply>": { …position, box, due, tries, wins, last } } }
// Reading and saving only: it's small, so the counter loads it straight away.
// Turning a labelled game into training positions (which needs chess.js) is
// in mistakes.mjs.

const KEY = 'shohmot-training:v1';
const DAY = 86400000;
export const INTERVALS = [0, 1, 3, 7, 21].map((d) => d * DAY); // by box
export const LEARNED = INTERVALS.length;
const RETRY = 10 * 60000;
const WORST = { blunder: 0, mistake: 1, miss: 2 };

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)); } catch { cache = null; }
  if (!cache || cache.v !== 1) cache = { v: 1, games: {}, items: {} };
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch {
    // Full: forget the oldest checked games that had nothing to train.
    const g = load().games;
    for (const [k] of Object.entries(g).filter(([, x]) => !x.n).sort((a, b) => a[1].e - b[1].e).slice(0, 200)) delete g[k];
    try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* give up quietly */ }
  }
}

const keyOf = (platform, id) => `${platform}:${id}`;
export const isAnalyzed = (platform, id) => !!load().games[keyOf(platform, id)];
export const gameInfo = (platform, id) => load().games[keyOf(platform, id)] || null;
// Every checked game, by "<platform>:<id>" (the coach's session picks from these).
export const checkedGames = () => load().games;

function put(platform, id, info, source) {
  const s = load();
  const k = keyOf(platform, id);
  if (source === 'scan' && s.games[k] && s.games[k].s === 'review') return; // the review knows better
  const prev = s.games[k];
  s.games[k] = { e: info.end, s: source, u: info.username, o: info.opponent, sp: info.speed, acc: info.accuracy, r: info.result, n: info.items.length, seen: prev ? prev.seen : false };
  // Replace this game's items, keeping progress on positions that are still there.
  const keep = {};
  for (const [ik, it] of Object.entries(s.items)) if (ik.startsWith(`${k}:`)) { keep[it.ply] = it; delete s.items[ik]; }
  for (const it of info.items) {
    const old = keep[it.ply];
    s.items[`${k}:${it.ply}`] = { ...it, platform, id, end: info.end, username: info.username, opponent: info.opponent, speed: info.speed,
      box: old ? old.box : 0, due: old ? old.due : 0, tries: old ? old.tries : 0, wins: old ? old.wins : 0, last: old ? old.last : 0 };
  }
  save();
}
export const saveScannedMistakes = (platform, id, info) => put(platform, id, info, 'scan');
export const saveReviewedMistakes = (platform, id, info) => put(platform, id, info, 'review');

// The game a "needs work" pop-up is about: the newest checked game with
// mistakes that hasn't been dismissed.
export function latestUnseen(accounts, since = 0) {
  const mine = new Set(accounts.map((a) => `${a.platform}:${a.username.toLowerCase()}`));
  let best = null;
  for (const [k, g] of Object.entries(load().games)) {
    if (g.seen || !g.n || g.e < since) continue;
    const platform = k.slice(0, k.indexOf(':'));
    if (!mine.has(`${platform}:${String(g.u || '').toLowerCase()}`)) continue;
    if (!best || g.e > best.g.e) best = { key: k, platform, id: k.slice(k.indexOf(':') + 1), g };
  }
  if (!best) return null;
  return { ...best, items: itemsOf(best.key) };
}
export function markSeen(key) {
  const g = load().games[key];
  if (g) { g.seen = true; save(); }
}

export function itemsOf(gameKey) {
  return Object.entries(load().items).filter(([k]) => k.startsWith(`${gameKey}:`)).map(([, it]) => it).sort((a, b) => a.ply - b.ply);
}

// Positions to train now: due ones, worst mistakes and newest games first.
// With a game key (or several), those games' positions come first, due or not,
// in the order the games were given.
export function queue({ now = Date.now(), game = null } = {}) {
  const all = Object.entries(load().items).map(([key, it]) => ({ key, ...it })).filter((it) => it.box < LEARNED);
  const games = [].concat(game || []);
  const rank = (it) => games.findIndex((g) => it.key.startsWith(`${g}:`));
  const first = all.filter((it) => rank(it) >= 0).sort((a, b) => rank(a) - rank(b) || a.ply - b.ply);
  const rest = all.filter((it) => !first.includes(it) && it.due <= now)
    .sort((a, b) => a.due - b.due || WORST[a.label] - WORST[b.label] || b.end - a.end);
  return [...first, ...rest];
}

// Pure scheduling: an item after an attempt.
export function schedule(it, solved, now = Date.now()) {
  const box = solved ? Math.min(LEARNED, it.box + 1) : 0;
  return { ...it, box, due: solved ? (box >= LEARNED ? Infinity : now + INTERVALS[box]) : now + RETRY, tries: it.tries + 1, wins: it.wins + (solved ? 1 : 0), last: now };
}

export function record(key, solved, now = Date.now()) {
  const s = load();
  const it = s.items[key];
  if (!it) return null;
  const next = schedule(it, solved, now);
  if (next.due === Infinity) next.due = 8.64e15; // JSON has no Infinity
  s.items[key] = next;
  // Today's count, for the free plan's daily limit.
  const day = new Date(now).toDateString();
  if (s.today && s.today.day === day) s.today.n++; else s.today = { day, n: 1 };
  save();
  return next;
}
export function doneToday(now = Date.now()) {
  const t = load().today;
  return t && t.day === new Date(now).toDateString() ? t.n : 0;
}

// For "what to work on": counts by kind and phase, and overall progress.
export function stats() {
  const items = Object.values(load().items);
  const by = (f) => items.reduce((m, it) => { m[it[f]] = (m[it[f]] || 0) + 1; return m; }, {});
  const now = Date.now();
  return {
    total: items.length,
    learned: items.filter((it) => it.box >= LEARNED).length,
    due: items.filter((it) => it.box < LEARNED && it.due <= now).length,
    kinds: by('kind'),
    phases: by('phase'),
    labels: by('label'),
    games: Object.keys(load().games).length,
  };
}
