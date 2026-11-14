// On the review page: the training session's strip ("Game 2 of 5", the focus
// clock, how much of the game you've been through, and the way to the next
// game), and the bookkeeping behind it. Any of your own games you go through
// start to end counts as reviewed for the day, in a session or not.
//
// review.mjs says where the board is with a `shohmot:review` event:
// { key, ply, total, ready (the analysis is done), mine (a game of your own) }.
import { session, markReviewed, wasReviewed, reviewUrl, clock } from './focus.mjs';
import { startTimer } from './timer.mjs';
import { track } from '../track.js';

const $ = (s) => document.querySelector(s);
const inSession = new URLSearchParams(location.search).has('session');
// Opened from Training: the strip says which game this is, so the game's
// title, details and share buttons step aside (review.css).
if (inSession) document.documentElement.dataset.session = '1';
const signedIn = () => document.cookie.split('; ').includes('shohmot_in=1');
// Going through a game means seeing most of it, not pressing End.
const ENOUGH = 0.6;

let seen = new Set();
let key = null;
let done = false;
let timer = null;

function nextStop() {
  const s = session();
  if (!s) return { href: '/train.html', last: true };
  const i = s.games.findIndex((g) => g.key === key);
  const after = [...s.games.slice(i + 1), ...s.games.slice(0, Math.max(0, i))].find((g) => !g.done && g.key !== key);
  return after ? { href: reviewUrl(after), last: false, game: after } : { href: '/train.html?session=done', last: true };
}

function draw(d) {
  const el = $('#rv-session');
  if (!el || !inSession) return;
  const s = session();
  el.hidden = false;
  const i = s ? s.games.findIndex((g) => g.key === key) : -1;
  $('#rv-session-n').textContent = s && i >= 0 ? `Game ${i + 1} of ${s.total}` : 'Training session';
  const share = d.total ? Math.min(1, seen.size / (d.total + 1)) : 0;
  $('#rv-session-bar').style.width = `${(done ? 1 : share) * 100}%`;
  el.dataset.done = done ? '1' : '0';
  const stop = nextStop();
  const next = $('#rv-session-next');
  next.href = stop.href;
  next.classList.toggle('btn-solid', done);
  next.textContent = done ? (stop.last ? 'Finish the session' : 'Next game') : (stop.last ? 'Skip to the end' : 'Skip this game');
  const left = Math.max(0, Math.ceil((d.total + 1) * ENOUGH) - seen.size);
  $('#rv-session-say').textContent = done
    ? (stop.last ? 'Reviewed. That was the last game.' : `Reviewed. Next: your game vs ${stop.game.o || 'your opponent'}.`)
    : !d.ready ? 'Stockfish is still checking the moves. Start stepping through.'
      : d.ply >= d.total && left ? `Step through the moves, not just the end: ${left} more to go.`
        : 'Go through it move by move, to the last move.';
}

document.addEventListener('shohmot:review', (e) => {
  const d = e.detail;
  if (!d.mine || !signedIn()) return;
  if (d.key !== key) { key = d.key; seen = new Set(); done = wasReviewed(key); }
  seen.add(d.ply);
  // Focus time counts here only for a review started from Training.
  if (!timer && inSession) timer = startTimer((sec) => { const c = $('#rv-session-clock'); if (c) c.textContent = clock(sec); });
  if (!done && d.ready && d.ply >= d.total && seen.size >= (d.total + 1) * ENOUGH) {
    done = true;
    if (markReviewed(key)) track('game_reviewed_through');
  }
  draw(d);
});
