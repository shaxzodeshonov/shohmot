// The top bar's options menu (a <details>): it closes when you click outside
// it, press Escape, or follow one of its links. It also holds the sound-style
// picker, which plays the new style when you change it.
import { STYLES, getStyle, setStyle, play } from './sound.mjs';

const menu = document.getElementById('opts');
if (menu) {
  addEventListener('pointerdown', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    menu.querySelector('summary').focus();
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.open = false; });
}

const pick = document.getElementById('sound-style');
if (pick) {
  for (const [id, s] of Object.entries(STYLES)) pick.add(new Option(s.name, id));
  pick.value = getStyle();
  pick.addEventListener('change', () => {
    setStyle(pick.value);
    // A move, then a capture, so the style can be judged at once.
    play('move');
    setTimeout(() => play('capture'), 420);
    setTimeout(() => play('check'), 900);
  });
}
