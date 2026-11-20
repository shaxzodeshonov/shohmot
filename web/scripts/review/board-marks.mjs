// Drawing on the board with the right mouse button, like on Chess.com:
// right-click a square to mark it, right-drag from one square to another to
// draw an arrow. Doing the same again takes it off. Hold Shift, Ctrl or Alt
// for green, blue or yellow instead of the usual red and orange.
// A left click on the board, or a new position, wipes the drawing.
//
// The pages redraw their board by replacing its contents, so the drawing
// lives here and is put back whenever that happens. Squares are found by
// their data-sq, so it follows the board when it is flipped.
//
// boardMarks(el, squareAt) -> { clear(), get arrows(), get squares() }

const NS = 'http://www.w3.org/2000/svg';

const colorOf = (e) => (e.shiftKey ? 'g' : e.ctrlKey || e.metaKey ? 'b' : e.altKey ? 'y' : 'r');

export function boardMarks(el, squareAt) {
  const squares = new Map(); // square -> colour
  const arrows = new Map(); // "e2e4" -> colour
  let draw = null; // { from, to, color } while the right button is down
  let position = '';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'marks');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');

  // Where a square is on the board as drawn now: column and row, 0 to 7.
  const cell = (sq) => {
    const s = el.querySelector(`[data-sq="${sq}"]`);
    if (!s || !s.offsetWidth) return null;
    return { x: Math.round(s.offsetLeft / s.offsetWidth), y: Math.round(s.offsetTop / s.offsetHeight) };
  };

  // An arrow from square centre to square centre. A knight's jump bends,
  // the long leg first.
  const arrowEl = (from, to, color) => {
    const a = cell(from), b = cell(to);
    if (!a || !b) return null;
    const pts = [[a.x + 0.5, a.y + 0.5]];
    const dx = b.x - a.x, dy = b.y - a.y;
    if ((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)) {
      pts.push(Math.abs(dy) > Math.abs(dx) ? [a.x + 0.5, b.y + 0.5] : [b.x + 0.5, a.y + 0.5]);
    }
    const end = [b.x + 0.5, b.y + 0.5];
    const prev = pts[pts.length - 1];
    const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
    const ux = (end[0] - prev[0]) / len, uy = (end[1] - prev[1]) / len;
    const head = 0.44, hw = 0.25;
    const base = [end[0] - ux * head, end[1] - uy * head];
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `mk-arrow c-${color}`);
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', [...pts, base].map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' '));
    const tip = document.createElementNS(NS, 'polygon');
    tip.setAttribute('points', [
      [base[0] - uy * hw, base[1] + ux * hw], end, [base[0] + uy * hw, base[1] - ux * hw],
    ].map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' '));
    g.append(line, tip);
    return g;
  };

  const paint = () => {
    for (const s of el.querySelectorAll('[data-mk]')) if (!squares.has(s.dataset.sq)) delete s.dataset.mk;
    for (const [sq, c] of squares) {
      const s = el.querySelector(`[data-sq="${sq}"]`);
      if (s && s.dataset.mk !== c) s.dataset.mk = c;
    }
    const shown = new Map(arrows);
    if (draw && draw.to && draw.to !== draw.from) shown.set(draw.from + draw.to, draw.color);
    svg.replaceChildren(...[...shown].map(([k, c]) => arrowEl(k.slice(0, 2), k.slice(2), c)).filter(Boolean));
    if (svg.parentNode !== el) el.append(svg);
  };

  // The pieces by square, to notice when the position changes. Sorted, so
  // flipping the board (same squares, other order) doesn't count.
  const positionNow = () => {
    const s = [];
    for (const q of el.querySelectorAll('[data-sq]')) {
      const pc = q.querySelector('.pc');
      if (pc) s.push(q.dataset.sq + pc.style.backgroundImage);
    }
    return s.sort().join();
  };

  const clear = () => {
    if (!squares.size && !arrows.size && !draw) return;
    squares.clear();
    arrows.clear();
    draw = null;
    paint();
  };

  new MutationObserver(() => {
    if (svg.parentNode === el) return; // the board wasn't redrawn, only added to
    const now = positionNow();
    if (now !== position) { position = now; squares.clear(); arrows.clear(); }
    paint();
  }).observe(el, { childList: true });
  position = positionNow();

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    if (e.button === 0) { clear(); return; }
    if (e.button !== 2) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    draw = { from: sq, to: sq, color: colorOf(e) };
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  });

  // Let go of the right button: a square was clicked, or an arrow drawn.
  const finish = (e) => {
    const { from, to } = draw;
    const color = colorOf(e);
    draw = null;
    if (!to) { paint(); return; }
    const [map, key] = to === from ? [squares, from] : [arrows, from + to];
    if (map.get(key) === color) map.delete(key);
    else map.set(key, color);
    paint();
  };

  el.addEventListener('pointermove', (e) => {
    if (!draw) return;
    // With the left button also down, letting go of the right one is a move, not an up.
    if (!(e.buttons & 2)) { finish(e); return; }
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === draw.to) return;
    draw.to = sq;
    paint();
  });

  el.addEventListener('pointerup', (e) => { if (draw && e.button === 2) finish(e); });

  el.addEventListener('pointercancel', () => { if (draw) { draw = null; paint(); } });

  return {
    clear,
    get squares() { return new Map(squares); },
    get arrows() { return new Map(arrows); },
  };
}
