// How well you know each opening line, kept in this browser.
//
// One entry per line and side: { box, due, tries, wins, last }, scheduled
// like the mistake positions (store.mjs): play the whole line right from
// memory and it comes back after 1, 3, 7 and 21 days, then it's learned;
// slip once and it comes back in 10 minutes.
//
//   { v: 1, lines: { "w:<lineId>": { box, due, tries, wins, last } } }
import { schedule, LEARNED } from './store.mjs';

const KEY = 'shohmot-openings:v1';

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)); } catch { cache = null; }
  if (!cache || cache.v !== 1) cache = { v: 1, lines: {} };
  return cache;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* full or private mode: progress just isn't kept */ }
}

export const get = (color, id) => load().lines[`${color}:${id}`] || null;

// A whole line played from memory: clean when no move needed a hint or a second try.
export function record(color, id, clean, now = Date.now()) {
  const s = load();
  const key = `${color}:${id}`;
  const next = schedule(s.lines[key] || { box: 0, due: 0, tries: 0, wins: 0, last: 0 }, clean, now);
  if (next.due === Infinity) next.due = 8.64e15; // JSON has no Infinity
  s.lines[key] = next;
  save();
  return next;
}

// Everything at a glance, for the top of the page.
export function totals(now = Date.now()) {
  const all = Object.values(load().lines);
  return {
    tried: all.length,
    learned: all.filter((e) => e.box >= LEARNED).length,
    due: all.filter((e) => e.box < LEARNED && e.due <= now).length,
  };
}
