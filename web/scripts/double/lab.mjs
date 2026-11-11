// The cloning lab on the play-yourself page. While the games are read, the
// player's avatar is scanned and data runs across to an empty pod; then the
// robot double is cast there (a wireframe first, steel rising up through it
// behind a weld line), switches on, and its rating and specifications are read out.
//
// showLab(root, name)   the two pods at rest: your avatar and the empty pod
// const lab = openLab(root, name, specsRoot)
//   lab.say(text)         the line under the pods
//   await lab.finish(p)   cast the robot and show the specs for profile p
//   lab.close()           something went wrong: put the lab away
import { avatarSvg, avatarFor, savedAvatar } from '../avatar.mjs';

const calm = matchMedia('(prefers-reduced-motion: reduce)');
export const pause = (ms) => new Promise((r) => setTimeout(r, calm.matches ? 0 : ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The face a double is made from: the one designed in Settings, or one drawn from the name.
export const faceOf = (name) => savedAvatar() || avatarFor(name);

const SCAN_MS = 1600; // the least time the scan is shown, even when the games are already known
const CAST_MS = 2600;

function specs(p, model) {
  const s = p.stats;
  const pct = (x) => Math.max(0, Math.min(100, Math.round(x)));
  const gauges = [
    ['Aggression', pct(p.aggression * 100), 'How often it goes for captures and checks'],
    ['Captures', pct(s.captureRate * 250), `${Math.round(s.captureRate * 100)}% of its moves take something`],
    ['Checks', pct(s.checkRate * 700), `${Math.round(s.checkRate * 100)}% of its moves give check`],
    ['King safety', pct(s.castleRate * 100), `Castles in ${Math.round(s.castleRate * 100)}% of games`],
    ['Simplifying', pct(s.queenTradeRate * 100), `Trades queens early in ${Math.round(s.queenTradeRate * 100)}% of games`],
    ['Stamina', pct((s.avgMoves / 70) * 100), `Its games last ${Math.round(s.avgMoves)} moves on average`],
  ];
  const leds = (v, i) => Array.from({ length: 10 }, (_, j) => `<i${j < Math.round(v / 10) ? ` class="on" style="--i:${i};--j:${j}"` : ''}></i>`).join('');
  return `
    <div class="spec">
      <div class="spec-elo" style="--n:0">
        <small>${esc(model)} · playing strength in ${esc(p.speed)}</small>
        <p><strong id="spec-elo" aria-label="${p.rating} Elo">0</strong><span aria-hidden="true">Elo</span></p>
        <em>${esc(p.style)} player, cast from ${p.games} of your games</em>
      </div>
      <dl class="spec-gauges" style="--n:1">${gauges.map(([name, v, why], i) => `
        <div title="${esc(why)}"><dt>${name}</dt><dd><span class="leds" aria-hidden="true">${leds(v, i)}</span><b>${v}</b></dd></div>`).join('')}
      </dl>
      ${p.traits.length ? `<div class="spec-mods" style="--n:2"><h3>Habits it copied from you</h3><ul>${p.traits.map((t) => `<li><b>${esc(t.name)}</b><span>${esc(t.text)}</span></li>`).join('')}</ul></div>` : ''}
    </div>`;
}

const modelOf = (name) => `${String(name).toUpperCase()}-2`;

function draw(root, name, phase, line) {
  const cfg = faceOf(name);
  const model = modelOf(name);
  root.dataset.phase = phase;
  root.innerHTML = `
    <div class="lab-stage">
      <figure class="pod pod-you">
        <div class="pod-glass">${avatarSvg(cfg, { label: `${name}'s avatar` })}<i class="scan"></i></div>
        <figcaption>You<b>${name === 'you' ? 'The original' : esc(name)}</b></figcaption>
      </figure>
      <div class="lab-mid" aria-hidden="true"><div class="lab-link">${[0, 1, 2, 3].map((i) => `<i style="--i:${i}"></i>`).join('')}</div><b class="lab-vs">VS</b></div>
      <figure class="pod pod-bot">
        <div class="pod-glass"><div class="wire">${avatarSvg(cfg, { robot: true })}</div><div class="bot-fill">${avatarSvg(cfg, { robot: true, label: `${name}'s robot double` })}</div><i class="weld"></i></div>
        <figcaption>Your double<b>${phase === 'idle' ? '???? Elo' : esc(model)}</b></figcaption>
      </figure>
    </div>
    <p class="lab-log" aria-live="polite">${esc(line)}</p>`;
}

export function showLab(root, name) {
  draw(root, name || 'you', 'idle', '');
}

export function openLab(root, name, specsRoot) {
  const model = modelOf(name);
  draw(root, name, calm.matches ? 'live' : 'scan', `Scanning ${name}…`);
  specsRoot.hidden = true;
  const log = root.querySelector('.lab-log');
  const started = Date.now();

  return {
    say(text) { log.textContent = text; },
    async finish(profile) {
      // The scan is seen for a moment even when the games were already known.
      await pause(Math.max(0, SCAN_MS - (Date.now() - started)));
      if (!calm.matches) {
        root.dataset.phase = 'cast';
        log.textContent = `Casting ${model} from ${profile.games} games…`;
        await pause(CAST_MS);
      }
      root.dataset.phase = 'live';
      log.textContent = `${model} is online.`;
      specsRoot.innerHTML = specs(profile, model);
      specsRoot.hidden = false;
      // The rating runs up as the robot reports it.
      const elo = specsRoot.querySelector('#spec-elo');
      if (calm.matches) { elo.textContent = profile.rating; return; }
      const t0 = performance.now() + 300;
      const step = (now) => {
        if (!elo.isConnected) return;
        const k = Math.min(1, Math.max(0, (now - t0) / 1300));
        elo.textContent = Math.round(profile.rating * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    close() { specsRoot.hidden = true; showLab(root, name); },
  };
}
