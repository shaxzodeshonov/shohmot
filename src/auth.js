// Shohmot accounts: sign up, sign in, sign out and the signed-in user's
// profile. Built on Node's own crypto, no packages:
// - passwords are hashed with scrypt (OWASP's N=2^15, r=8, p=3) and a random salt;
// - a session is a random 32-byte token in an HttpOnly cookie, and the store
//   keeps only its SHA-256, so a leaked store holds no usable sessions;
// - POSTs must be JSON from this site's own origin (CSRF), and sign-up and
//   sign-in are rate limited per IP and per email.
const crypto = require('crypto');
const { promisify } = require('util');
const { store, NotConfiguredError } = require('./store');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3 };
const KEY_LEN = 32;
const COOKIE = 'shohmot_sid';
const HINT_COOKIE = 'shohmot_in';
const SESSION_DAYS = 30;
const SESSION_TTL = SESSION_DAYS * 86400;
const MAX_BODY = 8 * 1024;
const MAX_ACCOUNTS = 4;
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', '11111111', '00000000', 'iloveyou', 'abcd1234', 'chess123', 'chesscom', 'shohmot1']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- passwords ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(got, want);
}

// Signing in with an unknown email still costs one scrypt, so response times
// don't tell which emails have accounts.
let dummyHash = null;
const getDummyHash = () => (dummyHash ||= hashPassword(crypto.randomBytes(16).toString('hex')));

// ---------- validation ----------
function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, 'Tell us what to call you.');
  if (name.length > 40) throw new HttpError(400, 'Keep your name under 40 characters.');
  return name;
}

function cleanEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'That doesn’t look like an email address.');
  return email;
}

function checkPassword(password, email) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');
  if (password.length > 128) throw new HttpError(400, 'Keep your password under 128 characters.');
  if (COMMON.has(password.toLowerCase()) || password.toLowerCase() === email) throw new HttpError(400, 'That password is too easy to guess. Pick another.');
}

function cleanAccounts(raw) {
  if (!Array.isArray(raw)) throw new HttpError(400, 'Accounts should be a list.');
  const out = [];
  for (const a of raw) {
    if (!a || !['chesscom', 'lichess'].includes(a.platform) || !USERNAME_RE.test(a.username || '')) continue;
    if (!out.some((b) => b.platform === a.platform && b.username.toLowerCase() === a.username.toLowerCase())) {
      out.push({ platform: a.platform, username: a.username });
    }
  }
  return out.slice(0, MAX_ACCOUNTS);
}

// ---------- request helpers ----------
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  const h = req.headers;
  if (process.env.VERCEL) return h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// A form on another site can't send JSON without a CORS preflight, and
// browsers always send Origin on cross-site POSTs, so these two checks stop CSRF.
function checkSameOrigin(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== (req.headers['x-forwarded-host'] || req.headers.host)) throw new HttpError(403, 'That request came from another site.');
  }
}

async function readJson(req) {
  checkSameOrigin(req);
  // Vercel has already read and parsed the body.
  let body;
  try { body = req.body; } catch { throw new HttpError(400, 'That request wasn’t valid JSON.'); }
  if (body !== undefined) {
    if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) return body;
    body = String(body);
  } else {
    body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) throw new HttpError(413, 'That request is too big.');
    }
  }
  try {
    const parsed = JSON.parse(body || '{}');
    if (typeof parsed !== 'object' || parsed === null) throw new Error();
    return parsed;
  } catch { throw new HttpError(400, 'That request wasn’t valid JSON.'); }
}

// The session cookie, plus `shohmot_in=1`, which scripts can read: it holds
// nothing secret and only lets pages know at once that someone is signed in.
function cookieHeaders(req, value, maxAge) {
  const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return [
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    `${HINT_COOKIE}=${value ? 1 : ''}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  ];
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const userKey = (email) => `user:${email}`;
const sessionKey = (token) => `session:${sha256(token)}`;
const publicUser = (u) => ({ name: u.name, email: u.email, accounts: u.accounts || [], createdAt: u.createdAt });

async function rateLimit(key, max, windowSec, message) {
  if ((await store.incr(`rl:${key}`, windowSec)) > max) throw new HttpError(429, message);
}

async function startSession(req, res, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.set(sessionKey(token), email, { ttl: SESSION_TTL });
  res.setHeader('Set-Cookie', cookieHeaders(req, token, SESSION_TTL));
}

async function currentUser(req) {
  const token = readCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const email = await store.get(sessionKey(token));
  if (!email) return null;
  const raw = await store.get(userKey(email));
  return raw ? JSON.parse(raw) : null;
}

// Turn thrown errors into JSON answers.
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof NotConfiguredError) return send(res, 503, { error: 'Accounts aren’t set up on this server yet: it needs a database (see the README).' });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on the server.' });
    }
  };
}

function onlyMethods(req, ...methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, 'Method not allowed.');
}

// POST /api/register { name, email, password }
const register = handler(async (req, res) => {
  onlyMethods(req, 'POST');
  const body = await readJson(req);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  checkPassword(body.password, email);
  await rateLimit(`register:${clientIp(req)}`, 10, 3600, 'Too many new accounts from here. Try again in an hour.');
  const user = { id: crypto.randomUUID(), name, email, hash: await hashPassword(body.password), accounts: [], createdAt: Date.now() };
  if (!(await store.set(userKey(email), JSON.stringify(user), { nx: true }))) {
    throw new HttpError(409, 'There’s already an account with this email. Sign in instead.');
  }
  await startSession(req, res, email);
  send(res, 201, { user: publicUser(user) });
});

// POST /api/login { email, password }
const login = handler(async (req, res) => {
  onlyMethods(req, 'POST');
  const body = await readJson(req);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  if (!email || !password) throw new HttpError(400, 'Enter your email and password.');
  await rateLimit(`login-ip:${clientIp(req)}`, 30, 900, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  const failKey = `rl:login-fail:${sha256(email)}`;
  if (Number(await store.get(failKey)) >= 10) throw new HttpError(429, 'Too many wrong passwords for this email. Wait 15 minutes and try again.');
  const raw = await store.get(userKey(email));
  const user = raw ? JSON.parse(raw) : null;
  const ok = await verifyPassword(password, user ? user.hash : await getDummyHash());
  if (!user || !ok) {
    await store.incr(failKey, 900);
    throw new HttpError(401, 'Wrong email or password.');
  }
  await store.del(failKey);
  await startSession(req, res, email);
  send(res, 200, { user: publicUser(user) });
});

// POST /api/logout
const logout = handler(async (req, res) => {
  onlyMethods(req, 'POST');
  checkSameOrigin(req);
  const token = readCookie(req);
  if (token) await store.del(sessionKey(token));
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeaders(req, '', 0) });
});

// GET /api/me -> the signed-in user; POST /api/me { name?, accounts? } updates them.
const me = handler(async (req, res) => {
  onlyMethods(req, 'GET', 'HEAD', 'POST');
  const user = await currentUser(req);
  if (!user) {
    res.setHeader('Set-Cookie', cookieHeaders(req, '', 0));
    throw new HttpError(401, 'You’re not signed in.');
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    if (body.name !== undefined) user.name = cleanName(body.name);
    if (body.accounts !== undefined) user.accounts = cleanAccounts(body.accounts);
    await store.set(userKey(user.email), JSON.stringify(user));
  }
  send(res, 200, { user: publicUser(user) });
});

module.exports = { register, login, logout, me, hashPassword, verifyPassword };
