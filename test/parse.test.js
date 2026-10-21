const test = require('node:test');
const assert = require('node:assert');
const { parseChesscomGame, parseLichessGame, parseNdjson, archiveMonthEnd, normSpeed } = require('../src/parse');
const { parseAccounts } = require('../src/handlers');

test('chess.com: finds our side case-insensitively and maps results', () => {
  const base = {
    url: 'https://www.chess.com/game/live/1', uuid: 'u1', end_time: 1792090422, rated: true, time_class: 'blitz', rules: 'chess',
  };
  const win = parseChesscomGame({ ...base, white: { username: 'Opp', rating: 300, result: 'checkmated' }, black: { username: 'KindOfInterestedInChess', rating: 302, result: 'win' } }, 'kindofinterestedinchess');
  assert.equal(win.result, 'win');
  assert.equal(win.color, 'black');
  assert.equal(win.opponent, 'Opp');
  assert.equal(win.end, 1792090422000);

  const draw = parseChesscomGame({ ...base, white: { username: 'me', result: 'repetition' }, black: { username: 'x', result: 'repetition' } }, 'me');
  assert.equal(draw.result, 'draw');
  const loss = parseChesscomGame({ ...base, white: { username: 'me', result: 'timeout' }, black: { username: 'x', result: 'win' } }, 'me');
  assert.equal(loss.result, 'loss');
  assert.equal(parseChesscomGame({ ...base, white: { username: 'a' }, black: { username: 'b' } }, 'me'), null);
});

test('lichess: skips aborted games, maps winner and AI opponents', () => {
  const g = {
    id: 'abc', rated: true, speed: 'bullet', createdAt: 1, lastMoveAt: 2, status: 'mate', winner: 'white',
    players: { white: { user: { id: 'shaxzod_e', name: 'shaxzod_e' }, rating: 1039, ratingDiff: 6 }, black: { aiLevel: 3 } },
  };
  const parsed = parseLichessGame(g, 'Shaxzod_E');
  assert.equal(parsed.result, 'win');
  assert.equal(parsed.opponent, 'Stockfish level 3');
  assert.equal(parsed.url, 'https://lichess.org/abc');
  assert.equal(parseLichessGame({ ...g, status: 'aborted' }, 'shaxzod_e'), null);
  assert.equal(parseLichessGame({ ...g, winner: undefined, status: 'draw' }, 'shaxzod_e').result, 'draw');
});

test('speed names collapse to one set', () => {
  assert.equal(normSpeed('ultraBullet'), 'bullet');
  assert.equal(normSpeed('correspondence'), 'daily');
  assert.equal(normSpeed('daily'), 'daily');
  assert.equal(normSpeed('weird'), 'other');
});

test('ndjson parser tolerates blank and truncated lines', () => {
  assert.deepEqual(parseNdjson('{"a":1}\n\n{"b":2}\n{"c":'), [{ a: 1 }, { b: 2 }]);
});

test('archive month end is the first of the next month, UTC', () => {
  assert.equal(archiveMonthEnd('https://api.chess.com/pub/player/x/games/2026/09'), Date.UTC(2026, 9, 1));
  assert.equal(archiveMonthEnd('https://api.chess.com/pub/player/x/games/2025/12'), Date.UTC(2026, 0, 1));
});

test('account list from the query string is validated and deduped', () => {
  assert.deepEqual(parseAccounts('chesscom:Shaxzod_e,lichess:shaxzod_e,chesscom:shaxzod_E,bad:x,lichess:no spaces'), [
    { platform: 'chesscom', username: 'Shaxzod_e' },
    { platform: 'lichess', username: 'shaxzod_e' },
  ]);
  assert.equal(parseAccounts(null).length, 0);
  assert.equal(parseAccounts('lichess:a1,lichess:b2,lichess:c3,lichess:d4,lichess:e5').length, 4);
});
