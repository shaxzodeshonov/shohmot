// Moving pieces on the board with a mouse, finger or pen: drag a piece to a
// square, or click it and then click where it should go. The board keeps the
// rules; this only turns pointer events into "pick this square" and "move from
// here to there".
//
// api.squareAt(clientX, clientY) -> square name or null
// api.selected() -> the picked square or null
// api.pick(square) -> true if there is a piece to move there (and picks it)
// api.isTarget(square) -> true if the picked piece can go there
// api.move(from, to) -> play the move
// api.clear() -> drop the selection
// api.redraw() -> draw the board again (after a drag that went nowhere)
//
// The right button draws on the board (board-marks.mjs). Pressing it while a
// piece is held puts the piece back where it was, as on Chess.com.
// Ctrl+Z shows the board alone (board-focus.mjs).
import { dropped } from './slide.mjs';
import { boardMarks } from './board-marks.mjs';
import { boardFocus } from './board-focus.mjs';

export function boardInput(el, api) {
  let drag = null; // { from, x, y, ghost, piece, wasSelected }
  const marks = boardMarks(el, api.squareAt);
  boardFocus(el);

  const cleanup = () => {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    if (drag.piece) drag.piece.classList.remove('lifted');
    drag = null;
  };

  const moveGhost = (e) => {
    const { ghost } = drag;
    ghost.style.transform = `translate(${e.clientX - ghost.offsetWidth / 2}px, ${e.clientY - ghost.offsetHeight / 2}px)`;
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.promo')) return;
    const sq = api.squareAt(e.clientX, e.clientY);
    if (!sq) return;
    const sel = api.selected();
    if (sel && sq !== sel && api.isTarget(sq)) {
      e.preventDefault();
      api.move(sel, sq);
      return;
    }
    if (!api.pick(sq)) { api.clear(); return; }
    e.preventDefault();
    drag = { from: sq, x: e.clientX, y: e.clientY, ghost: null, piece: null, wasSelected: sel === sq };
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // The right button pressed while the left one holds a piece: put it back.
    // (A second button down is a pointermove, not a pointerdown.)
    if (e.buttons & 2) {
      cleanup();
      api.clear();
      api.redraw();
      return;
    }
    if (!drag.ghost) {
      // A few pixels of movement before it counts as a drag, so a click stays a click.
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      const piece = el.querySelector(`[data-sq="${drag.from}"] .pc`);
      if (!piece) return;
      const size = piece.getBoundingClientRect().width;
      const ghost = piece.cloneNode();
      ghost.className = 'pc ghost';
      ghost.style.width = ghost.style.height = `${size}px`;
      document.body.append(ghost);
      piece.classList.add('lifted');
      drag.ghost = ghost;
      drag.piece = piece;
    }
    moveGhost(e);
  });

  el.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const { from, ghost, wasSelected } = drag;
    cleanup();
    if (ghost) {
      const to = api.squareAt(e.clientX, e.clientY);
      if (to && to !== from && api.isTarget(to)) { dropped(to); api.move(from, to); }
      else api.redraw();
    } else if (wasSelected) {
      api.clear(); // a second click on the picked piece puts it back
    }
  });

  el.addEventListener('pointercancel', () => { cleanup(); api.redraw(); });

  return { marks, get dragging() { return !!(drag && drag.ghost); } };
}
