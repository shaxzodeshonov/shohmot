// Fischer's blink, on the portrait (web/assets/fil.webp).
//
// Each eye's upper lid is drawn as a shape between two curves traced from the
// drawing: its own lash line (where the lid rests, eye open) and the lower
// lid (where it lands, eye shut). A blink slides the lid's edge from one curve
// to the other, so it follows the eye's real outline instead of a flat patch
// dropping over it, and carries the dark lash line down with it. Open, nothing
// is drawn at all: the portrait is untouched.
//
// Timing is a person's: the lid drops fast (about 90 ms), rests a moment and
// lifts more slowly (about 190 ms); blinks come every 2.5 to 6.5 seconds, never
// on a beat, now and then two in a row, and one when the head moves.

// In the portrait's own pixels (256 x 256). a is the outer corner, b the inner;
// top and low are the control points of the lash line and of the lower lid.
export const EYES = {
  l: { a: [85.5, 119.5], b: [113.5, 121], top: [[86, 107], [113, 109]], low: [[90, 124.6], [106, 125.6]] },
  r: { a: [176.5, 119.5], b: [146.5, 121], top: [[176, 107], [149, 109]], low: [[172, 124.6], [156, 125.6]] },
};
// The lid's skin starts a little above the lash line, so it covers the drawn lashes as it comes down.
const COVER = 1.7;

const CLOSE = 90, HOLD = 40, OPEN = 190;
const n = (v) => Math.round(v * 100) / 100;
const pt = (p) => `${n(p[0])} ${n(p[1])}`;
const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const up = (p, d) => [p[0], p[1] - d];

// Pure: the two paths of one eye, `shut` from 0 (open) to 1 (closed).
export function lidPaths(eye, shut) {
  const c1 = mix(eye.top[0], eye.low[0], shut), c2 = mix(eye.top[1], eye.low[1], shut);
  const lash = `M${pt(eye.a)}C${pt(c1)} ${pt(c2)} ${pt(eye.b)}`;
  const skin = `M${pt(up(eye.a, COVER * 0.4))}C${pt(up(eye.top[0], COVER))} ${pt(up(eye.top[1], COVER))} ${pt(up(eye.b, COVER * 0.4))}L${pt(eye.b)}C${pt(c2)} ${pt(c1)} ${pt(eye.a)}Z`;
  return { lash, skin };
}

// Pure: how shut the eyes are `ms` into a blink (0 once it's over).
export function shutAt(ms) {
  if (ms < 0 || ms >= CLOSE + HOLD + OPEN) return 0;
  if (ms < CLOSE) { const t = ms / CLOSE; return t * t * (3 - 2 * t); } // quick, easing into the lower lid
  if (ms < CLOSE + HOLD) return 1;
  const t = (ms - CLOSE - HOLD) / OPEN;
  return (1 - t) ** 3;
}
export const BLINK_MS = CLOSE + HOLD + OPEN;

// svg: the <svg class="fil-eyes"> over the portrait, holding one
// <g data-eye="l|r"><path class="fil-lidskin"/><path class="fil-lash"/></g> per eye.
export function wireEyes(svg, { still = false, canBlink = () => true } = {}) {
  if (!svg || still) return { blink() {} };
  const eyes = [...svg.querySelectorAll('[data-eye]')].map((g) => ({
    g, shape: EYES[g.dataset.eye], skin: g.querySelector('.fil-lidskin'), lash: g.querySelector('.fil-lash'),
  }));
  let started = 0;   // when the blink under way began (0: none)
  let again = false; // a second blink follows this one
  let last = 0;
  let timer = 0;

  const draw = (shut) => {
    for (const e of eyes) {
      if (shut <= 0.001) { e.g.style.visibility = 'hidden'; continue; }
      const d = lidPaths(e.shape, shut);
      e.skin.setAttribute('d', d.skin);
      e.lash.setAttribute('d', d.lash);
      e.g.style.visibility = 'visible';
    }
  };
  const frame = (now) => {
    const ms = now - started;
    if (ms >= BLINK_MS) {
      draw(0);
      started = 0;
      last = now;
      if (again) { again = false; setTimeout(start, 110 + Math.random() * 90); }
      return;
    }
    draw(shutAt(ms));
    requestAnimationFrame(frame);
  };
  function start() {
    if (started || document.hidden || !canBlink()) return;
    started = performance.now();
    requestAnimationFrame(frame);
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      again = Math.random() < 0.16;
      start();
      schedule();
    }, 2500 + Math.random() * 4000);
  };
  draw(0);
  schedule();

  return {
    // A blink now (the head just moved), unless one has only just happened.
    blink() {
      if (started || performance.now() - last < 900) return;
      start();
      schedule();
    },
  };
}
