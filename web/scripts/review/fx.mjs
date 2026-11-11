// What happens on the board when a move matters:
//   check      a red streak runs from each checking piece to the king, which
//              jumps and shakes as a ring bursts from its square
//   checkmate  the king topples over and stays down; a shockwave leaves its square
//   brilliant  the square bursts into sparks, a shine crosses it, the piece hops
//   blunder    the badge slams down, the square flashes red, the piece and the board shake
//   any label  its badge pops in
// The boards redraw from scratch (often several times a second while the
// engine thinks), so every effect is tied to the moment its position was first
// shown: a redraw of the same position picks each animation up where it was.
//
// boardFx(board, key, { king, mate, from, label })  call right after the squares are redrawn
//   key    changes when the position or its label changes (that starts the effects)
//   king   square of the king in check, or null
//   mate   true if that king is checkmated
//   from   squares of the pieces giving check
// checkOf(chess) works king, mate and from out of a chess.js position.
//   label  { sq, l } the move's review label and the square it landed on, or null
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const shown = new WeakMap(); // board -> { key, t0 }
const RED = '#dc4f42';
const OUT = 'cubic-bezier(.16, 1, .3, 1)';
const AFTER_SLIDE = 200; // pieces finish sliding first (slide.mjs)

export function checkOf(chess) {
  if (!chess.inCheck()) return { king: null, mate: false, from: [] };
  let king = null;
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) king = p.square;
  return { king, mate: chess.isCheckmate(), from: king ? chess.attackers(king, chess.turn() === 'w' ? 'b' : 'w') : [] };
}

export function boardFx(board, key, { king = null, mate = false, from = [], label = null } = {}) {
  const cellOf = (sq) => board.querySelector(`[data-sq="${sq}"]`);
  const kingCell = king && cellOf(king);
  if (kingCell) kingCell.classList.add('check');

  const now = performance.now();
  let st = shown.get(board);
  const fresh = !st || st.key !== key;
  // The first position a board shows arrives without fanfare.
  if (fresh) { st = { key, t0: st ? now : -1e9 }; shown.set(board, st); }
  const elapsed = calm.matches ? 1e9 : now - st.t0;

  // Run an animation as if it had started when the position first appeared.
  const run = (el, frames, { duration, delay = 0, easing = OUT, hold = false }) => {
    if (!el || !el.animate) return;
    if (!hold && elapsed >= delay + duration) return;
    const a = el.animate(frames, { duration, delay, easing, fill: hold ? 'forwards' : 'none' });
    a.currentTime = Math.min(elapsed, delay + duration);
    return a;
  };
  // A throwaway shape inside a square, gone once its animation is over.
  const shape = (cell, css, frames, opts) => {
    if (elapsed >= (opts.delay || 0) + opts.duration) return;
    const el = document.createElement('span');
    el.className = 'fx';
    el.style.cssText = css + ';opacity:0';
    cell.append(el);
    const a = run(el, frames, opts);
    if (a) a.onfinish = () => el.remove(); else el.remove();
  };

  // The attack: a streak from each checking piece that lands on the king.
  const HIT = AFTER_SLIDE + 190; // when it arrives
  if (kingCell) {
    const k = kingCell.getBoundingClientRect();
    for (const sq of from) {
      const src = cellOf(sq);
      if (!src) continue;
      const r = src.getBoundingClientRect();
      const dx = r.left - k.left, dy = r.top - k.top;
      const len = Math.hypot(dx, dy);
      // Drawn from the king's centre out to the attacker, then revealed attacker-first.
      shape(kingCell, `left:50%;top:50%;width:${len}px;height:16%;margin-top:-8%;border-radius:99em;transform-origin:0 50%;transform:rotate(${Math.atan2(dy, dx)}rad);background:linear-gradient(90deg, #fff 0%, ${RED} 18%, rgb(220 79 66 / .55) 100%);z-index:4`, [
        { opacity: 0.2, clipPath: 'inset(0 0 0 100%)', easing: 'cubic-bezier(.5, 0, .9, .5)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.45, easing: 'ease-out' },
        { opacity: 0, clipPath: 'inset(0 85% 0 0)' },
      ], { duration: 430, delay: AFTER_SLIDE, easing: 'linear' });
    }
  }

  if (kingCell && mate) {
    const pc = kingCell.querySelector('.pc');
    if (pc) {
      pc.style.transformOrigin = '50% 62%'; // low enough to tip over its base, high enough to stay on its square
      pc.style.zIndex = 2;
      run(pc, [
        { transform: 'rotate(0)', easing: 'ease-out' },
        { transform: 'rotate(9deg)', offset: 0.22, easing: 'cubic-bezier(.6, 0, .9, .4)' },
        { transform: 'rotate(-96deg)', offset: 0.72, easing: 'ease-out' },
        { transform: 'rotate(-84deg)', offset: 0.86, easing: 'ease-in' },
        { transform: 'rotate(-90deg)' },
      ], { duration: 950, delay: AFTER_SLIDE + 80, easing: 'linear', hold: true });
    }
    for (const delay of [820, 1000]) {
      shape(kingCell, `inset:0;border-radius:50%;border:0.14em solid ${RED}`, [
        { opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(7)' },
      ], { duration: 1000, delay });
    }
  } else if (kingCell) {
    shape(kingCell, `inset:0;background:${RED}`, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 500, delay: HIT });
    for (const [delay, width] of [[HIT, 0.16], [HIT + 140, 0.09]]) {
      shape(kingCell, `inset:0;border-radius:50%;border:${width}em solid ${RED}`, [
        { opacity: 1, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(3.4)' },
      ], { duration: 750, delay });
    }
    const kpc = kingCell.querySelector('.pc');
    if (kpc) kpc.style.zIndex = 3;
    // The king jumps at the hit, then shakes it off.
    run(kpc, [
      { transform: 'translate(0, 0) scale(1) rotate(0)' },
      { transform: 'translate(0, -22%) scale(1.22) rotate(-8deg)', offset: 0.16 },
      { transform: 'translate(-8%, 0) scale(1) rotate(7deg)', offset: 0.36 },
      { transform: 'translate(8%, 0) rotate(-6deg)', offset: 0.52 },
      { transform: 'translate(-6%, 0) rotate(4deg)', offset: 0.68 },
      { transform: 'translate(4%, 0) rotate(-2deg)', offset: 0.84 },
      { transform: 'translate(0, 0) rotate(0)' },
    ], { duration: 720, delay: HIT, easing: 'ease-out' });
  }

  const cell = label && cellOf(label.sq);
  if (!cell) return;
  const badge = cell.querySelector('.badge');
  const pc = cell.querySelector('.pc');
  const w = cell.getBoundingClientRect().width;

  if (label.l === 'brilliant') {
    shape(cell, 'inset:0;border-radius:50%;border:0.12em solid var(--l)', [
      { opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(2.8)' },
    ], { duration: 750, delay: AFTER_SLIDE });
    shape(cell, 'inset:0;background:linear-gradient(115deg, transparent 38%, rgb(255 255 255 / .7) 50%, transparent 62%) 0 0 / 300% 100% no-repeat', [
      { opacity: 1, backgroundPosition: '130% 0' }, { opacity: 1, backgroundPosition: '-30% 0' },
    ], { duration: 700, delay: AFTER_SLIDE + 60, easing: 'ease-in-out' });
    const SPARKS = 12;
    for (let i = 0; i < SPARKS; i++) {
      const angle = (i / SPARKS) * Math.PI * 2 + 0.3;
      const far = w * (i % 2 ? 1.55 : 1.05);
      const size = i % 3 ? 11 : 16;
      shape(cell, `left:50%;top:50%;width:${size}%;height:${size}%;margin:-${size / 2}%;background:${i % 3 ? 'var(--l)' : '#fff'};clip-path:polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);z-index:4`, [
        { opacity: 1, transform: 'translate(0, 0) scale(.4) rotate(0)' },
        { opacity: 1, transform: `translate(${Math.cos(angle) * far * 0.8}px, ${Math.sin(angle) * far * 0.8}px) scale(1.2) rotate(90deg)`, offset: 0.55 },
        { opacity: 0, transform: `translate(${Math.cos(angle) * far}px, ${Math.sin(angle) * far}px) scale(0) rotate(180deg)` },
      ], { duration: 850 + (i % 4) * 60, delay: AFTER_SLIDE + 40 + (i % 3) * 30 });
    }
    run(pc, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-14%) scale(1.1)', offset: 0.4 }, { transform: 'translateY(0) scale(1)' }], { duration: 480, delay: AFTER_SLIDE, easing: 'ease-in-out' });
    run(badge, [{ transform: 'scale(0) rotate(-60deg)' }, { transform: 'scale(1.35) rotate(8deg)', offset: 0.6 }, { transform: 'scale(1) rotate(0)' }], { duration: 560, delay: AFTER_SLIDE });
  } else if (label.l === 'blunder') {
    const SLAM = AFTER_SLIDE + 260; // when the badge hits
    run(badge, [
      { transform: 'translateY(-90%) scale(2.6)', opacity: 0, easing: 'cubic-bezier(.7, 0, 1, .6)' },
      { transform: 'translateY(0) scale(.82)', opacity: 1, offset: 0.62, easing: 'ease-out' },
      { transform: 'translateY(0) scale(1)', opacity: 1 },
    ], { duration: 420, delay: AFTER_SLIDE, easing: 'linear' });
    shape(cell, `inset:0;background:${RED}`, [{ opacity: 0.75 }, { opacity: 0 }], { duration: 600, delay: SLAM });
    shape(cell, `inset:0;border-radius:50%;border:0.12em solid ${RED}`, [
      { opacity: 0.9, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(2.4)' },
    ], { duration: 600, delay: SLAM });
    run(pc, ['0, 0', '-7%, 2%', '6%, -1%', '-5%, 1%', '3%, 0', '0, 0'].map((x, i) => ({ transform: `translate(${x}) rotate(${[0, -6, 5, -3, 2, 0][i]}deg)` })), { duration: 460, delay: SLAM, easing: 'ease-out' });
    // Three chips fly off the badge's corner.
    for (let i = 0; i < 3; i++) {
      const dx = [-0.5, 0.15, 0.55][i] * w, spin = [-200, 140, 260][i];
      shape(cell, `right:8%;top:8%;width:13%;height:13%;background:${RED};clip-path:polygon(50% 0, 100% 100%, 0 80%);z-index:4`, [
        { opacity: 1, transform: 'translate(0, 0) rotate(0)', easing: 'ease-out' },
        { opacity: 1, transform: `translate(${dx * 0.6}px, ${-w * 0.35}px) rotate(${spin / 2}deg)`, offset: 0.35, easing: 'ease-in' },
        { opacity: 0, transform: `translate(${dx}px, ${w * 0.9}px) rotate(${spin}deg)` },
      ], { duration: 750, delay: SLAM, easing: 'linear' });
    }
    // The whole board takes the hit, once (it isn't redrawn, so it needs no picking up).
    if (fresh && !calm.matches && board.animate) {
      board.animate(['0, 0', '3px, 2px', '-3px, -1px', '2px, 1px', '0, 0'].map((x) => ({ transform: `translate(${x})` })), { duration: 280, delay: SLAM, easing: 'ease-out' });
    }
  } else {
    run(badge, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, delay: AFTER_SLIDE - 40 });
  }
}
