// The account features beyond sign-in: password reset, email confirmation,
// signing out everywhere, export and delete, preferences while everything is
// free, coach links, analytics and the weekly email.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-acct-'));
process.env.SHOHMOT_DATA_DIR = DATA;
process.env.SHOHMOT_QUIET_MAIL = '1';
process.env.ADMIN_EMAILS = 'boss@example.com';
delete process.env.STRIPE_SECRET_KEY;

// No network: Have I Been Pwned says nothing is breached.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => (String(url).startsWith('https://api.pwnedpasswords.com/') ? new Response('') : realFetch(url, opts));

const { dispatch } = require('../src/routes');
const { verifySignature } = require('../src/billing');
const { summarize, isoWeek } = require('../src/weekly');
let base;
const server = http.createServer((req, res) => dispatch(req, res));
test.before(() => new Promise((ok) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; ok(); })));
test.after(() => { server.close(); fs.rmSync(DATA, { recursive: true, force: true }); });

async function call(route, { body, cookie, method = body ? 'POST' : 'GET', headers = {} } = {}) {
  const res = await realFetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookies = res.headers.getSetCookie();
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, body: json, text, cookie: cookies[0] && cookies[0].split(';')[0], headers: res.headers };
}

// The newest email sent to someone, from the local outbox.
function lastMail(to) {
  const dir = path.join(DATA, 'outbox');
  const files = fs.readdirSync(dir).sort().reverse();
  for (const f of files) { const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (m.to === to) return m; }
  return null;
}
const tokenIn = (mail) => /#token=([A-Za-z0-9_-]{43})/.exec(mail.text)[1];

async function signUp(email, name = 'Player') {
  const r = await call('/api/register', { body: { name, email, password: 'good-long-password-1' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.cookie;
}

test('sign-up sends a confirmation email, and the link confirms it', async () => {
  const cookie = await signUp('confirm@example.com');
  assert.equal((await call('/api/me', { cookie })).body.user.verified, false);
  const mail = lastMail('confirm@example.com');
  assert.match(mail.subject, /Confirm/);
  const ok = await call('/api/account', { body: { action: 'verify', token: tokenIn(mail) } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/api/me', { cookie })).body.user.verified, true);
  assert.equal((await call('/api/account', { body: { action: 'verify', token: tokenIn(mail) } })).status, 400, 'a link works once');
});

test('password reset: same answer for unknown emails, one-time link, other sessions end', async () => {
  const cookie = await signUp('reset@example.com');
  const unknown = await call('/api/account', { body: { action: 'forgot', email: 'nobody@example.com' } });
  const known = await call('/api/account', { body: { action: 'forgot', email: 'Reset@Example.com' } });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, known.body, 'no way to tell who has an account');
  const token = tokenIn(lastMail('reset@example.com'));
  assert.equal((await call('/api/account', { body: { action: 'reset', token, password: 'short' } })).status, 400);
  const done = await call('/api/account', { body: { action: 'reset', token, password: 'brand-new-password-2' } });
  assert.equal(done.status, 200);
  assert.ok(done.cookie, 'signed in with the new password');
  assert.equal((await call('/api/me', { cookie })).status, 401, 'the old session ended');
  assert.equal((await call('/api/me', { cookie: done.cookie })).status, 200);
  assert.equal((await call('/api/account', { body: { action: 'reset', token, password: 'another-password-3' } })).status, 400, 'used once');
  assert.equal((await call('/api/login', { body: { email: 'reset@example.com', password: 'brand-new-password-2' } })).status, 200);
});

test('sign out everywhere ends this session too', async () => {
  const cookie = await signUp('everywhere@example.com');
  const second = (await call('/api/login', { body: { email: 'everywhere@example.com', password: 'good-long-password-1' } })).cookie;
  assert.equal((await call('/api/account', { cookie, body: { action: 'signout-all' } })).status, 200);
  assert.equal((await call('/api/me', { cookie })).status, 401);
  assert.equal((await call('/api/me', { cookie: second })).status, 401);
});

test('export has no secrets; delete needs the password and removes everything', async () => {
  const cookie = await signUp('leaving@example.com', 'Leaver');
  const exp = await call('/api/account', { cookie });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.body.account.email, 'leaving@example.com');
  assert.doesNotMatch(exp.text, /scrypt|hash|session/i);
  assert.equal((await call('/api/account', { cookie, body: { action: 'delete', password: 'wrong-password-x' } })).status, 401);
  assert.equal((await call('/api/account', { cookie, body: { action: 'delete', password: 'good-long-password-1' } })).status, 200);
  assert.equal((await call('/api/me', { cookie })).status, 401);
  assert.equal((await call('/api/login', { body: { email: 'leaving@example.com', password: 'good-long-password-1' } })).status, 401);
  assert.equal((await call('/api/register', { body: { name: 'Again', email: 'leaving@example.com', password: 'good-long-password-1' } })).status, 201, 'the email is free again');
});

test('while billing is off, every account gets every feature', async () => {
  const cookie = await signUp('free@example.com');
  const me = (await call('/api/me', { cookie })).body;
  assert.equal(me.features.billing, false);
  assert.equal(me.user.unlocked, true);
  assert.equal(me.user.canCoach, true);
  const saved = await call('/api/me', { cookie, body: { prefs: { dailyLimit: 15, notify: true, lossStreak: 4, weeklyEmail: false, junk: 1 } } });
  assert.deepEqual(saved.body.user.prefs, { lossStreak: 4, dailyLimit: 15, notify: true, weeklyEmail: false });
  assert.equal((await call('/api/billing', { cookie, body: { action: 'checkout', plan: 'pro' } })).status, 503);
});

test('coach: invite, join, see, remove, leave', async () => {
  const coach = await signUp('coach@example.com', 'Coach Ann');
  const student = await signUp('student@example.com', 'Sam');
  await call('/api/me', { cookie: student, body: { accounts: [{ platform: 'lichess', username: 'sam_plays' }] } });
  const { code } = (await call('/api/coach', { cookie: coach })).body;
  assert.match(code, /^[A-Za-z0-9_-]{10,16}$/);
  const who = await call(`/api/coach?code=${code}`, { cookie: student });
  assert.equal(who.body.coach.name, 'Coach Ann');
  assert.equal((await call('/api/coach', { cookie: coach, body: { action: 'join', code } })).status, 400, 'not your own link');
  assert.equal((await call('/api/coach', { cookie: student, body: { action: 'join', code } })).status, 200);
  let list = (await call('/api/coach', { cookie: coach })).body.students;
  assert.deepEqual(list.map((s) => [s.name, s.accounts[0].username]), [['Sam', 'sam_plays']]);
  assert.equal((await call('/api/me', { cookie: student })).body.user.coach.name, 'Coach Ann');
  assert.equal((await call('/api/me', { cookie: coach })).body.user.students, 1);
  // A new link stops the old one.
  const { code: fresh } = (await call('/api/coach', { cookie: coach, body: { action: 'invite' } })).body;
  assert.notEqual(fresh, code);
  assert.equal((await call(`/api/coach?code=${code}`, { cookie: student })).status, 404);
  // Remove, join again, then leave.
  assert.deepEqual((await call('/api/coach', { cookie: coach, body: { action: 'remove', student: list[0].id } })).body.students, []);
  assert.equal((await call('/api/coach', { cookie: student, body: { action: 'join', code: fresh } })).status, 200);
  assert.equal((await call('/api/coach', { cookie: student, body: { action: 'leave' } })).status, 200);
  list = (await call('/api/coach', { cookie: coach })).body.students;
  assert.equal(list.length, 0);
});

test('analytics: known events count, admin sees them, others don’t', async () => {
  const send = (body) => realFetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'test' }, body: JSON.stringify(body) });
  assert.equal((await send({ name: 'page_view', path: '/review.html' })).status, 204);
  await send({ name: 'page_view', path: '/features/training.html' });
  await send({ name: 'guest_review' });
  await send({ name: 'not_an_event' });
  await send({ name: 'page_view', path: '/secret-page' });
  const user = await signUp('nosy@example.com');
  assert.equal((await call('/api/admin', { cookie: user })).status, 403);
  const boss = await signUp('boss@example.com', 'Boss');
  const r = await call('/api/admin?days=7', { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.guest_review, 1);
  assert.equal(r.body.pages['/review'], 1);
  assert.equal(r.body.pages['/features'], 1);
  assert.ok(r.body.totals.signup >= 1);
  assert.ok(r.body.byDay.at(-1).visitors >= 1);
  assert.ok(r.body.users.total >= 2);
  assert.equal(r.body.totals.not_an_event, undefined);
});

test('health check and unknown routes', async () => {
  const h = await call('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.db, true);
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal((await call('/api/state', { body: {} })).status, 405);
});

test('weekly email: summary, signed unsubscribe link', async () => {
  const DAY = 86400000;
  const now = Date.UTC(2026, 10, 9, 8);
  const g = (d, result, rating) => ({ id: `${d}${result}`, end: now - d * DAY, result, rated: true, speed: 'blitz', rating });
  const s = summarize([{ platform: 'lichess', username: 'me', games: [g(10, 'win', 1500), g(5, 'loss', 1510), g(4, 'loss', 1500), g(3, 'loss', 1490), g(2, 'loss', 1480), g(1, 'win', 1470)] }], now);
  assert.equal(s.total, 5);
  assert.equal(s.worstStreak, 4);
  assert.equal(s.accounts[0].ratings[0].change, 1470 - 1500);
  assert.match(s.tip, /losing streak/);
  assert.equal(isoWeek(Date.UTC(2026, 0, 1)), '2026-W01');
  const { unsubUrl } = require('../src/account');
  // (An account from an earlier test: sign-ups are limited to 10 an hour per IP.)
  const url = new URL(unsubUrl({ headers: { host: 'x' } }, 'free@example.com'));
  const bad = await call(`/api/account?unsubscribe=free@example.com&sig=nope`);
  assert.equal(bad.status, 400);
  const ok = await call(`/api/account?${url.searchParams}`);
  assert.equal(ok.status, 200);
  assert.match(ok.text, /unsubscribed/);
});

test('Stripe webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(verifySignature(body, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifySignature(body + ' ', `t=${t},v1=${sig}`, secret), false);
  assert.equal(verifySignature(body, `t=${t - 3600},v1=${sig}`, secret), false, 'too old');
  assert.equal(verifySignature(body, `t=${t},v1=${sig}`, 'whsec_other'), false);
});

test('the database is found whatever Vercel named it', () => {
  const { findRedis, describeDb } = require('../src/store');
  const u = 'https://eu1-x.upstash.io';
  assert.equal(findRedis({ KV_REST_API_URL: u, KV_REST_API_TOKEN: 't' }).from, 'KV_REST_API_URL');
  assert.equal(findRedis({ UPSTASH_REDIS_REST_URL: u, UPSTASH_REDIS_REST_TOKEN: 't' }).token, 't');
  assert.equal(findRedis({ STORAGE_KV_REST_API_URL: u, STORAGE_KV_REST_API_TOKEN: 't2' }).token, 't2');
  assert.equal(findRedis({ MYDB_UPSTASH_REDIS_REST_URL: u, MYDB_UPSTASH_REDIS_REST_TOKEN: 't3' }).from, 'MYDB_UPSTASH_REDIS_REST_URL');
  assert.equal(findRedis({ KV_REST_API_URL: u }), null, 'a URL without its token is no use');
  assert.equal(findRedis({ REDIS_URL: 'rediss://default:x@host:6379' }), null);
  const d = describeDb({ VERCEL: '1', REDIS_URL: 'rediss://…' });
  assert.equal(d.db, 'missing');
  assert.deepEqual(d.related, ['REDIS_URL']);
  assert.match(describeDb({ VERCEL: '1' }).hint, /UPSTASH_REDIS_REST_URL/);
  assert.equal(describeDb({}).db, 'file');
});

test('ready-made admin login, and changing a password', async () => {
  process.env.ADMIN_PASSWORD = 'the-admin-password-1';
  const wrong = await call('/api/login', { body: { email: 'boss2@example.com', password: 'the-admin-password-1' } });
  assert.equal(wrong.status, 401, 'only ADMIN_EMAILS addresses');
  process.env.ADMIN_EMAILS = 'boss@example.com,boss2@example.com';
  assert.equal((await call('/api/login', { body: { email: 'boss2@example.com', password: 'nope-nope-nope' } })).status, 401);
  const ok = await call('/api/login', { body: { email: 'boss2@example.com', password: 'the-admin-password-1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.admin, true);
  assert.equal(ok.body.user.verified, true);
  // Change it: the old one stops working, this device stays in.
  assert.equal((await call('/api/account', { cookie: ok.cookie, body: { action: 'password', current: 'wrong-one-123', password: 'a-new-admin-pass-2' } })).status, 401);
  const changed = await call('/api/account', { cookie: ok.cookie, body: { action: 'password', current: 'the-admin-password-1', password: 'a-new-admin-pass-2' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('/api/me', { cookie: changed.cookie })).status, 200);
  assert.equal((await call('/api/login', { body: { email: 'boss2@example.com', password: 'the-admin-password-1' } })).status, 401, 'ADMIN_PASSWORD only creates the account once');
  assert.equal((await call('/api/login', { body: { email: 'boss2@example.com', password: 'a-new-admin-pass-2' } })).status, 200);
  delete process.env.ADMIN_PASSWORD;
});
