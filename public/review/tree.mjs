// The analysis board's moves as a tree: every position can have several next
// moves. The first is the main line, the others are variations. Reads and
// writes PGN with variations in brackets, so a whole analysis fits in one string.
import { Chess } from '../vendor/chess.mjs';

export const START = new Chess().fen();

let ids = 0;

export function newTree(fen = START) {
  return { id: ids++, fen, parent: null, children: [] };
}

// Plays a move (UCI like "e2e4" or "e7e8q", or SAN) from a node and returns
// the node after it: the existing one if that move was already there.
export function play(node, move) {
  const chess = new Chess(node.fen);
  let m;
  try {
    m = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
      ? chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
      : chess.move(move.replace(/0/g, 'O'));
  } catch {
    return null;
  }
  const uci = m.from + m.to + (m.promotion || '');
  const known = node.children.find((c) => c.uci === uci);
  if (known) return known;
  const child = {
    id: ids++, parent: node, children: [], fen: chess.fen(),
    san: m.san, uci, from: m.from, to: m.to, color: m.color, captured: m.captured || null,
  };
  node.children.push(child);
  return child;
}

export function rootOf(node) {
  while (node.parent) node = node.parent;
  return node;
}

// The moves from the start to this node, oldest first.
export function pathTo(node) {
  const out = [];
  for (let n = node; n.parent; n = n.parent) out.unshift(n);
  return out;
}

// The last node of the main line from here.
export function lineEnd(node) {
  while (node.children.length) node = node.children[0];
  return node;
}

// Is this node on its parent's main line all the way up?
export function onMainLine(node) {
  for (let n = node; n.parent; n = n.parent) if (n.parent.children[0] !== n) return false;
  return true;
}

// Removes this move and everything after it. Returns the node to show instead.
export function cut(node) {
  const p = node.parent;
  if (!p) return node;
  p.children = p.children.filter((c) => c !== node);
  return p;
}

// Makes the variation this node is in the main line at the point it branches.
export function promote(node) {
  let n = node;
  while (n.parent && n.parent.children[0] === n) n = n.parent;
  if (!n.parent) return;
  const kids = n.parent.children;
  kids.splice(kids.indexOf(n), 1);
  kids.unshift(n);
}

// "12." for a White move, "12..." for a Black one: the move's number in the
// game, read from the position before it.
export function moveNo(node) {
  return Number(node.parent.fen.split(' ')[5]) || 1;
}
export function numText(node) {
  return `${moveNo(node)}${node.color === 'w' ? '.' : '...'}`;
}

// ---------- PGN ----------
export function toPgn(root, headers = {}) {
  const h = { Event: 'Analysis', Site: 'Shohmot', ...headers };
  if (root.fen !== START) { h.SetUp = '1'; h.FEN = root.fen; }
  const tags = Object.entries(h).map(([k, v]) => `[${k} "${String(v).replace(/["\\]/g, '')}"]`);
  const out = [];
  const line = (n, force) => {
    while (n.children.length) {
      const [main, ...alts] = n.children;
      out.push(main.color === 'w' || force ? `${numText(main)} ${main.san}` : main.san);
      for (const v of alts) {
        out.push(`(${numText(v)} ${v.san}`);
        line(v, false);
        out[out.length - 1] += ')';
      }
      force = alts.length > 0;
      n = main;
    }
  };
  line(root, true);
  out.push(h.Result || '*');
  return `${tags.join('\n')}\n\n${out.join(' ')}\n`;
}

// Reads PGN, with or without variations, comments and annotations. Returns
// { root, headers }, or throws with a reason.
export function fromPgn(text) {
  const headers = {};
  const body = text.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => { headers[k] = v; return ''; });
  let root;
  try {
    root = newTree(headers.FEN ? new Chess(headers.FEN).fen() : START);
  } catch {
    throw new Error('The FEN in this PGN is not a legal position.');
  }
  const tokens = body
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/[()]/g, ' $& ')
    .split(/\s+/)
    .filter(Boolean);
  let cur = root;
  const stack = [];
  for (const raw of tokens) {
    if (raw === '(') {
      if (!cur.parent) throw new Error('A variation starts before any move.');
      stack.push(cur);
      cur = cur.parent;
      continue;
    }
    if (raw === ')') {
      if (!stack.length) throw new Error('A variation closes that never opened.');
      cur = stack.pop();
      continue;
    }
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw) || /^\$\d+$/.test(raw)) continue;
    const san = raw.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
    if (!san) continue;
    const next = play(cur, san);
    if (!next) throw new Error(`"${san}" is not a legal move there.`);
    cur = next;
  }
  if (!root.children.length && !headers.FEN) throw new Error('No moves found.');
  return { root, headers };
}

// Child indexes from the root to a node, to remember where the board was.
export function addressOf(node) {
  return pathTo(node).map((n) => n.parent.children.indexOf(n));
}
export function nodeAt(root, address) {
  let n = root;
  for (const k of address || []) {
    if (!n.children[k]) break;
    n = n.children[k];
  }
  return n;
}
