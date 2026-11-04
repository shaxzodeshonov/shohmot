// Which games have been checked for brilliant moves, and what was found, kept
// in this browser (localStorage) so each game is only ever checked once.
// A full game review (review.html) overwrites the quick scan's answer for its
// game, because it searches deeper.
//
// Shape: { v: 1, games: { "<platform>:<id>": { e: end ms, s: 'scan'|'review',
//          u?: username, o?: opponent, sp?: speed, b: [{ ply, san, fen, uci }] } } }
const KEY = 'shohmot-brilliants:v1';
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)); } catch { cache = null; }
  if (!cache || cache.v !== 1 || typeof cache.games !== 'object') cache = { v: 1, games: {} };
  return cache;
}

let saveTimer = null;
function save(now = false) {
  const write = () => {
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(load())); } catch {
      // Full: drop the oldest checked games without finds, then try once more.
      const g = load().games;
      const empty = Object.entries(g).filter(([, x]) => !x.b.length).sort((a, b) => a[1].e - b[1].e);
      for (const [k] of empty.slice(0, Math.ceil(empty.length / 2))) delete g[k];
      try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* give up quietly */ }
    }
  };
  if (now) { clearTimeout(saveTimer); write(); return; }
  saveTimer ??= setTimeout(write, 500);
}
if (typeof addEventListener === 'function') addEventListener('pagehide', () => { if (saveTimer) save(true); });

const keyOf = (platform, id) => `${platform}:${id}`;

export function isChecked(platform, id) {
  return !!load().games[keyOf(platform, id)];
}

function entry({ end, username, opponent, speed, found }, source) {
  const e = { e: end, s: source, b: found || [] };
  if (e.b.length) { e.u = username; e.o = opponent; e.sp = speed; }
  return e;
}

export function saveScanned(platform, id, info) {
  const g = load().games;
  const k = keyOf(platform, id);
  if (g[k] && g[k].s === 'review') return; // the review knows better
  g[k] = entry(info, 'scan');
  save();
}

export function saveReviewed(platform, id, info) {
  const g = load().games;
  const prev = g[keyOf(platform, id)];
  g[keyOf(platform, id)] = entry({ speed: prev && prev.sp, ...info }, 'review');
  save(true);
}

// Every brilliant move found on these accounts ([{ platform, username }]),
// newest first: [{ platform, id, end, username, opponent, speed, ply, san, fen, uci }].
export function brilliants(accounts) {
  const mine = new Set((accounts || []).map((a) => `${a.platform}:${a.username.toLowerCase()}`));
  const out = [];
  for (const [k, g] of Object.entries(load().games)) {
    if (!g.b.length) continue;
    const i = k.indexOf(':');
    const platform = k.slice(0, i);
    if (accounts && !mine.has(`${platform}:${String(g.u || '').toLowerCase()}`)) continue;
    for (const b of g.b) out.push({ platform, id: k.slice(i + 1), end: g.e, username: g.u, opponent: g.o, speed: g.sp, ...b });
  }
  return out.sort((x, y) => y.end - x.end || y.ply - x.ply);
}

// How many games have been checked in a time range.
export function checkedCount(from = 0, to = Infinity) {
  let n = 0;
  for (const g of Object.values(load().games)) if (g.e >= from && g.e < to) n++;
  return n;
}

export function clearAll() {
  cache = { v: 1, games: {} };
  save(true);
}

// The brilliant moves found in one game ([] if none or not checked yet).
export function foundIn(platform, id) {
  const g = load().games[keyOf(platform, id)];
  return g ? g.b : [];
}
