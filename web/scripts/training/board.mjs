// Drawing the board for the training pages (mistakes and openings): the squares
// and pieces, the squares a picked piece can reach, one arrow, and where a
// click or touch landed. The page keeps the game and what's picked; this only
// turns them into markup, so both pages draw the same board.
import { slidePieces } from '../review/slide.mjs';
import { boardFx, checkOf } from '../review/fx.mjs';

const FILES = 'abcdefgh';

function squareXY(sq, flipped) {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flipped ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
}

function arrowSvg(uci, cls, flipped) {
  const a = squareXY(uci.slice(0, 2), flipped), b = squareXY(uci.slice(2, 4), flipped);
  const x1 = a.x + 0.5, y1 = a.y + 0.5, x2 = b.x + 0.5, y2 = b.y + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, px = -uy, py = ux;
  const ex = x2 - ux * 0.42, ey = y2 - uy * 0.42, w = 0.09, hw = 0.24;
  const pts = [[x1 + px * w, y1 + py * w], [ex + px * w, ey + py * w], [ex + px * hw, ey + py * hw], [x2, y2], [ex - px * hw, ey - py * hw], [ex - px * w, ey - py * w], [x1 - px * w, y1 - py * w]];
  return `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true"><polygon class="${cls}" points="${pts.map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ')}"/></svg>`;
}

// view: { chess, flipped, last: {from, to, l?}|null, sel: square|null,
//         targets: [{to}], arrow: {uci, cls}|null }
export function drawBoard(el, { chess, flipped, last, sel, targets, arrow }) {
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
      const hint = to.has(sq) ? `<span class="${p ? 'sq-hint cap' : 'sq-hint'}"></span>` : '';
      cells.push(`<div class="${cls.join(' ')}" data-sq="${sq}"${last && sq === last.to && last.l ? ` data-l="${last.l}"` : ''}>${piece}${cf}${cr}${hint}</div>`);
    }
  }
  el.innerHTML = cells.join('') + (arrow ? arrowSvg(arrow.uci, arrow.cls, flipped) : '');
  slidePieces(el);
  boardFx(el, chess.fen(), checkOf(chess));
}

// The square under a point on the screen, or null outside the board.
export function squareAtPoint(el, x, y, flipped) {
  const r = el.getBoundingClientRect();
  if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
  const cx = Math.floor(((x - r.left) / r.width) * 8), cy = Math.floor(((y - r.top) / r.height) * 8);
  const f = flipped ? 7 - cx : cx, rk = flipped ? cy : 7 - cy;
  return FILES[f] + (rk + 1);
}
