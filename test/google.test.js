// "Continue with Google" (src/google.js), end to end against a fake Google
// token endpoint: new accounts, returning ones, linking to email accounts, and
// the checks that stop forged or replayed sign-ins.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SHOHMOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-google-'));
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
const { dispatch } = require('../src/routes');

// The fake Google: whatever `nextIdentity` holds is what the next code trades for.
let nextIdentity = null;
let lastTokenRequest = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.pwnedpasswords.com/')) return new Response('');
  if (u !== 'https://oauth2.googleapis.com/token') return realFetch(url, opts);
  lastTokenRequest = new URLSearchParams(String(opts.body));
  if (!nextIdentity) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return new Response(JSON.stringify({ id_token: `${enc({ alg: 'RS256' })}.${enc(nextIdentity)}.sig`, access_token: 'x' }));
};

let base;
const server = http.createServer((req, res) => dispatch(req, res));
test.before(() => new Promise((ok) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; ok(); })));
test.after(() => { server.close(); fs.rmSync(process.env.SHOHMOT_DATA_DIR, { recursive: true, force: true }); });

const cookieOf = (res, name) => res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

async function call(route, { body, cookie } = {}) {
  const res = await realFetch(base + route, {
    method: body ? 'POST' : 'GET',
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a redirect */ }
  return { status: res.status, body: json, location: res.headers.get('location'), sid: cookieOf(res, 'shohmot_sid'), res };
}

// Start the flow, "consent" at Google, and follow the redirect back.
async function googleSignIn(claims, { next = '/app.html', tamper = {} } = {}) {
  const start = await call(`/api/google?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302);
  const to = new URL(start.location);
  const flow = cookieOf(start.res, 'shohmot_g');
  nextIdentity = claims && {
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: to.searchParams.get('nonce'), email_verified: true, ...claims, ...tamper,
  };
  const state = tamper.state ?? to.searchParams.get('state');
  return call(`/api/google?code=abc&state=${encodeURIComponent(state)}`, { cookie: flow });
}

test('starts at Google with state, nonce and PKCE', async () => {
  const start = await call('/api/google?next=/train.html');
  assert.equal(start.status, 302);
  const to = new URL(start.location);
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
  assert.equal(to.searchParams.get('redirect_uri'), `${base}/api/google`);
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(to.searchParams.get('state').length >= 32);
  assert.ok(to.searchParams.get('nonce').length >= 32);
  assert.match(start.res.headers.getSetCookie()[0], /^shohmot_g=.*; Path=\/api\/google; HttpOnly; SameSite=Lax; Max-Age=600/);
});

test('a new Google user gets a confirmed account with no password', async () => {
  const back = await googleSignIn({ sub: '1001', email: 'New.Player@gmail.com', name: 'New Player' }, { next: '/train.html' });
  assert.equal(back.status, 302);
  assert.equal(back.location, '/train.html?signed=new');
  assert.ok(back.sid, 'signed in');
  assert.match(back.res.headers.getSetCookie().join(' | '), /shohmot_g=; .*Max-Age=0/, 'flow cookie cleared');
  assert.ok(lastTokenRequest.get('code_verifier'), 'PKCE verifier sent');

  const me = await call('/api/me', { cookie: back.sid });
  assert.equal(me.body.user.email, 'new.player@gmail.com');
  assert.equal(me.body.user.name, 'New Player');
  assert.equal(me.body.user.verified, true);
  assert.equal(me.body.user.google, true);
  assert.equal(me.body.user.hasPassword, false);
  assert.equal(me.body.features.google, true);

  const pw = await call('/api/login', { body: { email: 'new.player@gmail.com', password: 'whatever-123' } });
  assert.equal(pw.status, 401);
  assert.match(pw.body.error, /Google/);

  const again = await googleSignIn({ sub: '1001', email: 'new.player@gmail.com' });
  assert.equal(again.location, '/app.html?signed=google', 'same account, not a new one');
});

test('links to an email account the person already confirmed, keeping its password', async () => {
  const reg = await call('/api/register', { body: { name: 'Has Password', email: 'linked@example.com', password: 'rook-lift-h4' } });
  assert.equal(reg.status, 201);
  // Confirm it the way the verify link would.
  const { store } = require('../src/store');
  const u = JSON.parse(await store.get('user:linked@example.com'));
  u.verified = true;
  await store.set('user:linked@example.com', JSON.stringify(u));

  const back = await googleSignIn({ sub: '2002', email: 'linked@example.com' });
  assert.equal(back.location, '/app.html?signed=google');
  const me = await call('/api/me', { cookie: back.sid });
  assert.equal(me.body.user.name, 'Has Password');
  assert.equal(me.body.user.google, true);
  assert.equal(me.body.user.hasPassword, true);
  assert.equal((await call('/api/me', { cookie: reg.sid })).status, 200, 'their other sessions carry on');
  assert.equal((await call('/api/login', { body: { email: 'linked@example.com', password: 'rook-lift-h4' } })).status, 200);
});

test('an unconfirmed email account loses its password and sessions when the real owner arrives', async () => {
  const squat = await call('/api/register', { body: { name: 'Squatter', email: 'victim@gmail.com', password: 'planted-pass-1' } });
  assert.equal(squat.status, 201);
  const back = await googleSignIn({ sub: '3003', email: 'victim@gmail.com' });
  assert.equal(back.status, 302);
  assert.equal((await call('/api/me', { cookie: squat.sid })).status, 401, 'the pre-made session is dead');
  assert.equal((await call('/api/login', { body: { email: 'victim@gmail.com', password: 'planted-pass-1' } })).status, 401, 'the planted password is gone');
  assert.equal((await call('/api/me', { cookie: back.sid })).body.user.verified, true);
});

test('refuses forged, replayed or unverified sign-ins', async () => {
  const cases = [
    [{ state: 'not-the-state-we-sent-at-all-xxxxxxxx' }, 'expired'],
    [{ aud: 'someone-elses-client' }, 'failed'],
    [{ iss: 'https://evil.example' }, 'failed'],
    [{ nonce: 'replayed' }, 'failed'],
    [{ exp: Math.floor(Date.now() / 1000) - 10 }, 'failed'],
    [{ email_verified: false }, 'unverified'],
  ];
  for (const [tamper, reason] of cases) {
    const back = await googleSignIn({ sub: '9009', email: 'attacker@example.com' }, { tamper });
    assert.equal(back.location, `/login.html?google=${reason}`, JSON.stringify(tamper));
    assert.equal(back.sid, undefined);
  }
  // No flow cookie at all (another browser, or it expired).
  assert.equal((await call('/api/google?code=abc&state=xyz')).location, '/login.html?google=expired');
  // Cancelled on Google's screen.
  assert.equal((await call('/api/google?error=access_denied&state=xyz')).location, '/login.html?google=cancelled');
});

test('never redirects off the site', async () => {
  for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    const back = await googleSignIn({ sub: '4004', email: 'next@example.com' }, { next });
    assert.equal(back.location, '/app.html?signed=' + (next === '//evil.example' ? 'new' : 'google'));
  }
});

test('Google-only accounts set a first password, and delete by typing their email', async () => {
  const back = await googleSignIn({ sub: '5005', email: 'onlygoogle@example.com', name: 'Only Google' });
  const set = await call('/api/account', { cookie: back.sid, body: { action: 'password', password: 'fresh-pass-77' } });
  assert.equal(set.status, 200);
  assert.equal(set.body.user.hasPassword, true);
  assert.equal((await call('/api/login', { body: { email: 'onlygoogle@example.com', password: 'fresh-pass-77' } })).status, 200);

  const back2 = await googleSignIn({ sub: '6006', email: 'leaving@example.com' });
  assert.equal((await call('/api/account', { cookie: back2.sid, body: { action: 'delete', email: 'wrong@example.com' } })).status, 401);
  assert.equal((await call('/api/account', { cookie: back2.sid, body: { action: 'delete', email: 'Leaving@example.com' } })).status, 200);
  const fresh = await googleSignIn({ sub: '6006', email: 'leaving@example.com' });
  assert.match(fresh.location, /signed=new/, 'signing in again after deleting makes a new account');
});

test('says so when Google sign-in is not set up', async () => {
  const id = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    assert.equal((await call('/api/google')).location, '/login.html?google=off');
  } finally {
    process.env.GOOGLE_CLIENT_ID = id;
  }
});
