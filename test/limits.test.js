const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SHOHMOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-limits-'));
const handlers = require('../src/handlers');
const { store } = require('../src/store');

const routes = { '/api/check': handlers.check, '/api/game': handlers.game };
let base;
const server = http.createServer((req, res) => routes[new URL(req.url, 'http://x').pathname](req, res));
test.before(() => new Promise((ok) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); })));
test.after(() => { server.close(); fs.rmSync(process.env.SHOHMOT_DATA_DIR, { recursive: true, force: true }); });

// Uses up an IP's budget without asking Chess.com or Lichess anything.
async function spend(name, n) {
  for (let i = 0; i < n; i++) await store.incr(`rl:${name}:127.0.0.1`, 600);
}

test('look-ups past the per-IP budget get a 429 before anything is fetched', async () => {
  await spend('check', 60);
  const check = await fetch(`${base}/api/check?platform=lichess&username=someone`);
  assert.equal(check.status, 429);
  assert.equal(check.headers.get('cache-control'), 'no-store');

  await spend('game', 60);
  const game = await fetch(`${base}/api/game?platform=lichess&username=someone&id=abcdefgh`);
  assert.equal(game.status, 429);
});
