// The avatar designer on the Settings page: a preview of you and of the robot
// double that will be made from you, and one row of choices per part. Every
// change is saved at once (in this browser).
import { PARTS, avatarSvg, avatarFor, randomAvatar, savedAvatar, saveAvatar } from './avatar.mjs';

export function avatarDesigner(root, { name = 'you' } = {}) {
  let cfg = savedAvatar() || avatarFor(name);

  const rows = Object.entries(PARTS).map(([key, part]) => {
    const choices = part.swatches
      ? part.swatches.map((c, i) => `<button type="button" class="av-swatch" data-k="${key}" data-v="${i}" style="--c:${c}" aria-label="${part.name} ${i + 1}"></button>`)
      : part.options.map((o, i) => `<button type="button" class="av-chip" data-k="${key}" data-v="${i}">${o}</button>`);
    return `<div class="av-row" role="group" aria-label="${part.name}"><span class="av-row-name">${part.name}</span><div class="av-choices">${choices.join('')}</div></div>`;
  }).join('');

  root.innerHTML = `
    <div class="av-preview">
      <figure><div class="av-face" id="av-you"></div><figcaption>You</figcaption></figure>
      <svg class="av-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <figure><div class="av-face" id="av-bot"></div><figcaption>Your double</figcaption></figure>
    </div>
    <div class="av-rows">${rows}
      <div class="av-row"><span class="av-row-name"></span><div class="av-choices"><button type="button" class="btn" id="av-shuffle">Shuffle</button><span class="muted small" id="av-saved" aria-live="polite">Kept in this browser.</span></div></div>
    </div>`;

  const draw = () => {
    root.querySelector('#av-you').innerHTML = avatarSvg(cfg, { label: 'Your avatar' });
    root.querySelector('#av-bot').innerHTML = avatarSvg(cfg, { robot: true, label: 'Your robot double' });
    for (const b of root.querySelectorAll('[data-k]')) b.setAttribute('aria-pressed', String(cfg[b.dataset.k] === Number(b.dataset.v)));
  };
  const changed = () => {
    saveAvatar(cfg);
    draw();
    root.querySelector('#av-saved').textContent = 'Saved.';
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) { cfg = { ...cfg, [b.dataset.k]: Number(b.dataset.v) }; changed(); return; }
    if (e.target.closest('#av-shuffle')) { cfg = randomAvatar(); changed(); }
  });
  draw();
}
