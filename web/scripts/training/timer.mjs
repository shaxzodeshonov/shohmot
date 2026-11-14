// The focus timer: counts the seconds you're actually training. It runs while
// the page is on screen and you've touched it in the last IDLE seconds, so a
// tab left open over lunch doesn't count. Seconds go to focus.mjs every few
// ticks and when the page is left.
import { addSeconds, today } from './focus.mjs';

const IDLE = 90000;
const FLUSH = 5;

// onTick(secondsToday, running) is called each second.
export function startTimer(onTick = () => {}) {
  let lastActive = Date.now();
  let pending = 0;
  let base = today().t;
  const active = () => { lastActive = Date.now(); };
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  for (const e of events) addEventListener(e, active, { passive: true });

  const flush = () => {
    if (!pending) return;
    base = addSeconds(pending).t;
    pending = 0;
  };
  const running = () => document.visibilityState === 'visible' && Date.now() - lastActive < IDLE;
  const tick = () => {
    const on = running();
    if (on) pending++;
    if (pending >= FLUSH) flush();
    onTick(base + pending, on);
  };
  const id = setInterval(tick, 1000);
  const onHide = () => flush();
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  onTick(base, running());

  return {
    seconds: () => base + pending,
    stop() {
      clearInterval(id);
      flush();
      for (const e of events) removeEventListener(e, active);
      removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}
