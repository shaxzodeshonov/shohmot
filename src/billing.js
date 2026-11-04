// Paid plans through Stripe, with no SDK: Stripe's REST API takes form-encoded
// requests, and webhooks are checked with an HMAC from Node's crypto.
//
// Env (see .env.example):
//   STRIPE_SECRET_KEY       sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET   whsec_... from the webhook endpoint you add in Stripe
//   STRIPE_PRICE_PRO        price_... of the Pro subscription
//   STRIPE_PRICE_COACH      price_... of the Coach subscription (optional)
//
// POST /api/billing { action: 'checkout', plan: 'pro'|'coach' } -> { url } of Stripe Checkout
// POST /api/billing { action: 'portal' } -> { url } of Stripe's billing portal
//      (change card, switch plan, cancel, download invoices)
// POST /api/stripe-webhook   Stripe tells us about subscriptions; sets user.plan
const crypto = require('crypto');
const { store } = require('./store');
const auth = require('./auth');
const plans = require('./plans');
const mail = require('./mail');

const { HttpError, send, handler, onlyMethods, readJson, requireUser, getUser, saveUser } = auth;
const API = 'https://api.stripe.com/v1';

// Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0][b]=v.
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(method, path, params) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: params ? form(params).toString() : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Stripe ${res.status}: ${(body.error && body.error.message) || 'request failed'}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const priceFor = (plan) => (plan === 'coach' ? process.env.STRIPE_PRICE_COACH : plan === 'pro' ? process.env.STRIPE_PRICE_PRO : null);
function planForPrice(price) {
  if (price && price === process.env.STRIPE_PRICE_COACH) return 'coach';
  if (price && price === process.env.STRIPE_PRICE_PRO) return 'pro';
  return null;
}

async function customerFor(user) {
  if (user.stripeCustomer) return user.stripeCustomer;
  const c = await stripe('POST', '/customers', { email: user.email, name: user.name, metadata: { shohmot_email: user.email } });
  user.stripeCustomer = c.id;
  await saveUser(user);
  await store.set(`stripe-customer:${c.id}`, user.email);
  return c.id;
}

async function checkout(req, user, plan) {
  if (!['pro', 'coach'].includes(plan)) throw new HttpError(400, 'Pick Pro or Coach.');
  const price = priceFor(plan);
  if (!price) throw new HttpError(400, 'That plan isn’t on sale yet.');
  // Someone who already pays changes plan in the portal, so they're never billed twice.
  if (user.subscription && plans.planOf(user) !== 'free' && !plans.isAdmin(user)) return portal(req, user);
  const site = mail.siteUrl(req);
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: await customerFor(user),
    client_reference_id: user.email,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: 'true',
    subscription_data: { metadata: { shohmot_email: user.email } },
    success_url: `${site}/settings.html?upgraded=${plan}`,
    cancel_url: `${site}/pricing.html?canceled=1`,
  });
  try { await require('./events').count('checkout_started'); } catch { /* analytics never blocks */ }
  return { url: session.url };
}

async function portal(req, user) {
  if (!user.stripeCustomer) throw new HttpError(400, 'You don’t have a paid plan yet.');
  const session = await stripe('POST', '/billing_portal/sessions', { customer: user.stripeCustomer, return_url: `${mail.siteUrl(req)}/settings.html` });
  return { url: session.url };
}

// Deleting an account cancels its subscription straight away.
async function cancelFor(user) {
  if (!user.subscription || !process.env.STRIPE_SECRET_KEY) return;
  try {
    await stripe('DELETE', `/subscriptions/${encodeURIComponent(user.subscription)}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

const billing = handler(async (req, res) => {
  onlyMethods(req, 'POST');
  const body = await readJson(req);
  const user = await requireUser(req, res);
  if (!plans.billingOn()) throw new HttpError(503, 'Paid plans aren’t switched on on this server yet.');
  await auth.rateLimit(`billing:${auth.clientIp(req)}`, 30, 3600, 'Too many tries. Wait a while and try again.');
  if (body.action === 'checkout') return send(res, 200, await checkout(req, user, body.plan));
  if (body.action === 'portal') return send(res, 200, await portal(req, user));
  throw new HttpError(400, 'Unknown action.');
});

// ---------- webhook ----------
// Stripe signs each delivery: header "t=<unix>,v1=<hex hmac of `${t}.${body}`>".
function verifySignature(raw, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.create(null);
  const sigs = [];
  for (const kv of String(header).split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'v1') sigs.push(v); else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s && s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

async function rawBody(req) {
  // Vercel parses bodies lazily: reading the stream before touching req.body
  // gets the exact bytes Stripe signed.
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 512 * 1024) throw new HttpError(413, 'Too big.');
  }
  return raw;
}

async function userForCustomer(customer, fallbackEmail) {
  const email = (customer && (await store.get(`stripe-customer:${customer}`))) || fallbackEmail;
  return email ? getUser(email) : null;
}

// Copy a subscription's state onto the account.
async function applySubscription(sub) {
  const email = sub.metadata && sub.metadata.shohmot_email;
  const user = await userForCustomer(sub.customer, email);
  if (!user) return false;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const plan = planForPrice(item && item.price && item.price.id);
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const was = user.plan || 'free';
  user.plan = live && plan ? plan : 'free';
  user.subscription = live ? sub.id : null;
  const end = (item && item.current_period_end) || sub.current_period_end;
  user.planRenews = live && end ? end * 1000 : null;
  user.planCancels = live && !!sub.cancel_at_period_end;
  user.stripeCustomer ||= sub.customer;
  await saveUser(user);
  if (sub.customer) await store.set(`stripe-customer:${sub.customer}`, user.email);
  if (was === 'free' && user.plan !== 'free') { try { await require('./events').count('subscribed'); } catch { /* */ } }
  if (was !== 'free' && user.plan === 'free') { try { await require('./events').count('churned'); } catch { /* */ } }
  return true;
}

const webhook = async (req, res) => {
  const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  let raw;
  try { raw = await rawBody(req); } catch { return reply(413, { error: 'Too big' }); }
  if (!verifySignature(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return reply(400, { error: 'Bad signature' });
  let event;
  try { event = JSON.parse(raw); } catch { return reply(400, { error: 'Bad JSON' }); }
  try {
    // Stripe can deliver an event more than once.
    if (!(await store.set(`stripe-evt:${event.id}`, '1', { ttl: 7 * 86400, nx: true }))) return reply(200, { ok: true, duplicate: true });
    const obj = event.data && event.data.object;
    if (event.type === 'checkout.session.completed' && obj.subscription) {
      // Fetch the subscription so the plan comes from its price, not the session.
      const sub = await stripe('GET', `/subscriptions/${encodeURIComponent(obj.subscription)}`);
      if (!sub.metadata || !sub.metadata.shohmot_email) sub.metadata = { ...(sub.metadata || {}), shohmot_email: obj.client_reference_id };
      await applySubscription(sub);
    } else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(event.type)) {
      await applySubscription(obj);
    }
    reply(200, { ok: true });
  } catch (err) {
    console.error('stripe webhook', err);
    // Let Stripe retry later.
    await store.del(`stripe-evt:${event.id}`).catch(() => {});
    reply(500, { error: 'Failed' });
  }
};

module.exports = { billing, webhook, verifySignature, applySubscription, cancelFor, form, planForPrice };
