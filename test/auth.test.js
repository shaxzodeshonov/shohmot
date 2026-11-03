const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SHOHMOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-auth-'));
const auth = require('../src/auth');

// A stand-in for Have I Been Pwned's range API, so the tests don't need the
// network: these passwords count as breached, and `hibpDown` fakes an outage.
const BREACHED = ['monkey-trouble-1', 'letmein-please'];
let hibpDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const m = /^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/.exec(String(url));
  if (!m) return realFetch(url, opts);
  if (hibpDown) throw new TypeError('fetch failed');
  const lines = BREACHED.map((p) => require('crypto').createHash('sha1').update(p).digest('hex').toUpperCase())
    .filter((h) => h.startsWith(m[1])).map((h) => `${h.slice(5)}:42`);
  return new Response([...lines, '0000000000000000000000000000000000A:0'].join('\r\n'));
};

const routes = { '/api/register': auth.register, '/api/login': auth.login, '/api/logout': auth.logout, '/api/me': auth.me };
let base;
const server = http.createServer((req, res) => routes[new URL(req.url, 'http://x').pathname](req, res));
test.before(() => new Promise((ok) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; ok(); })));
test.after(() => { server.close(); fs.rmSync(process.env.SHOHMOT_DATA_DIR, { recursive: true, force: true }); });

async function call(route, { body, cookie, method = body ? 'POST' : 'GET', headers = {} } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = res.headers.getSetCookie();
  return { status: res.status, body: await res.json(), cookie: cookies[0] && cookies[0].split(';')[0], setCookie: cookies.join(' | ') };
}

test('passwords hash and verify', async () => {
  const h = await auth.hashPassword('correct horse');
  assert.match(h, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await auth.verifyPassword('correct horse', h), true);
  assert.equal(await auth.verifyPassword('wrong horse', h), false);
  assert.notEqual(await auth.hashPassword('correct horse'), h, 'salted');
});

test('sign up, use the session, sign out, sign back in', async () => {
  const reg = await call('/api/register', { body: { name: '  Shaxzod   E ', email: 'Me@Example.com', password: 'knight-to-f3' } });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.body.user.name, 'Shaxzod E');
  assert.equal(reg.body.user.email, 'me@example.com');
  assert.equal(reg.body.user.hash, undefined, 'never send the hash');
  assert.match(reg.setCookie, /HttpOnly/);
  assert.match(reg.setCookie, /SameSite=Lax/);
  assert.match(reg.setCookie, /shohmot_in=1; Path=\/; SameSite=Lax/, 'readable signed-in hint');

  const me = await call('/api/me', { cookie: reg.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Shaxzod E');

  const saved = await call('/api/me', { cookie: reg.cookie, body: { accounts: [{ platform: 'lichess', username: 'shaxzod_e' }, { platform: 'bad', username: 'x' }] } });
  assert.deepEqual(saved.body.user.accounts, [{ platform: 'lichess', username: 'shaxzod_e' }]);

  const out = await call('/api/logout', { cookie: reg.cookie, body: {} });
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /shohmot_sid=; .*Max-Age=0/);
  assert.match(out.setCookie, /shohmot_in=; .*Max-Age=0/);
  assert.equal((await call('/api/me', { cookie: reg.cookie })).status, 401, 'session is gone after sign-out');

  assert.equal((await call('/api/login', { body: { email: 'me@example.com', password: 'nope-nope' } })).status, 401);
  const back = await call('/api/login', { body: { email: 'ME@example.com', password: 'knight-to-f3' } });
  assert.equal(back.status, 200);
  assert.deepEqual((await call('/api/me', { cookie: back.cookie })).body.user.accounts, [{ platform: 'lichess', username: 'shaxzod_e' }]);
});

test('rejects duplicates, weak input and cross-site requests', async () => {
  const body = { name: 'A', email: 'dup@example.com', password: 'long enough' };
  assert.equal((await call('/api/register', { body })).status, 201);
  assert.equal((await call('/api/register', { body })).status, 409);
  assert.equal((await call('/api/register', { body: { ...body, email: 'x@example.com', password: 'short' } })).status, 400);
  assert.equal((await call('/api/register', { body: { ...body, email: 'x@example.com', password: 'password123' } })).status, 400);
  assert.equal((await call('/api/register', { body: { ...body, email: 'not-an-email' } })).status, 400);
  assert.equal((await call('/api/register', { body: { ...body, email: 'y@example.com', name: '   ' } })).status, 400);
  const csrf = await call('/api/register', { body: { ...body, email: 'z@example.com' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(csrf.status, 403);
  const form = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(form.status, 415);
  assert.equal((await call('/api/me', { cookie: 'shohmot_sid=forged' })).status, 401);
});

test('refuses breached passwords, but signs up if the breach check is down', async () => {
  assert.equal(await auth.isBreached('monkey-trouble-1'), true);
  assert.equal(await auth.isBreached('a very unusual phrase 4417'), false);
  const res = await call('/api/register', { body: { name: 'C', email: 'pwned@example.com', password: 'letmein-please' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /data breach/);
  hibpDown = true;
  try {
    assert.equal(await auth.isBreached('monkey-trouble-1'), false);
    assert.equal((await call('/api/register', { body: { name: 'C', email: 'pwned@example.com', password: 'letmein-please' } })).status, 201);
  } finally {
    hibpDown = false;
  }
});

test('signing in again ends the session the browser had before', async () => {
  const reg = await call('/api/register', { body: { name: 'D', email: 'rotate@example.com', password: 'rook on the seventh' } });
  const again = await call('/api/login', { cookie: reg.cookie, body: { email: 'rotate@example.com', password: 'rook on the seventh' } });
  assert.equal(again.status, 200);
  assert.notEqual(again.cookie, reg.cookie);
  assert.equal((await call('/api/me', { cookie: reg.cookie })).status, 401, 'old session is gone');
  assert.equal((await call('/api/me', { cookie: again.cookie })).status, 200);
});

test('locks an email after 10 wrong passwords', async () => {
  await call('/api/register', { body: { name: 'B', email: 'lock@example.com', password: 'right password' } });
  for (let i = 0; i < 10; i++) await call('/api/login', { body: { email: 'lock@example.com', password: 'wrong password' } });
  const res = await call('/api/login', { body: { email: 'lock@example.com', password: 'right password' } });
  assert.equal(res.status, 429);
});
