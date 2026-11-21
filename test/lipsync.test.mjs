// Fischer's lip sync (web/scripts/review/lipsync.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordVisemes, timeline, createLipSync, levelStep, shapeForStep, HOLD_MS } from '../web/scripts/review/lipsync.mjs';

// A player on a fake clock: step(ms) moves time on and runs the next frame.
function player(opts = {}) {
  let t = 0;
  const frames = [];
  const shown = [];
  const lip = createLipSync((v) => shown.push([t, v]), { now: () => t, frame: (fn) => { frames.push(fn); return frames.length; }, cancel: () => {}, ...opts });
  const step = (ms) => { t += ms; frames.splice(0).forEach((f) => f()); };
  return { lip, shown, step, now: () => t };
}

test('with the recording, the mouth opens with its loudness; the words only pick the shape', () => {
  const shape = (open, word) => shapeForStep(levelStep(open), word);
  assert.equal(shape(0.05, 'ah'), 'rest');  // silence: closed, whatever the text says
  assert.equal(shape(0.25, 'rest'), 'fv');  // quiet: a little open
  assert.equal(shape(0.5, 'eh'), 'eh');
  assert.equal(shape(0.9, 'rest'), 'ah');   // loud: wide, even between the text's words
  assert.equal(shape(0.5, 'oo'), 'oo');     // rounded or wide lips come from the words
  assert.equal(shape(0.45, 'mbp'), 'eh');   // the text's guess at m, b, p doesn't shut a mouth that's sounding
  // Hovering near a line doesn't flip back and forth.
  assert.equal(levelStep(0.36, 1), 1);
  assert.equal(levelStep(0.32, 2), 2);
  assert.equal(levelStep(0.45, 1), 2);

  let loud = 0;
  const { lip, shown, step } = player();
  lip.start('Hello there', 1, { level: () => loud });
  for (let i = 0; i < 5; i++) step(20);
  assert.equal(shown.length, 0, 'silent recording: the mouth stays shut');
  loud = 0.3;
  for (let i = 0; i < 10; i++) step(20);
  assert.ok(['ah', 'eh', 'oo', 'ee'].includes(shown.at(-1)[1]), `open when he speaks (${shown.at(-1)[1]})`);
  loud = 0;
  for (let i = 0; i < 20; i++) step(20);
  assert.equal(shown.at(-1)[1], 'rest', 'and shut again when he stops');
});

test('the mouth never changes shape faster than a real mouth can', () => {
  const { lip, shown, step } = player();
  lip.start('Bishop takes the pawn, then the knight is trapped.');
  for (let i = 0; i < 200; i++) step(8);
  assert.ok(shown.length > 8, 'it does talk');
  for (let i = 1; i < shown.length; i++) assert.ok(shown[i][0] - shown[i - 1][0] >= HOLD_MS, `${shown[i - 1][1]} -> ${shown[i][1]} after ${shown[i][0] - shown[i - 1][0]} ms`);
});

test('between words close together the mouth stays a little open instead of snapping shut', () => {
  const { lip, shown, step } = player();
  lip.start('Take that pawn');
  for (let i = 0; i < 120; i++) step(10);
  const before = timeline('Take that pawn').at(-1).end;
  const closed = shown.filter(([t, v]) => v === 'rest' && t < before - 10);
  assert.equal(closed.length, 0, 'no full close inside the phrase');
});

const shapes = (w) => wordVisemes(w).map((x) => x.v);

test('words become the mouth shapes that say them', () => {
  assert.deepEqual(shapes('mate'), ['mbp', 'ah', 'eh']); // m-a-t, silent e
  assert.deepEqual(shapes('move'), ['mbp', 'ah', 'fv']);
  assert.deepEqual(shapes('see'), ['eh', 'ee']);
  assert.deepEqual(shapes('you'), ['ee', 'oo']);
  assert.deepEqual(shapes('bishop'), ['mbp', 'ee', 'oo', 'ah', 'mbp']); // b-i-sh-o-p
  // A repeated shape is one longer shape, not a flicker.
  assert.ok(wordVisemes('mmm').length === 1);
});

test('the timeline keeps words in order, with rests at punctuation', () => {
  const words = timeline('Good move. Next, the knight.');
  assert.equal(words.length, 5);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].at >= words[i - 1].end);
  assert.ok(words[2].at - words[1].end > 200, 'a pause after the full stop');
  assert.equal(words[2].char, 'Good move. '.length); // char positions match the spoken text
  // A slower voice stretches it.
  assert.ok(timeline('Good move', { rate: 0.5 }).at(-1).end > timeline('Good move').at(-1).end * 1.9);
});

test('the player follows the voice: each word starts when the voice says it', () => {
  let t = 0;
  const frames = [];
  const shown = [];
  const lip = createLipSync((v) => shown.push([t, v]), { now: () => t, frame: (fn) => { frames.push(fn); return frames.length; }, cancel: () => {} });
  const step = (ms) => { t += ms; const fns = frames.splice(0); fns.forEach((f) => f()); };
  lip.start('Bad move');
  step(1); // first frame
  assert.equal(shown.at(-1)[1], 'mbp'); // "b" of Bad
  step(2000); // the estimate has run out, but the voice is slow…
  assert.equal(shown.at(-1)[1], 'rest');
  lip.boundary('Bad '.length); // …and only now reaches "move"
  step(1);
  assert.equal(shown.at(-1)[1], 'mbp'); // "m" of move, right as it's said
  lip.end(true);
  assert.equal(shown.at(-1)[1], 'rest');
});

test('a reply read along: the mouth goes live, plays what came in, then closes', () => {
  let t = 0;
  const frames = [];
  const timers = [];
  const live = [];
  const shown = [];
  const lip = createLipSync((v) => shown.push(v), {
    onLive: (on) => live.push(on),
    now: () => t,
    frame: (fn) => { frames.push(fn); return frames.length; },
    cancel: () => {},
    later: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; },
    clear: () => {},
  });
  const step = (ms) => {
    t += ms;
    frames.splice(0).forEach((f) => f());
    timers.splice(0).forEach((x) => (x.at <= t ? x.fn() : timers.push(x)));
  };
  lip.read('Look at ');
  lip.read('this move.');
  assert.deepEqual(live, [true]);
  step(1);
  lip.end(); // the text is all in, but the mouth hasn't said it yet
  assert.equal(lip.playing, true);
  for (let i = 0; i < 200 && lip.playing; i++) step(20);
  assert.equal(lip.playing, false);
  assert.deepEqual(live, [true, false]);
  assert.equal(shown.at(-1), 'rest');
  assert.ok(shown.includes('mbp') && shown.includes('oo')); // "move", "look"
});
