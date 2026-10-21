// Request handlers shared by the Vercel functions in api/ and the local server.
const { fetchAccount, lookupAccount, WINDOW_DAYS } = require('./games');

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const PLATFORMS = ['chesscom', 'lichess'];
const MAX_ACCOUNTS = 4;

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

function parseAccounts(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const [platform, username] = part.trim().split(':');
    if (!PLATFORMS.includes(platform) || !USERNAME_RE.test(username || '')) continue;
    if (!out.some((a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase())) {
      out.push({ platform, username });
    }
  }
  return out.slice(0, MAX_ACCOUNTS);
}

// GET /api/state?accounts=chesscom:name,lichess:name[&days=2][&fresh=1]
async function state(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const accounts = parseAccounts(url.searchParams.get('accounts'));
  const fresh = url.searchParams.has('fresh');
  const days = Math.min(WINDOW_DAYS, Math.max(1, Number(url.searchParams.get('days')) || WINDOW_DAYS));
  const results = await Promise.all(accounts.map((a) => fetchAccount(a.platform, a.username, { fresh, days })));
  // Let Vercel's CDN serve the same answer for a minute, so the APIs are hit
  // at most once a minute however many tabs are open.
  send(res, 200, { serverTime: Date.now(), accounts: results }, fresh ? 'no-store' : 'public, s-maxage=55, stale-while-revalidate=300');
}

// GET /api/check?platform=lichess&username=name
async function check(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const platform = url.searchParams.get('platform');
  const username = (url.searchParams.get('username') || '').trim();
  if (!PLATFORMS.includes(platform)) return send(res, 400, { error: 'Pick Chess.com or Lichess.' });
  if (!USERNAME_RE.test(username)) return send(res, 400, { error: 'Usernames are 2–30 letters, numbers, - or _.' });
  const site = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  let found;
  try {
    found = await lookupAccount(platform, username);
  } catch {
    return send(res, 502, { error: `Could not reach ${site}. Try again in a moment.` });
  }
  if (!found) return send(res, 404, { error: `No ${site} player named ${username}.` });
  send(res, 200, { ok: true, platform, ...found }, 'public, s-maxage=3600');
}

module.exports = { state, check, parseAccounts };
