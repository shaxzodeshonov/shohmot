import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFromSan, labelGame, explain } from '../web/scripts/review/label.mjs';
import { schedule, record, queue, saveScannedMistakes, saveReviewedMistakes, latestUnseen, markSeen, INTERVALS, LEARNED } from '../web/scripts/training/store.mjs';
import { mistakesOf } from '../web/scripts/training/mistakes.mjs';

// Scholar's mate, with Black to blame: 3...Nf6?? allows Qxf7#.
function scholars() {
  const game = buildFromSan('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');
  game.me = 'b';
  game.bookPlies = 0;
  const results = game.fens.map((_, i) => (i < game.moves.length
    ? [{ score: { cp: 20 }, pv: [game.moves[i].uci] }, { score: { cp: 0 }, pv: ['a2a3'] }]
    : game.end));
  // Before 3...: Black's best was 3...Qe7, holding. After 3...Nf6 White mates in 1.
  results[5] = [{ score: { cp: -30 }, pv: ['d8e7', 'g1f3'] }, { score: { cp: -40 }, pv: ['g7g6'] }];
  results[6] = [{ score: { mate: 1 }, pv: ['h5f7'] }];
  return { game, results };
}

test('buildFromSan replays a game and scores the final position', () => {
  const { game } = scholars();
  assert.equal(game.moves.length, 7);
  assert.equal(game.fens.length, 8);
  assert.deepEqual(game.end, [{ score: { mate: 0 }, pv: [] }]);
  assert.equal(buildFromSan('e4 e9'), null);
});

test('the blunder is labelled and explained', () => {
  const { game, results } = scholars();
  const { labels } = labelGame(game, results);
  assert.equal(labels[5], 'blunder');
  const x = explain(game, results, labels[5], 5);
  assert.equal(x.kind, 'mate');
  assert.match(x.why, /mate in 1/);
  assert.equal(x.bestSan, 'Qe7');
});

test('mistakes become training items for my side only', () => {
  const { game, results } = scholars();
  const review = { ...labelGame(game, results), accuracy: { w: 90, b: 40 } };
  const info = mistakesOf(game, results, review, { end: 1000, username: 'me', opponent: 'opp', speed: 'blitz', result: 'loss' });
  assert.equal(info.items.length, 1);
  const it = info.items[0];
  assert.equal(it.ply, 6);
  assert.equal(it.best, 'd8e7');
  assert.equal(it.played, 'g8f6');
  assert.equal(it.label, 'blunder');
  assert.equal(info.accuracy, 40);
  // Seen from White's side, White made no mistakes.
  assert.equal(mistakesOf({ ...game, me: 'w' }, results, review, { end: 1 }).items.length, 0);
});

test('spaced repetition: solved moves up a box, missed comes back soon', () => {
  const it = { box: 0, due: 0, tries: 0, wins: 0 };
  const a = schedule(it, true, 0);
  assert.equal(a.box, 1);
  assert.equal(a.due, INTERVALS[1]);
  const b = schedule({ ...a, box: 3 }, false, 0);
  assert.equal(b.box, 0);
  assert.ok(b.due > 0 && b.due < INTERVALS[1]);
  assert.equal(schedule({ ...a, box: LEARNED - 1 }, true, 0).due, Infinity);
});

test('store: queue, review overrides scan, keeps progress, pop-up dismissal', () => {
  const { game, results } = scholars();
  const review = { ...labelGame(game, results), accuracy: { w: 90, b: 40 } };
  const info = mistakesOf(game, results, review, { end: Date.now() - 1000, username: 'Me', opponent: 'opp', speed: 'blitz', result: 'loss' });
  saveScannedMistakes('lichess', 'g1', info);
  let q = queue();
  assert.equal(q.length, 1);
  assert.equal(q[0].key, 'lichess:g1:6');
  record(q[0].key, true);
  assert.equal(queue().length, 0, 'not due again yet');
  assert.equal(queue({ game: 'lichess:g1' }).length, 1, 'but asked for by game');
  // A full review replaces the scan but keeps the progress on the same position.
  saveReviewedMistakes('lichess', 'g1', info);
  assert.equal(queue({ game: 'lichess:g1' })[0].box, 1);
  saveScannedMistakes('lichess', 'g1', { ...info, items: [] });
  assert.equal(queue({ game: 'lichess:g1' }).length, 1, 'a later quick scan does not undo the review');
  const nw = latestUnseen([{ platform: 'lichess', username: 'me' }]);
  assert.equal(nw.key, 'lichess:g1');
  markSeen(nw.key);
  assert.equal(latestUnseen([{ platform: 'lichess', username: 'me' }]), null);
});
