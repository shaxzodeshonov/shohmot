// Plans and the settings that depend on them. No I/O here, so it's easy to
// test and every module can use it.
//
//   (While billing is off, every account gets everything below.)
//   free   counter, reviews, analysis board, play, loss-streak alerts,
//          weekly email, 10 saved puzzles
//   pro    + daily game limit, desktop notifications, Insights, unlimited puzzles
//   coach  + a coach dashboard for up to COACH_SEATS students
//
// A plan comes from a Stripe subscription (src/billing.js sets user.plan).
// Emails in ADMIN_EMAILS are admins, and get the coach plan for testing;
// emails in COMP_EMAILS get Pro for free (friends, testers, reviewers).
const PLANS = ['free', 'pro', 'coach'];
const COACH_SEATS = 30;
const FREE_PUZZLES = 10;

const emails = (name) => String(process.env[name] || '').toLowerCase().split(',').map((e) => e.trim()).filter(Boolean);
const isAdmin = (u) => !!u && emails('ADMIN_EMAILS').includes(u.email);

function planOf(u) {
  if (!u) return 'free';
  if (isAdmin(u)) return 'coach';
  if (PLANS.includes(u.plan) && u.plan !== 'free') return u.plan;
  if (emails('COMP_EMAILS').includes(u.email)) return 'pro';
  return 'free';
}
const isPro = (u) => planOf(u) !== 'free';
const isCoach = (u) => planOf(u) === 'coach';

// Billing is on once Stripe's key and at least the Pro price are set.
const billingOn = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO);

// Until billing is switched on, everything is free for everyone: Pro's
// features are open to every account, and anyone can coach. Turning billing
// on (the env vars above) brings the plans back without a code change.
const hasPro = (u) => !billingOn() || isPro(u);
const canCoach = (u) => !!u && (!billingOn() || isCoach(u));

const DEFAULT_PREFS = { lossStreak: 3, dailyLimit: 0, notify: false, weeklyEmail: true };

const int = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

// What's stored, filled in with defaults. Pro-only settings read as off on free.
function prefsFor(u) {
  const p = { ...DEFAULT_PREFS, ...((u && u.prefs) || {}) };
  if (!hasPro(u)) { p.dailyLimit = 0; p.notify = false; }
  return p;
}

// Only known keys, in range. Pro-only settings can't be turned on without Pro.
function cleanPrefs(raw, u) {
  if (!raw || typeof raw !== 'object') return prefsFor(u);
  const cur = { ...DEFAULT_PREFS, ...((u && u.prefs) || {}) };
  const out = {
    lossStreak: raw.lossStreak === undefined ? cur.lossStreak : int(raw.lossStreak, 0, 10, cur.lossStreak),
    dailyLimit: raw.dailyLimit === undefined ? cur.dailyLimit : int(raw.dailyLimit, 0, 200, cur.dailyLimit),
    notify: raw.notify === undefined ? cur.notify : raw.notify === true,
    weeklyEmail: raw.weeklyEmail === undefined ? cur.weeklyEmail : raw.weeklyEmail === true,
  };
  if (!hasPro(u)) { out.dailyLimit = 0; out.notify = false; }
  return out;
}

module.exports = { PLANS, COACH_SEATS, FREE_PUZZLES, planOf, isPro, isCoach, hasPro, canCoach, isAdmin, billingOn, prefsFor, cleanPrefs, DEFAULT_PREFS };
