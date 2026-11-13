import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reset, dayKey, dayBefore, addSeconds, addSolved, today, yesterday, lastDays, streak, pickGames, startSession, session, markReviewed, minutes, clock } from '../web/scripts/training/focus.mjs';
import { coachSays, daySays } from '../web/scripts/training/today.mjs';

const NOON = new Date(2026, 10, 13, 12).getTime();
const DAY = 86400000;
const games = {
  'lichess:a': { e: NOON - 1000, u: 'me', o: 'Ann', r: 'loss', n: 3, sp: 'blitz', acc: 71 },
  'lichess:b': { e: NOON - 2000, u: 'me', o: 'Bob', r: 'win', n: 1 },
  'lichess:c': { e: NOON - 3000, u: 'me', o: 'Cy', r: 'loss', n: 0 },
  'chesscom:d': { e: NOON - 500, u: 'me', o: 'Di', r: 'loss', n: 2 },
};

beforeEach(reset);

test('days are local dates, and the day before crosses months', () => {
  assert.equal(dayKey(NOON), '2026-11-13');
  assert.equal(dayBefore('2026-11-01'), '2026-10-31');
  assert.equal(dayBefore('2026-01-01'), '2025-12-31');
});

test('focus time and solved positions are kept by day', () => {
  addSeconds(600, NOON - DAY);
  addSeconds(120, NOON);
  addSolved(NOON);
  assert.deepEqual(yesterday(NOON), { t: 600, g: 0, p: 0 });
  assert.deepEqual(today(NOON), { t: 120, g: 0, p: 1 });
  const week = lastDays(7, NOON);
  assert.equal(week.length, 7);
  assert.equal(week[6].key, '2026-11-13');
  assert.equal(week[5].t, 600);
  assert.equal(streak(NOON), 2);
  assert.equal(streak(NOON + 2 * DAY), 0);
});

test('the session takes the newest games with mistakes, and skips reviewed ones', () => {
  assert.deepEqual(pickGames(games).map((g) => g.key), ['chesscom:d', 'lichess:a', 'lichess:b']);
  assert.deepEqual(pickGames(games, { 'lichess:a': 1 }, 1).map((g) => g.key), ['chesscom:d']);
  let s = startSession(games, NOON);
  assert.equal(s.total, 3);
  assert.equal(s.next.key, 'chesscom:d');
  assert.equal(markReviewed('chesscom:d', NOON), true);
  assert.equal(markReviewed('chesscom:d', NOON), false); // counts once
  s = session(NOON);
  assert.equal(s.done, 1);
  assert.equal(s.next.key, 'lichess:a');
  assert.equal(today(NOON).g, 1);
  markReviewed('lichess:a', NOON);
  markReviewed('lichess:b', NOON);
  assert.equal(session(NOON).complete, true);
  assert.equal(session(NOON + DAY), null); // a new day, a new session
});

test('the coach says what to do next', () => {
  const picks = pickGames(games);
  const fresh = coachSays(null, picks);
  assert.equal(fresh.say, 'You made 6 mistakes in your last 3 games, and lost 2 of them.');
  assert.match(fresh.sub, /About 15 minutes/);
  startSession(games, NOON);
  markReviewed('chesscom:d', NOON);
  const going = coachSays(session(NOON), []);
  assert.equal(going.say, '1 of 3 reviewed. 2 games to go.');
  assert.match(going.sub, /loss to Ann/);
  markReviewed('lichess:a', NOON);
  markReviewed('lichess:b', NOON);
  const done = coachSays(session(NOON), [], 4);
  assert.equal(done.state, 'done');
  assert.equal(done.go.label, 'Train these 4 positions');
  assert.equal(coachSays(null, []).state, 'empty');
});

test('today is compared with yesterday', () => {
  const none = { t: 0, g: 0, p: 0 };
  assert.match(daySays(none, none), /first minutes/);
  assert.equal(daySays({ t: 1080, g: 3, p: 0 }, { t: 360, g: 1, p: 0 }), 'Yesterday you focused for 18 min and reviewed 3 games. Today you focused for 6 min and reviewed 1 game: 12 more min to beat yesterday.');
  assert.match(daySays({ t: 600, g: 0, p: 0 }, { t: 900, g: 0, p: 2 }), /beaten yesterday/);
  assert.match(daySays({ t: 600, g: 0, p: 0 }, none), /hasn’t started/);
});

test('times read well', () => {
  assert.equal(minutes(59), '0 min');
  assert.equal(minutes(4320), '1 h 12 min');
  assert.equal(clock(252), '04:12');
  assert.equal(clock(3852), '1:04:12');
});
