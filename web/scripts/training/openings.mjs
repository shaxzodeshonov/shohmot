// The opening lines the trainer drills, and the rules for drilling them.
//
// public/opening-lines.json (built by scripts/build-openings.mjs from Lichess's
// CC0 opening list) holds every named line as [ECO, name, "e4 c5 Nf3 …"].
// A name is "<Family>: <Variation>, <Sub-variation>", so "Sicilian Defense:
// Najdorf Variation, English Attack" is the Sicilian family's Najdorf line.
//
// You train a line as White or as Black: the other side's moves are played
// for you, and you play yours from memory. Practising a family means going
// through every variation in it, so whatever your opponent plays against
// your opening, you've seen it. Pure functions only (no page, no storage).
import { LEARNED } from './store.mjs';

// A short, stable id for a line (its moves never change; its name might).
export function lineId(moves) {
  let h = 5381;
  for (let i = 0; i < moves.length; i++) h = ((h * 33) ^ moves.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function parseLines(raw) {
  return raw.map(([eco, name, san]) => {
    const family = name.split(':')[0];
    return {
      id: lineId(san),
      eco,
      name,
      family,
      variation: name.slice(family.length).replace(/^:\s*/, ''),
      moves: san.split(' '),
    };
  });
}

// Is ply `i` (0 = White's first move) played by `color`?
export const isOwn = (i, color) => (i % 2 === 0) === (color === 'w');

// How many moves of the line the player makes. A line you make no move in
// (Black, one ply long) has nothing to train.
export const ownCount = (line, color) => line.moves.filter((_, i) => isOwn(i, color)).length;
export const playable = (line, color) => ownCount(line, color) > 0;

// The families, biggest first, each with its lines shortest first, so the
// trunk of an opening comes before its side branches.
export function families(lines) {
  const by = new Map();
  for (const l of lines) {
    if (!by.has(l.family)) by.set(l.family, { name: l.family, eco: l.eco, lines: [] });
    by.get(l.family).lines.push(l);
  }
  const out = [...by.values()];
  for (const f of out) f.lines.sort((a, b) => a.moves.length - b.moves.length || a.name.localeCompare(b.name));
  return out.sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name));
}

// Every move that follows a given start, in any line: prefix -> Map(san -> line name).
// It tells "wrong for this line" from "a real book move, just in another variation".
export function bookIndex(lines) {
  const book = new Map();
  for (const l of lines) {
    for (let i = 0; i < l.moves.length; i++) {
      const prefix = l.moves.slice(0, i).join(' ');
      let next = book.get(prefix);
      if (!next) book.set(prefix, (next = new Map()));
      if (!next.has(l.moves[i])) next.set(l.moves[i], l.name);
    }
  }
  return book;
}

// The line name a move belongs to when it's a book move here, else null.
export function bookMove(book, line, i, san) {
  const next = book.get(line.moves.slice(0, i).join(' '));
  return (next && next.get(san)) || null;
}

// Where a line stands for one side. `entry` is what the store holds for it.
export function status(entry, now = Date.now()) {
  if (!entry) return 'new';
  if (entry.box >= LEARNED) return 'learned';
  return entry.due <= now ? 'due' : 'learning';
}

// The order to train a set of lines: what's due first (the longest overdue
// first), then lines you haven't seen, shortest first.
export function order(lines, color, get, now = Date.now()) {
  const due = [], fresh = [];
  for (const l of lines) {
    if (!playable(l, color)) continue;
    const s = status(get(color, l.id), now);
    if (s === 'due') due.push(l);
    else if (s === 'new') fresh.push(l);
  }
  due.sort((a, b) => get(color, a.id).due - get(color, b.id).due);
  fresh.sort((a, b) => a.moves.length - b.moves.length || a.name.localeCompare(b.name));
  return [...due, ...fresh];
}

// Counts for a set of lines: how many are new, being learned, due and learned.
export function progress(lines, color, get, now = Date.now()) {
  const p = { total: 0, new: 0, learning: 0, due: 0, learned: 0 };
  for (const l of lines) {
    if (!playable(l, color)) continue;
    p.total++;
    p[status(get(color, l.id), now)]++;
  }
  return p;
}

// "1. e4 c5 2. Nf3" for the first `upTo` plies; hidden plies show as "···".
export function moveText(moves, upTo = moves.length) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.`);
    out.push(i < upTo ? moves[i] : '···');
  }
  return out.join(' ');
}
