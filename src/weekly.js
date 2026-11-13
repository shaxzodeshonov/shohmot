// The weekly recap email: last week's games on each account, the rating
// change, the longest losing streak and the busiest day, with one tip.
//
// GET /api/cron runs it. On Vercel, vercel.json's cron calls it every day at
// 08:10 UTC with "Authorization: Bearer $CRON_SECRET". Each run mails
// everyone due this week who hasn't had theirs yet, until it runs short of
// time, so a big list just takes a few days' runs. Only confirmed emails with
// the weekly email on (the default) get one, and each email has a one-click
// unsubscribe link.
const crypto = require('crypto');
const { store } = require('./store');
const auth = require('./auth');
const mail = require('./mail');
const plans = require('./plans');
const { fetchAccount } = require('./games');

const DAY = 86400000;
const BUDGET_MS = 50000; // Vercel stops the function at 60s
const SITE_NAME = { chesscom: 'Chess.com', lichess: 'Lichess' };

// The ISO week a time falls in, e.g. "2026-W45".
function isoWeek(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const postRating = (g) => (g.ratingDiff != null ? g.rating + g.ratingDiff : g.rating);

// Pure: games from fetchAccount for each account -> the numbers in the email.
function summarize(accounts, now = Date.now()) {
  const from = now - 7 * DAY;
  const all = [];
  const per = accounts.map((a) => {
    const games = (a.games || []).filter((g) => g.end >= from && g.end < now);
    all.push(...games);
    const speeds = {};
    for (const g of games) {
      if (!g.rated || g.rating == null) continue;
      const s = speeds[g.speed] || (speeds[g.speed] = { first: null, last: null, n: 0 });
      s.n++;
      s.last = postRating(g);
      if (s.first == null) {
        // The rating going into the week: the last game before it, else this game's start.
        const before = (a.games || []).filter((x) => x.speed === g.speed && x.rated && x.end < from && x.rating != null).pop();
        s.first = before ? postRating(before) : g.rating;
      }
    }
    const ratings = Object.entries(speeds).map(([speed, s]) => ({ speed, rating: s.last, change: s.last - s.first, games: s.n }))
      .sort((x, y) => y.games - x.games);
    return {
      platform: a.platform,
      username: (a.profile && a.profile.displayName) || a.username,
      games: games.length,
      won: games.filter((g) => g.result === 'win').length,
      lost: games.filter((g) => g.result === 'loss').length,
      ratings,
    };
  });
  all.sort((x, y) => x.end - y.end);
  let streak = 0;
  let worst = 0;
  for (const g of all) { streak = g.result === 'loss' ? streak + 1 : 0; worst = Math.max(worst, streak); }
  const byDay = new Map();
  for (const g of all) { const k = new Date(g.end).toISOString().slice(0, 10); byDay.set(k, (byDay.get(k) || 0) + 1); }
  const busiest = [...byDay.entries()].sort((x, y) => y[1] - x[1])[0] || null;
  const total = all.length;
  const won = all.filter((g) => g.result === 'win').length;
  const lost = all.filter((g) => g.result === 'loss').length;
  let tip;
  if (!total) tip = 'No games last week. Even ten minutes of rapid keeps your eye sharp.';
  else if (worst >= 4) tip = `Your longest losing streak was ${worst} games. A short break after 3 losses in a row usually saves rating; Shohmot can remind you.`;
  else if (busiest && busiest[1] >= 25) tip = `You played ${busiest[1]} games in one day. Fewer, longer games teach more than a bullet marathon.`;
  else if (lost > won) tip = 'More losses than wins last week. Review two of the losses: the same kind of mistake often shows up twice.';
  else tip = 'A winning week. Review your best game too: knowing why it worked is how it happens again.';
  return { total, won, lost, drawn: total - won - lost, worstStreak: worst, busiest: busiest ? { day: busiest[0], games: busiest[1] } : null, accounts: per, tip };
}

function emailFor(req, user, s) {
  const lines = [];
  if (s.total) {
    lines.push(`Last week you played ${s.total} game${s.total === 1 ? '' : 's'}: ${s.won} won, ${s.drawn} drawn, ${s.lost} lost.`);
    for (const a of s.accounts) {
      if (!a.games) continue;
      const r = a.ratings.slice(0, 3).map((x) => `${x.speed} ${x.rating} (${x.change >= 0 ? '+' : '−'}${Math.abs(x.change)})`).join(', ');
      lines.push(`${a.username} on ${SITE_NAME[a.platform]}: ${a.games} games${r ? `, ${r}` : ''}.`);
    }
    if (s.busiest) lines.push(`Busiest day: ${new Date(`${s.busiest.day}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}, with ${s.busiest.games} games.`);
  } else {
    lines.push('No games on your accounts last week.');
  }
  lines.push(`Tip: ${s.tip}`);
  const unsub = require('./account').unsubUrl(req, user.email);
  const { html, text } = mail.layout({
    heading: `Your chess week, ${user.name}`,
    body: lines,
    button: { label: 'Open Shohmot', url: `${mail.siteUrl(req)}/app.html` },
    footer: `You get this every Monday because the weekly email is on in your Shohmot settings. <a href="${mail.esc(unsub)}" style="color:#5d6f64">Unsubscribe</a>.`,
  });
  return {
    to: user.email,
    subject: s.total ? `Your chess week: ${s.total} games, ${s.won} won` : 'Your chess week on Shohmot',
    html,
    text: `${text}\n\nUnsubscribe: ${unsub}`,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

function authorized(req) {
  const want = process.env.CRON_SECRET;
  if (!want) return !process.env.VERCEL; // locally anyone may run it
  const got = String(req.headers.authorization || '');
  const exp = `Bearer ${want}`;
  return got.length === exp.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(exp));
}

async function runWeekly(req, { now = Date.now(), budget = BUDGET_MS } = {}) {
  const started = Date.now();
  const week = isoWeek(now);
  const doneKey = `weekly:${week}`;
  const emails = await store.smembers(auth.USERS);
  const done = new Set(await store.smembers(doneKey));
  let sent = 0, skipped = 0, failed = 0;
  for (const email of emails) {
    if (Date.now() - started > budget) break;
    if (done.has(email)) continue;
    const user = await auth.getUser(email);
    const prefs = plans.prefsFor(user);
    if (!user || !user.verified || !prefs.weeklyEmail || !(user.accounts || []).length) {
      skipped++;
      await store.sadd(doneKey, email);
      continue;
    }
    try {
      const accounts = await Promise.all(user.accounts.map((a) => fetchAccount(a.platform, a.username, { days: 21 })));
      await mail.sendMail(emailFor(req, user, summarize(accounts, now)));
      await store.sadd(doneKey, email);
      sent++;
    } catch (err) {
      failed++;
      console.error('weekly email', email, err.message);
    }
  }
  const left = emails.length - (await store.scard(doneKey));
  return { week, sent, skipped, failed, left };
}

const cron = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Unauthorized' })); }
  try {
    // Only Mondays to Thursdays, so a recap never arrives about a stale week.
    const dow = new Date().getUTCDay();
    const out = dow >= 1 && dow <= 4 ? await runWeekly(req) : { skipped: 'not a recap day' };
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (err) {
    console.error('cron', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};

module.exports = { cron, runWeekly, summarize, isoWeek, emailFor };
