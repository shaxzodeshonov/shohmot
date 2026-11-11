// Pieces slide to their new squares instead of jumping there. Every board
// (review, analysis, training, play yourself) redraws itself from scratch, so
// this compares the pieces it has just drawn with the ones drawn before: a
// piece that turned up on a new square slides in from the square it left, and
// a captured piece stays put until the capturer lands on it.
//
// slidePieces(board)  call right after the board's squares are redrawn
// dropped(square)     a piece was dragged there by hand: it is already in place
const MS = 190;
const EASE = 'cubic-bezier(.2, .7, .2, 1)';
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const drawn = new WeakMap(); // board -> Map(square -> piece image)
const moving = new WeakMap(); // board -> [{ sq, from, t0, taken }]
let drop = { sq: null, t: 0 };

export function dropped(sq) { drop = { sq, t: performance.now() }; }

const colour = (img) => (/pieces\/(\w)/.exec(img) || [])[1];
const centre = (cell) => { const r = cell.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

function play(board, m, elapsed = 0) {
  const cell = board.querySelector(`[data-sq="${m.sq}"]`);
  const src = board.querySelector(`[data-sq="${m.from}"]`);
  const pc = cell && cell.querySelector('.pc');
  if (!pc || !src || !pc.animate) return;
  const a = centre(src), b = centre(cell);
  pc.style.zIndex = 3;
  const slide = pc.animate([{ transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)` }, { transform: 'none' }], { duration: MS, easing: EASE });
  slide.currentTime = elapsed;
  slide.onfinish = () => { pc.style.zIndex = ''; };
  if (m.taken) {
    // The piece being captured waits underneath until the capturer arrives.
    const ghost = document.createElement('i');
    ghost.className = 'pc';
    ghost.style.backgroundImage = m.taken;
    cell.prepend(ghost);
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: MS, easing: 'linear' });
    fade.currentTime = elapsed;
    fade.onfinish = () => ghost.remove();
  }
}

export function slidePieces(board) {
  const now = new Map();
  for (const pc of board.querySelectorAll('[data-sq] > .pc')) now.set(pc.parentElement.dataset.sq, pc.style.backgroundImage);
  const was = drawn.get(board);
  drawn.set(board, now);
  if (!was || calm.matches) return;

  const t = performance.now();
  const arrived = [...now].filter(([sq, img]) => was.get(sq) !== img);
  if (!arrived.length) {
    // The same position drawn again (a new engine arrow, a selection): slides
    // that were under way carry on from where they were.
    const still = (moving.get(board) || []).filter((m) => t - m.t0 < MS);
    moving.set(board, still);
    for (const m of still) play(board, m, t - m.t0);
    return;
  }
  moving.set(board, []);
  if (arrived.length > 4) return; // another game or a jump across many moves: no parade

  // Squares a piece left: where it was is now empty or holds something else.
  const left = [...was].filter(([sq, img]) => now.get(sq) !== img).map(([sq, img]) => ({ sq, img, used: false }));
  const xy = (sq) => [sq.charCodeAt(0), Number(sq[1])];
  const dist = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.hypot(ax - bx, ay - by); };
  const nearest = (sq, list) => list.sort((a, b) => dist(a.sq, sq) - dist(b.sq, sq))[0];
  const moves = [];
  for (const [sq, img] of arrived) {
    // The same piece from the nearest square it left; a promoted pawn has a
    // new face, so it comes from the square its own side emptied.
    const src = nearest(sq, left.filter((l) => !l.used && l.img === img))
      || nearest(sq, left.filter((l) => !l.used && !now.has(l.sq) && colour(l.img) === colour(img) && /P\.svg/.test(l.img) && dist(l.sq, sq) < 1.5));
    if (!src) continue;
    src.used = true;
    if (sq === drop.sq && t - drop.t < 150) continue;
    const taken = was.get(sq);
    moves.push({ sq, from: src.sq, t0: t, taken: taken && colour(taken) !== colour(img) ? taken : null });
  }
  moving.set(board, moves);
  for (const m of moves) play(board, m);
}
