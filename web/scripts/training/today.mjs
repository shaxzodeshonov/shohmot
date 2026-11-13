// The top of the Training page: the coach's session (your last few games,
// lined up for a start-to-end review) and the day so far against yesterday.
// The words and numbers are worked out by pure functions here; page.js draws them.
import { session, startSession, picksFrom, reviewUrl, today, yesterday, lastDays, streak, minutes, clock, MIN_PER_GAME } from './focus.mjs';
import { checkedGames, itemsOf, LEARNED } from './store.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SPEED = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily', classical: 'Classical' };

export function gameTitle(g) {
  const o = g.o || 'your opponent';
  return g.r === 'loss' ? `Lost to ${o}` : g.r === 'win' ? `Beat ${o}` : g.r === 'draw' ? `Drew with ${o}` : `Game vs ${o}`;
}
const gameNoun = (g) => (g.r === 'loss' ? 'loss to' : g.r === 'win' ? 'win over' : g.r === 'draw' ? 'draw with' : 'game vs');

// Pure: what the coach says. s is focus.session() or null, picks is what a new
// session would hold, toTrain the positions waiting from the session's games.
export function coachSays(s, picks, toTrain = 0) {
  if (s && !s.complete) {
    const left = s.total - s.done;
    return {
      state: 'going',
      say: s.done ? `${s.done} of ${s.total} reviewed. ${plural(left, 'game')} to go.` : `Your ${plural(s.total, 'game')} ${s.total === 1 ? 'is' : 'are'} waiting.`,
      sub: `Next: your ${gameNoun(s.next)} ${s.next.o || 'your opponent'}. Go through it move by move, to the last move.`,
      go: { label: s.done ? 'Continue the review' : 'Start the review', href: reviewUrl(s.next) },
    };
  }
  if (s && s.complete && s.total) {
    return {
      state: 'done',
      say: `${s.total === 1 ? 'Game' : `All ${s.total} games`} reviewed. Good work.`,
      sub: toTrain ? `Now fix what we found: ${plural(toTrain, 'position')} from ${s.total === 1 ? 'this game' : 'these games'} ${toTrain === 1 ? 'is' : 'are'} waiting below.` : 'You’ve been through every move. Come back after your next games.',
      go: toTrain ? { label: `Train ${toTrain === 1 ? 'this position' : `these ${toTrain} positions`}`, href: '#tr-main' } : null,
      more: picks.length ? { label: `Review ${picks.length === 1 ? 'one more game' : `${picks.length} more games`}` } : null,
    };
  }
  if (picks.length) {
    const n = picks.length;
    const mistakes = picks.reduce((sum, g) => sum + g.n, 0);
    const losses = picks.filter((g) => g.r === 'loss').length;
    const lost = !losses ? '' : losses === n ? (n === 1 ? ', and lost it' : `, and lost ${n === 2 ? 'both' : `all ${n}`}`) : `, and lost ${losses} of them`;
    return {
      state: 'new',
      say: `You made ${plural(mistakes, 'mistake')} in your last ${n === 1 ? 'game' : `${n} games`}${lost}.`,
      sub: `Let’s review ${n === 1 ? 'it' : `all ${n}`}, start to end. About ${n * MIN_PER_GAME} minutes, and every mistake becomes a position to train.`,
      go: { label: 'Start the review', href: reviewUrl(picks[0]) },
    };
  }
  return {
    state: 'empty',
    say: 'No games to review yet.',
    sub: 'Play with the counter open, or check your older losses below, and I’ll line your games up here.',
    go: { label: 'Check my older losses', href: '#tr-old-h' },
  };
}

// Pure: the sentence above the bars. y and t are days ({ t, g, p }).
export function daySays(y, t) {
  const yMin = Math.floor(y.t / 60), tMin = Math.floor(t.t / 60);
  const did = (d, min) => [min ? `focused for ${minutes(d.t)}` : '', d.g ? `reviewed ${plural(d.g, 'game')}` : '', d.p ? `solved ${plural(d.p, 'position')}` : ''].filter(Boolean);
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
  const yDid = did(y, yMin), tDid = did(t, tMin);
  if (!yDid.length && !tDid.length) return 'Your first minutes today set the mark to beat tomorrow.';
  if (!yDid.length) return `Today you ${list(tDid)}. Nothing yesterday, so today already wins.`;
  const first = `Yesterday you ${list(yDid)}.`;
  if (!tDid.length) return `${first} Today hasn’t started yet.`;
  if (tMin > yMin || (tMin === yMin && t.g + t.p > y.g + y.p)) return `${first} Today you ${list(tDid)}: you’ve beaten yesterday.`;
  const gap = yMin - tMin;
  return `${first} Today you ${list(tDid)}${gap > 0 ? `: ${gap} more min to beat yesterday` : ''}.`;
}

// ---------- drawing ----------
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function gameRow(g, i, nextKey) {
  const bits = [SPEED[g.sp] || '', plural(g.n, 'mistake'), g.acc != null ? `accuracy ${Math.round(g.acc)}` : ''].filter(Boolean).join(' · ');
  const state = g.done ? 'done' : g.key === nextKey ? 'next' : 'todo';
  return `<li data-state="${state}"><a href="${esc(reviewUrl(g))}" data-astro-prefetch="false">
    <span class="tr-g-n">${g.done ? CHECK : i + 1}</span>
    <span class="tr-g-t"><b data-r="${esc(g.r || '')}">${esc(gameTitle(g))}</b><small>${esc(bits)}</small></span>
    <span class="tr-g-go">${g.done ? 'Reviewed' : 'Review'}</span>
  </a></li>`;
}

// Positions still to train from the session's games.
const waiting = (s) => (s ? s.games.reduce((n, g) => n + itemsOf(g.key).filter((it) => it.box < LEARNED && it.due <= Date.now()).length, 0) : 0);

export function drawCoach(root) {
  const s = session();
  const picks = picksFrom(checkedGames());
  const fresh = picks.filter((g) => !(s && s.games.some((x) => x.key === g.key)));
  const c = coachSays(s, s ? fresh : picks, waiting(s));
  const games = s ? s.games : picks.map((g) => ({ ...g, done: false }));
  const nextKey = s ? (s.next && s.next.key) : games[0] && games[0].key;
  const done = s ? s.done : 0;
  root.dataset.state = c.state;
  root.querySelector('#tr-coach-say').textContent = c.say;
  root.querySelector('#tr-coach-sub').textContent = c.sub;
  const bar = root.querySelector('#tr-session-bar');
  bar.hidden = !games.length;
  bar.querySelector('i').style.width = `${games.length ? (done / games.length) * 100 : 0}%`;
  bar.setAttribute('aria-valuenow', String(done));
  bar.setAttribute('aria-valuemax', String(games.length));
  bar.setAttribute('aria-valuetext', `${done} of ${games.length} games reviewed`);
  root.querySelector('#tr-games').innerHTML = games.map((g, i) => gameRow(g, i, nextKey)).join('');
  root.querySelector('#tr-coach-actions').innerHTML = [
    c.go ? `<a class="btn btn-solid" id="tr-session-go" href="${esc(c.go.href)}" data-astro-prefetch="false">${esc(c.go.label)}</a>` : '',
    c.more ? `<button class="btn" type="button" id="tr-session-more">${esc(c.more.label)}</button>` : '',
  ].join('');
  return c;
}

// The coach's card starts a session the moment you head into a game.
export function wireCoach(root, { onChange = () => {} } = {}) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('#tr-session-more')) { startSession(checkedGames()); onChange(); return; }
    const a = e.target.closest('a[href^="/review.html"]');
    if (a && !session()) startSession(checkedGames());
  });
}

function cmpRow(title, y, t, fmt) {
  const max = Math.max(y, t, 1);
  const row = (cls, name, v) => `<p class="${cls}"><span>${name}</span><i style="--w:${(v / max) * 100}%"></i><b>${esc(fmt(v))}</b></p>`;
  return `<div class="tr-cmp-row"><h3>${title}</h3>${row('was', 'Yesterday', y)}${row('now', 'Today', t)}</div>`;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };

export function drawDay(root, seconds = today().t) {
  const y = yesterday();
  const t = { ...today(), t: seconds };
  root.querySelector('#tr-day-say').textContent = daySays(y, t);
  root.querySelector('#tr-cmp').innerHTML =
    cmpRow('Focus time', y.t, t.t, (v) => minutes(v))
    + cmpRow('Games reviewed', y.g, t.g, String)
    + cmpRow('Positions solved', y.p, t.p, String);
  const days = lastDays(7);
  days[days.length - 1].t = seconds;
  const max = Math.max(600, ...days.map((d) => d.t));
  root.querySelector('#tr-week').innerHTML = days.map((d, i) => {
    const name = longDay.format(dateOf(d.key));
    return `<li${i === days.length - 1 ? ' class="now"' : ''} title="${esc(name)}: ${esc(minutes(d.t))}"><i style="--h:${d.t ? Math.max(8, (d.t / max) * 100) : 0}%"></i><span aria-hidden="true">${esc(weekday.format(dateOf(d.key)).slice(0, 2))}</span><span class="sr-only">${esc(name)}: ${esc(minutes(d.t))}</span></li>`;
  }).join('');
  const n = streak();
  const st = root.querySelector('#tr-streak');
  st.hidden = n < 2;
  st.textContent = `${n} days in a row`;
}

export const drawClock = (root, seconds) => { root.querySelector('#tr-clock').textContent = clock(seconds); };
