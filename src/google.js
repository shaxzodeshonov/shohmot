// "Continue with Google": signs in, or makes a new account, with a Google
// account. It's the OAuth 2.0 authorization-code flow, done on the server with
// Node's own crypto and fetch, so there's no Google script on the page and the
// Content-Security-Policy stays as it is.
//
// GET /api/google?next=/app.html   sends the browser to Google's consent screen
// GET /api/google?code=…&state=…   Google sends it back here; we sign them in
//
// - state, a PKCE verifier and a nonce live in a short-lived HttpOnly cookie,
//   so a callback only works in the browser that started it (no login CSRF);
// - the ID token comes straight from Google's token endpoint over HTTPS,
//   paid for with our client secret, so it's trusted without checking its
//   signature (Google's own guidance), but issuer, audience, expiry, nonce and
//   email_verified are all still checked.
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; see .env.example.
const crypto = require('crypto');
const { store } = require('./store');
const auth = require('./auth');
const mail = require('./mail');

const { handler, onlyMethods, getUser, saveUser, userKey, sha256 } = auth;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const FLOW_COOKIE = 'shohmot_g';
const FLOW_TTL = 600; // ten minutes to get through Google's screens

const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
// Google sends people back to the site they started on: the real domain on
// Vercel, and this machine when testing locally (even if .env has SITE_URL).
// Either address has to be listed in the Google client's redirect URIs.
const redirectUri = (req) => `${process.env.VERCEL ? mail.siteUrl(req) : `http://${req.headers.host || 'localhost:4321'}`}/api/google`;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const subKey = (sub) => `google:${sub}`;

// Only ever go on to a page on this site.
const safeNext = (next) => (/^\/(?![/\\])[^\s]*$/.test(String(next || '')) && String(next).length < 500 ? String(next) : '/app.html');

function flowCookie(req, value, maxAge) {
  const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  // Lax, because Google's redirect back is a top-level GET from another site.
  return `${FLOW_COOKIE}=${value}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readFlow(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== FLOW_COOKIE) continue;
    const [state, verifier, nonce, next] = v.join('=').split('.');
    if (!state || !verifier || !nonce) return null;
    let to = '/app.html';
    try { to = safeNext(Buffer.from(next || '', 'base64url').toString()); } catch { /* default */ }
    return { state, verifier, nonce, next: to };
  }
  return null;
}

function redirect(res, location, cookies = []) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end();
}

// Back to the sign-in page with a reason it can explain.
const fail = (req, res, reason, next) => redirect(res, `/login.html?${new URLSearchParams({ google: reason, ...(next && next !== '/app.html' ? { next } : {}) })}`, [flowCookie(req, '', 0)]);

// Step 1: off to Google.
function start(req, res, url) {
  if (!configured()) return fail(req, res, 'off', safeNext(url.searchParams.get('next')));
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const nonce = b64url(crypto.randomBytes(24));
  const next = safeNext(url.searchParams.get('next'));
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  redirect(res, `${AUTH_URL}?${params}`, [flowCookie(req, [state, verifier, nonce, b64url(next)].join('.'), FLOW_TTL)]);
}

// Trade the one-time code for Google's ID token and read who it's for.
async function identityFrom(req, code, flow) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.id_token !== 'string') throw new Error(`token exchange failed: ${res.status} ${body.error || ''}`);
  const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1] || '', 'base64url').toString());
  if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer');
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('wrong audience');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('expired token');
  if (claims.nonce !== flow.nonce) throw new Error('wrong nonce');
  if (!claims.sub) throw new Error('no subject');
  return claims;
}

// A name Shohmot can use: Google's, else the start of the email.
function nameFrom(claims) {
  for (const raw of [claims.name, claims.given_name, String(claims.email).split('@')[0]]) {
    try { return auth.cleanName(String(raw || '').slice(0, 40)); } catch { /* try the next one */ }
  }
  return 'Player';
}

// Find the account for this Google login, linking or making one as needed.
// Returns { user, created }.
async function accountFor(claims) {
  // Already linked: the Google account id is what counts, even if its email changed.
  const linked = await store.get(subKey(claims.sub));
  if (linked) {
    const user = await getUser(linked);
    if (user) return { user, created: false };
    await store.del(subKey(claims.sub)); // the account was deleted
  }

  const email = auth.cleanEmail(claims.email);
  const existing = await getUser(email);
  if (existing) {
    existing.googleSub = claims.sub;
    if (!existing.verified) {
      // Someone made a password account with this email but never proved they
      // own it. Google just proved this person does, so that password and any
      // sessions made with it stop working: nobody can pre-plant an account.
      existing.hash = null;
      existing.sessionsAfter = Date.now();
      existing.verified = true;
    }
    await saveUser(existing);
    await store.set(subKey(claims.sub), email);
    return { user: existing, created: false };
  }

  const user = {
    id: crypto.randomUUID(), name: nameFrom(claims), email, hash: null, googleSub: claims.sub,
    accounts: [], createdAt: Date.now(), verified: true, indexed: true,
  };
  if (!(await store.set(userKey(email), JSON.stringify(user), { nx: true }))) {
    // Made by another request a moment ago: link to that one instead.
    return accountFor(claims);
  }
  await store.set(`uid:${user.id}`, email);
  await store.set(subKey(claims.sub), email);
  await store.sadd(auth.USERS, email);
  return { user, created: true };
}

// Step 2: Google sent them back.
async function callback(req, res, url) {
  const flow = readFlow(req);
  const next = flow ? flow.next : '/app.html';
  if (url.searchParams.get('error')) return fail(req, res, 'cancelled', next); // they pressed Cancel
  if (!configured()) return fail(req, res, 'off');
  const state = url.searchParams.get('state') || '';
  if (!flow || state.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
    return fail(req, res, 'expired', next);
  }
  await auth.rateLimit(`google-ip:${auth.clientIp(req)}`, 30, 900, 'Too many sign-in attempts. Wait 15 minutes and try again.');

  let claims;
  try {
    claims = await identityFrom(req, url.searchParams.get('code') || '', flow);
  } catch (err) {
    console.error('google sign-in:', err.message);
    return fail(req, res, 'failed', next);
  }
  if (claims.email_verified !== true || !claims.email) return fail(req, res, 'unverified', next);

  const { user, created } = await accountFor(claims);
  await auth.startSession(req, res, user.email);
  const sessionCookies = res.getHeader('Set-Cookie');
  if (created) await auth.hooks.afterRegister(req, user);
  else await store.del(`rl:login-fail:${sha256(user.email)}`);
  // ?signed= tells the page to drop any cached profile (session.js).
  const to = new URL(next, 'http://x');
  to.searchParams.set('signed', created ? 'new' : 'google');
  redirect(res, to.pathname + to.search + to.hash, [...[].concat(sessionCookies || []), flowCookie(req, '', 0)]);
}

const google = handler(async (req, res) => {
  onlyMethods(req, 'GET', 'HEAD');
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('code') || url.searchParams.has('error') || url.searchParams.has('state')) return callback(req, res, url);
  return start(req, res, url);
});

module.exports = { google, configured, accountFor, safeNext };
