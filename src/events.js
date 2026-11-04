// First-party analytics without cookies or third parties: each event bumps a
// counter for the day, and unique visitors are counted with a HyperLogLog of
// a daily-salted hash of IP + browser, so nobody can be followed across days
// and nothing personal is kept.
//
// POST /api/event { name, path? }   from the pages (navigator.sendBeacon)
// GET  /api/admin?days=30           numbers for the admin page (ADMIN_EMAILS only)
// GET  /api/health                  for uptime monitors
const crypto = require('crypto');
const { store, NotConfiguredError, describeDb } = require('./store');
const auth = require('./auth');
const plans = require('./plans');
const mail = require('./mail');

const { HttpError, send, handler, onlyMethods, requireUser } = auth;
const KEEP = 400 * 86400; // a bit over a year

// Every event the site sends. Anything else is dropped.
const EVENTS = [
  'page_view', 'signup', 'login', 'account_added', 'review_started', 'review_finished', 'review_shared',
  'guest_review', 'puzzle_solved', 'puzzle_failed', 'insights_viewed', 'tilt_alert', 'upgrade_clicked',
  'checkout_started', 'subscribed', 'churned', 'coach_joined', 'install', 'client_error',
];
// The pages page views are counted for, so the key space stays small.
const PAGES = ['/', '/app', '/review', '/analysis', '/train', '/brilliants', '/pricing', '/signup', '/login', '/settings', '/coach', '/join', '/features', '/privacy', '/terms'];
const FUNNEL = ['signup', 'account_added', 'review_finished', 'checkout_started', 'subscribed'];

const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

async function count(name, path) {
  const day = dayOf();
  await store.incr(`stats:${day}:${name}`, KEEP);
  if (path) await store.incr(`stats:${day}:pv:${path}`, KEEP);
}

async function salt(day) {
  const key = `stats-salt:${day}`;
  const fresh = crypto.randomBytes(16).toString('hex');
  await store.set(key, fresh, { ttl: 2 * 86400, nx: true });
  return (await store.get(key)) || fresh;
}

function pagePath(raw) {
  const p = String(raw || '').split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  if (p.startsWith('/features/')) return '/features';
  return PAGES.includes(p) ? p : null;
}

async function readBody(req) {
  // sendBeacon posts text/plain, which is fine here: an event can't change
  // anything but a counter, so it doesn't need the CSRF checks.
  let raw = '';
  try {
    if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    else for await (const chunk of req) { raw += chunk; if (raw.length > 4096) break; }
    return JSON.parse(raw.slice(0, 4096));
  } catch {
    return null;
  }
}

const event = async (req, res) => {
  res.statusCode = 204;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const data = await readBody(req);
  try {
    if (!data || !EVENTS.includes(data.name)) return res.end();
    if ((await store.incr(`rl:event:${auth.clientIp(req)}`, 600)) > 300) return res.end();
    if (data.name === 'client_error') {
      // Shows up in the server logs (Vercel → Logs), trimmed.
      console.error('[client]', String(data.message || '').slice(0, 300), String(data.where || '').slice(0, 200));
    }
    const path = data.name === 'page_view' ? pagePath(data.path) : null;
    if (data.name === 'page_view' && !path) return res.end();
    await count(data.name, path);
    if (data.name === 'page_view') {
      const day = dayOf();
      const who = crypto.createHash('sha256').update(`${await salt(day)}|${auth.clientIp(req)}|${req.headers['user-agent'] || ''}`).digest('base64url').slice(0, 16);
      await store.pfadd(`stats:${day}:uv`, who, KEEP);
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) console.error('event', err.message);
  }
  res.end();
};

// ---------- admin ----------
async function report(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(dayOf(Date.now() - i * 86400000));
  const keys = [];
  for (const d of dates) for (const e of EVENTS) keys.push(`stats:${d}:${e}`);
  for (const d of dates) for (const p of PAGES) keys.push(`stats:${d}:pv:${p}`);
  const vals = await store.mget(keys);
  const uv = await store.pfcount(dates.map((d) => `stats:${d}:uv`));
  let k = 0;
  const byDay = dates.map((d, i) => {
    const row = { day: d, visitors: Number(uv[i]) || 0, events: {}, pages: {} };
    for (const e of EVENTS) row.events[e] = Number(vals[k++]) || 0;
    return row;
  });
  for (const row of byDay) for (const p of PAGES) row.pages[p] = Number(vals[k++]) || 0;
  const totals = {};
  for (const e of EVENTS) totals[e] = byDay.reduce((s, r) => s + r.events[e], 0);
  const pages = {};
  for (const p of PAGES) pages[p] = byDay.reduce((s, r) => s + r.pages[p], 0);

  // Plans across every account. Fine for thousands of users; past that, keep counters instead.
  const emails = await store.smembers(auth.USERS);
  const planCounts = { free: 0, pro: 0, coach: 0 };
  let verified = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const raws = await store.mget(emails.slice(i, i + 100).map(auth.userKey));
    for (const raw of raws) {
      if (!raw) continue;
      const u = JSON.parse(raw);
      planCounts[plans.planOf(u)]++;
      if (u.verified) verified++;
    }
  }
  const price = { pro: Number(process.env.PRICE_PRO_MONTHLY) || 5, coach: Number(process.env.PRICE_COACH_MONTHLY) || 19 };
  return {
    days,
    byDay,
    totals,
    pages,
    funnel: FUNNEL.map((e) => ({ step: e, count: totals[e] })),
    users: { total: emails.length, verified, ...planCounts },
    // Rough monthly revenue from live plans at list price (Stripe has the real number).
    mrr: planCounts.pro * price.pro + planCounts.coach * price.coach,
  };
}

const admin = handler(async (req, res) => {
  onlyMethods(req, 'GET');
  const user = await requireUser(req, res);
  if (!plans.isAdmin(user)) throw new HttpError(403, 'Only admins can see this.');
  const days = Math.min(90, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 30));
  send(res, 200, await report(days));
});

// Says what's set up and what isn't (names only, never secrets).
const health = async (req, res) => {
  const info = describeDb();
  let db = false;
  let dbError = null;
  try { await store.get('health'); db = true; } catch (err) { dbError = err instanceof NotConfiguredError ? null : String(err.message).slice(0, 200); }
  const out = {
    ok: db,
    db,
    database: { ...info, ...(dbError ? { error: dbError, hint: 'The database was found but didn’t answer. Check the REST URL and token in the Upstash console match the env vars, then redeploy.' } : {}) },
    mail: mail.configured(),
    mailVia: mail.method(),
    ...(mail.configured() ? {} : { mailHint: 'No email set up, so password resets and confirmations can’t be sent. Easiest, with no domain: set GMAIL_USER and GMAIL_APP_PASSWORD (an app password from myaccount.google.com/apppasswords), then redeploy.' }),
    billing: plans.billingOn(),
    site: mail.siteUrl(req),
    time: new Date().toISOString(),
  };
  res.statusCode = db ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
};

module.exports = { event, admin, health, count, report, EVENTS, pagePath };
