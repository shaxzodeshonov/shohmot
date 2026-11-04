// Everything about an account besides signing in: password reset, email
// verification, signing out everywhere, exporting and deleting it, and the
// one-click unsubscribe link in emails.
//
// POST /api/account { action, ... }
//   forgot { email }               emails a reset link (always answers the same)
//   reset { token, password }      sets a new password, ends every other session
//   verify { token }               confirms the email address
//   resend-verify                  sends the confirmation email again
//   signout-all                    ends every session, including this one
//   password { current, password } changes the password, ends other sessions
//   delete { password }            deletes the account for good
// GET /api/account                 downloads everything stored about you (JSON)
// GET /api/account?unsubscribe=<email>&sig=<hmac>   stops the weekly email
const crypto = require('crypto');
const { store } = require('./store');
const auth = require('./auth');
const mail = require('./mail');
const plans = require('./plans');

const { HttpError, send, handler, onlyMethods, readJson, requireUser, getUser, saveUser, publicUser, sha256 } = auth;

const RESET_TTL = 3600; // an hour
const VERIFY_TTL = 7 * 86400;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const newToken = () => crypto.randomBytes(32).toString('base64url');

// Signs unsubscribe links. Set SHOHMOT_SECRET (any long random string) so old
// links keep working across deploys; without it they work until the server restarts.
let fallbackSecret = null;
function secret() {
  return process.env.SHOHMOT_SECRET || process.env.CRON_SECRET || (fallbackSecret ||= crypto.randomBytes(32).toString('hex'));
}
const unsubSig = (email) => crypto.createHmac('sha256', secret()).update(`unsub:${email}`).digest('base64url');
const unsubUrl = (req, email) => `${mail.siteUrl(req)}/api/account?${new URLSearchParams({ unsubscribe: email, sig: unsubSig(email) })}`;

async function sendVerify(req, user) {
  const token = newToken();
  await store.set(`verify:${sha256(token)}`, user.email, { ttl: VERIFY_TTL });
  const link = `${mail.siteUrl(req)}/verify.html#token=${token}`;
  const { html, text } = mail.layout({
    heading: `Confirm your email, ${user.name}`,
    body: ['Tap the button to confirm this is your email address. It keeps your account recoverable and lets Shohmot send your weekly recap.', 'The link works for 7 days.'],
    button: { label: 'Confirm my email', url: link },
    footer: 'You got this because someone made a Shohmot account with this address. If it wasn’t you, ignore this email.',
  });
  await mail.sendMail({ to: user.email, subject: 'Confirm your email for Shohmot', html, text });
}

// New accounts get the confirmation email straight away. Sign-up still works
// if email can't be sent.
auth.hooks.afterRegister = async (req, user) => {
  try {
    if (mail.configured()) await sendVerify(req, user);
  } catch (err) {
    console.error('verify email failed', err.message);
  }
  try { await require('./events').count('signup'); } catch { /* analytics never blocks sign-up */ }
};

async function forgot(req, body) {
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email || email.length > 254) throw new HttpError(400, 'Enter the email you signed up with.');
  if (!mail.configured()) throw new HttpError(503, 'Email isn’t set up on this server yet, so passwords can’t be reset. Contact support.');
  await auth.rateLimit(`forgot-ip:${auth.clientIp(req)}`, 10, 3600, 'Too many reset requests from here. Try again in an hour.');
  // Quietly cap emails per address, so nobody can flood someone's inbox.
  const perEmail = await store.incr(`rl:forgot:${sha256(email)}`, 3600);
  const user = perEmail <= 3 ? await getUser(email) : null;
  if (user) {
    const token = newToken();
    await store.set(`reset:${sha256(token)}`, email, { ttl: RESET_TTL });
    const link = `${mail.siteUrl(req)}/reset.html#token=${token}`;
    const { html, text } = mail.layout({
      heading: 'Reset your password',
      body: [`Hi ${user.name}, someone (hopefully you) asked to reset the password on your Shohmot account.`, 'The link works for one hour, once.'],
      button: { label: 'Choose a new password', url: link },
      footer: 'If you didn’t ask for this, ignore this email: your password stays the same.',
    });
    await mail.sendMail({ to: email, subject: 'Reset your Shohmot password', html, text });
  }
  // The same answer whether or not there's an account, so this can't be used
  // to find out who has one.
  return { ok: true, message: 'If there’s an account with that email, a reset link is on its way. Check your inbox.' };
}

async function reset(req, res, body) {
  const token = String(body.token || '');
  if (!TOKEN_RE.test(token)) throw new HttpError(400, 'That reset link is broken. Ask for a new one.');
  await auth.rateLimit(`reset-ip:${auth.clientIp(req)}`, 20, 3600, 'Too many tries. Wait an hour and try again.');
  const key = `reset:${sha256(token)}`;
  const email = await store.get(key);
  if (!email) throw new HttpError(400, 'That reset link has expired or was already used. Ask for a new one.');
  auth.checkPassword(body.password, email);
  if (await auth.isBreached(body.password)) {
    throw new HttpError(400, 'That password has shown up in a data breach, so attackers try it first. Pick another.');
  }
  const user = await getUser(email);
  if (!user) throw new HttpError(400, 'That account no longer exists.');
  await store.del(key);
  user.hash = await auth.hashPassword(body.password);
  user.verified = true; // they just proved they read this inbox
  user.sessionsAfter = Date.now(); // every other session ends
  await saveUser(user);
  await store.del(`rl:login-fail:${sha256(email)}`);
  await auth.startSession(req, res, email);
  return { ok: true, user: publicUser(user) };
}

async function verify(body) {
  const token = String(body.token || '');
  if (!TOKEN_RE.test(token)) throw new HttpError(400, 'That confirmation link is broken.');
  const key = `verify:${sha256(token)}`;
  const email = await store.get(key);
  if (!email) throw new HttpError(400, 'That confirmation link has expired or was already used. Send a new one from Settings.');
  const user = await getUser(email);
  if (!user) throw new HttpError(400, 'That account no longer exists.');
  await store.del(key);
  user.verified = true;
  await saveUser(user);
  return { ok: true, email };
}

async function remove(req, res, user, body) {
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  if (!(await auth.verifyPassword(password, user.hash))) throw new HttpError(401, 'That password isn’t right.');
  // Stop billing first, so nobody pays for an account that's gone.
  await require('./billing').cancelFor(user);
  await require('./coach').forget(user);
  await store.del(auth.userKey(user.email));
  if (user.id) await store.del(`uid:${user.id}`);
  if (user.stripeCustomer) await store.del(`stripe-customer:${user.stripeCustomer}`);
  await store.srem(auth.USERS, user.email);
  const token = auth.readCookie(req);
  if (token) await store.del(auth.sessionKey(token));
  res.setHeader('Set-Cookie', auth.cookieHeaders(req, '', 0));
  return { ok: true };
}

// Everything kept about the account, minus the password hash and session tokens.
function exportOf(user) {
  return {
    exportedAt: new Date().toISOString(),
    account: {
      name: user.name,
      email: user.email,
      createdAt: new Date(user.createdAt).toISOString(),
      verified: user.verified === true,
      plan: plans.planOf(user),
      planRenews: user.planRenews ? new Date(user.planRenews).toISOString() : null,
    },
    chessAccounts: user.accounts || [],
    settings: plans.prefsFor(user),
    coach: user.coach ? { name: user.coachName || null } : null,
    students: (user.students || []).length,
    note: 'Game reviews, analysis and puzzles are kept in your browser, not on Shohmot’s server, so they are not in this file.',
  };
}

function unsubscribePage(res, ok) {
  res.statusCode = ok ? 200 : 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shohmot</title>
<body style="background:#1b140f;color:#efe1c6;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem">
<div style="max-width:28rem"><h1 style="font-size:1.75rem">${ok ? 'You’re unsubscribed' : 'That link didn’t work'}</h1>
<p style="color:#b8a385">${ok ? 'Shohmot won’t send you the weekly recap any more. You can turn it back on in Settings.' : 'Turn the weekly email off in Settings instead.'}</p>
<p><a href="/settings.html" style="color:#c6ceb2">Open Settings</a></p></div></body>`);
}

const account = handler(async (req, res) => {
  onlyMethods(req, 'GET', 'POST');
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const email = url.searchParams.get('unsubscribe');
    if (email !== null) {
      const sig = url.searchParams.get('sig') || '';
      const want = unsubSig(email);
      const ok = sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
      const user = ok ? await getUser(email) : null;
      if (user) {
        user.prefs = { ...(user.prefs || {}), weeklyEmail: false };
        await saveUser(user);
      }
      return unsubscribePage(res, !!user);
    }
    const user = await requireUser(req, res);
    res.setHeader('Content-Disposition', 'attachment; filename="shohmot-account.json"');
    return send(res, 200, exportOf(user));
  }

  const body = await readJson(req);
  switch (body.action) {
    case 'forgot': return send(res, 200, await forgot(req, body));
    case 'reset': return send(res, 200, await reset(req, res, body));
    case 'verify': return send(res, 200, await verify(body));
    case 'resend-verify': {
      const user = await requireUser(req, res);
      if (user.verified) return send(res, 200, { ok: true, message: 'Your email is already confirmed.' });
      if (!mail.configured()) throw new HttpError(503, 'Email isn’t set up on this server yet.');
      await auth.rateLimit(`resend:${sha256(user.email)}`, 3, 3600, 'We’ve sent a few already. Check your spam folder, or try again in an hour.');
      await sendVerify(req, user);
      return send(res, 200, { ok: true, message: `Sent. Check ${user.email}.` });
    }
    case 'signout-all': {
      const user = await requireUser(req, res);
      user.sessionsAfter = Date.now();
      await saveUser(user);
      res.setHeader('Set-Cookie', auth.cookieHeaders(req, '', 0));
      return send(res, 200, { ok: true });
    }
    case 'password': {
      const user = await requireUser(req, res);
      const current = typeof body.current === 'string' ? body.current.slice(0, 128) : '';
      await auth.rateLimit(`pw-change:${sha256(user.email)}`, 10, 900, 'Too many tries. Wait 15 minutes and try again.');
      if (!(await auth.verifyPassword(current, user.hash))) throw new HttpError(401, 'Your current password isn’t right.');
      auth.checkPassword(body.password, user.email);
      if (await auth.isBreached(body.password)) throw new HttpError(400, 'That password has shown up in a data breach, so attackers try it first. Pick another.');
      user.hash = await auth.hashPassword(body.password);
      user.sessionsAfter = Date.now();
      await saveUser(user);
      await auth.startSession(req, res, user.email); // this device stays signed in
      return send(res, 200, { ok: true, user: publicUser(user) });
    }
    case 'delete': {
      const user = await requireUser(req, res);
      return send(res, 200, await remove(req, res, user, body));
    }
    default: throw new HttpError(400, 'Unknown action.');
  }
});

module.exports = { account, unsubUrl, exportOf };
