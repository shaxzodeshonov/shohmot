// Fetches recent games for one Chess.com or Lichess account. Stateless, so it
// runs the same way in a Vercel function and in the local server.
const { parseChesscomGame, parseLichessGame, parseNdjson, archiveMonthEnd } = require('./parse');

// Both APIs reject requests without a User-Agent.
const UA = 'Shohmot/2.0 (personal game counter)';
const DAY = 86400000;
// The page shows a 26-week calendar, plus one earlier game for rating change.
const WINDOW_DAYS = 26 * 7 + 14;

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function get(url, accept = 'application/json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

async function fetchChesscom(username, since) {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`;
  const [profile, stats, { archives = [] }] = await Promise.all([
    get(base).then((r) => r.json()),
    get(`${base}/stats`).then((r) => r.json()),
    get(`${base}/games/archives`).then((r) => r.json()),
  ]);
  const ratings = {};
  for (const [key, speed] of [['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'], ['chess_rapid', 'rapid'], ['chess_daily', 'daily']]) {
    if (stats[key] && stats[key].last) ratings[speed] = stats[key].last.rating;
  }
  // Only the monthly archives that overlap the window.
  const months = archives.filter((url) => archiveMonthEnd(url) > since);
  const lists = await Promise.all(months.map((url) => get(url).then((r) => r.json())));
  const games = lists
    .flatMap((l) => l.games || [])
    .map((g) => parseChesscomGame(g, username))
    .filter((g) => g && g.end >= since);
  return {
    profile: {
      displayName: profile.username || username,
      avatar: profile.avatar || null,
      url: profile.url || `https://www.chess.com/member/${username}`,
      ratings,
    },
    games,
  };
}

async function fetchLichess(username, since) {
  const user = encodeURIComponent(username.toLowerCase());
  const params = new URLSearchParams({
    since: String(since), moves: 'false', tags: 'false', clocks: 'false', evals: 'false', opening: 'false',
  });
  const [profile, text] = await Promise.all([
    get(`https://lichess.org/api/user/${user}`).then((r) => r.json()),
    get(`https://lichess.org/api/games/user/${user}?${params}`, 'application/x-ndjson').then((r) => r.text()),
  ]);
  const ratings = {};
  for (const speed of ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']) {
    const p = profile.perfs && profile.perfs[speed];
    if (p && p.games > 0) ratings[speed === 'correspondence' ? 'daily' : speed] = p.rating;
  }
  return {
    profile: {
      displayName: profile.username || username,
      avatar: null,
      url: profile.url || `https://lichess.org/@/${username}`,
      ratings,
    },
    games: parseNdjson(text).map((g) => parseLichessGame(g, username)).filter(Boolean),
  };
}

function errorMessage(platform, err) {
  const site = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  if (err.status === 429) return `${site} is rate limiting requests. Retrying on the next sync.`;
  if (err.status === 404) return `No ${site} player with this name.`;
  return `Could not reach ${site}.`;
}

// Short in-memory cache so a warm function (or the local server) doesn't
// refetch the same account for every request.
const cache = new Map();
const CACHE_MS = 45000;

async function fetchAccount(platform, username, { fresh = false } = {}) {
  const id = `${platform}:${username.toLowerCase()}`;
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const since = Date.now() - WINDOW_DAYS * DAY;
  let value;
  try {
    const data = platform === 'lichess' ? await fetchLichess(username, since) : await fetchChesscom(username, since);
    data.games.sort((a, b) => a.end - b.end);
    value = { id, platform, username, ...data, error: null };
  } catch (err) {
    // Keep showing the last good data if we have it.
    if (hit) return { ...hit.value, error: errorMessage(platform, err) };
    value = { id, platform, username, profile: null, games: [], error: errorMessage(platform, err) };
    return value;
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

async function accountExists(platform, username) {
  const u = encodeURIComponent(username.toLowerCase());
  const url = platform === 'lichess' ? `https://lichess.org/api/user/${u}` : `https://api.chess.com/pub/player/${u}`;
  try {
    await get(url);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

module.exports = { fetchAccount, accountExists, WINDOW_DAYS };
