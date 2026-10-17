// Pulls games from Chess.com and Lichess and merges them into the store.
const { parseChesscomGame, parseLichessGame, parseNdjson, archiveMonthEnd } = require('./parse');

// Both APIs reject requests without a User-Agent.
const UA = 'Shohmot/2.0 (personal game counter, runs locally)';
const DAY = 86400000;
// Lichess filters exports by game *start* time, so re-ask for a little
// overlap to catch games that started before the last sync but ended after.
const LICHESS_OVERLAP = 3 * 3600000;

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function get(url, { accept = 'application/json', etag } = {}) {
  const headers = { 'User-Agent': UA, Accept: accept };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new HttpError(res.status, url);
  return { res, etag: res.headers.get('etag') };
}

function mergeGames(data, incoming) {
  const byId = new Map(data.games.map((g) => [g.id, g]));
  let added = 0;
  for (const g of incoming) {
    if (!g) continue;
    if (!byId.has(g.id)) added++;
    byId.set(g.id, g);
  }
  data.games = [...byId.values()].sort((a, b) => a.end - b.end);
  return added;
}

async function syncChesscom(account, data) {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(account.username.toLowerCase())}`;

  const [{ res: pRes }, { res: sRes }, { res: aRes }] = await Promise.all([
    get(base),
    get(`${base}/stats`),
    get(`${base}/games/archives`),
  ]);
  const profile = await pRes.json();
  const stats = await sRes.json();
  const { archives = [] } = await aRes.json();

  const ratings = {};
  for (const [key, speed] of [['chess_bullet', 'bullet'], ['chess_blitz', 'blitz'], ['chess_rapid', 'rapid'], ['chess_daily', 'daily']]) {
    if (stats[key] && stats[key].last) ratings[speed] = stats[key].last.rating;
  }
  data.profile = {
    displayName: profile.username || account.username,
    avatar: profile.avatar || null,
    url: profile.url || `https://www.chess.com/member/${account.username}`,
    ratings,
  };

  let added = 0;
  for (const url of archives) {
    const month = data.months[url];
    // A month is final once we fetched it at least two days after it ended.
    if (month && month.fetchedAt > archiveMonthEnd(url) + 2 * DAY) continue;
    const r = await get(url, { etag: month && month.etag });
    if (!r.notModified) {
      const { games = [] } = await r.res.json();
      added += mergeGames(data, games.map((g) => parseChesscomGame(g, account.username)));
    }
    data.months[url] = { fetchedAt: Date.now(), etag: r.etag || (month && month.etag) || null };
  }
  return added;
}

async function syncLichess(account, data) {
  const user = encodeURIComponent(account.username.toLowerCase());
  const { res: pRes } = await get(`https://lichess.org/api/user/${user}`);
  const profile = await pRes.json();

  const ratings = {};
  for (const speed of ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']) {
    const p = profile.perfs && profile.perfs[speed];
    if (p && p.games > 0) ratings[speed === 'correspondence' ? 'daily' : speed] = p.rating;
  }
  data.profile = {
    displayName: profile.username || account.username,
    avatar: null,
    url: profile.url || `https://lichess.org/@/${account.username}`,
    ratings,
    reportedTotal: profile.count ? profile.count.all : null,
  };

  const lastStart = data.games.reduce((m, g) => Math.max(m, g.start || 0), 0);
  const params = new URLSearchParams({
    moves: 'false', tags: 'false', clocks: 'false', evals: 'false', opening: 'false',
  });
  if (lastStart) params.set('since', String(lastStart - LICHESS_OVERLAP));
  const { res } = await get(`https://lichess.org/api/games/user/${user}?${params}`, { accept: 'application/x-ndjson' });
  const games = parseNdjson(await res.text());
  return mergeGames(data, games.map((g) => parseLichessGame(g, account.username)));
}

// Checks that a username exists before we add it.
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

async function syncAccount(account, data) {
  const fn = account.platform === 'lichess' ? syncLichess : syncChesscom;
  try {
    const added = await fn(account, data);
    data.lastSyncAt = Date.now();
    data.lastError = null;
    return added;
  } catch (err) {
    data.lastError = {
      at: Date.now(),
      message: err.status === 429
        ? 'Rate limited. Retrying on the next sync.'
        : err.status === 404
          ? 'Account not found.'
          : `Could not reach ${account.platform === 'lichess' ? 'Lichess' : 'Chess.com'} (${err.message}).`,
    };
    return 0;
  }
}

module.exports = { syncAccount, accountExists, mergeGames };
