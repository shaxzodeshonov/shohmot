import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTree, play, toPgn, fromPgn, lineEnd, cut, promote, addressOf, nodeAt, numText } from '../public/review/tree.mjs';

const sans = (node) => {
  const out = [];
  for (let n = node; n.parent; n = n.parent) out.unshift(n.san);
  return out.join(' ');
};

test('playing the same move twice reuses the node; a new one is a variation', () => {
  const root = newTree();
  const e4 = play(root, 'e2e4');
  assert.equal(play(root, 'e4'), e4);
  const d4 = play(root, 'd2d4');
  assert.deepEqual(root.children.map((c) => c.san), ['e4', 'd4']);
  assert.equal(numText(d4), '1.');
  assert.equal(numText(play(e4, 'c5')), '1...');
  assert.equal(play(root, 'e2e5'), null);
});

test('PGN round trip keeps nested variations', () => {
  const root = newTree();
  const e4 = play(root, 'e4');
  const e5 = play(e4, 'e5');
  play(play(e5, 'Nf3'), 'Nc6');
  const c5 = play(e4, 'c5');
  play(play(c5, 'Nf3'), 'd6');
  play(play(c5, 'c3'), 'Nf6');
  play(root, 'd4');
  const pgn = toPgn(root);
  assert.match(pgn, /1\. e4 \(1\. d4\) 1\.\.\. e5 \(1\.\.\. c5 2\. Nf3 \(2\. c3 Nf6\) 2\.\.\. d6\) 2\. Nf3 Nc6 \*/);
  const back = fromPgn(pgn).root;
  assert.equal(toPgn(back), pgn);
  assert.equal(sans(lineEnd(back)), 'e4 e5 Nf3 Nc6');
});

test('reads PGN with comments, annotations, results and a FEN', () => {
  const { root, headers } = fromPgn('[White "A"]\n[Black "B"]\n\n1. e4! {good} e5?! 2. Nf3 $1 (2. Bc4?? ) Nc6 3. Bc4 Bc5 4. 0-0 1-0');
  assert.equal(headers.White, 'A');
  assert.equal(sans(lineEnd(root)), 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O');
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40';
  const r2 = fromPgn(`[FEN "${fen}"]\n\n40... Kd7 41. e4`).root;
  assert.equal(r2.fen, fen);
  assert.equal(numText(lineEnd(r2)), '41.');
  assert.throws(() => fromPgn('1. e4 e4'), /not a legal move/);
});

test('cut, promote and addresses', () => {
  const root = newTree();
  const e4 = play(root, 'e4');
  const d4 = play(root, 'd4');
  const d5 = play(d4, 'd5');
  assert.deepEqual(addressOf(d5), [1, 0]);
  assert.equal(nodeAt(root, [1, 0]), d5);
  promote(d5);
  assert.equal(root.children[0], d4);
  assert.equal(cut(d4), root);
  assert.deepEqual(root.children, [e4]);
});
