// Request handlers shared by the Vercel functions in api/ and the local server.
const { fetchAccount, lookupAccount, fetchGamePgn, fetchMoves, WINDOW_DAYS, MOVES_MAX_SPAN } = require('./games');
const { store } = require('./store');
const { clientIp } = require('./auth');

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

// Everything here can make Shohmot ask Chess.com or Lichess for data, so each
// IP gets a budget, which keeps one visitor from getting the server blocked
// by them. The CDN answers repeat requests before they get here, so only
// real look-ups count. Without a database, requests aren't limited.
async function overLimit(req, name, max, windowSec) {
  try {
    return (await store.incr(`rl:${name}:${clientIp(req)}`, windowSec)) > max;
  } catch {
    return false;
  }
}

// GET /api/state?accounts=chesscom:name,lichess:name[&days=2][&fresh=1]
async function state(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const accounts = parseAccounts(url.searchParams.get('accounts'));
  // "fresh" skips every cache; past the budget it quietly doesn't.
  const fresh = url.searchParams.has('fresh') && !(await overLimit(req, 'fresh', 30, 600));
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
  if (await overLimit(req, 'check', 60, 600)) return send(res, 429, { error: 'That’s a lot of look-ups. Wait a few minutes and try again.' });
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

// GET /api/game?platform=chesscom&username=name&id=<uuid>&end=<ms>
// Lichess ids are 8 characters; Chess.com uses the game's uuid.
const GAME_ID_RE = /^([A-Za-z0-9]{8}|[0-9a-f-]{36})$/;
async function game(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const platform = url.searchParams.get('platform');
  const username = (url.searchParams.get('username') || '').trim();
  const id = url.searchParams.get('id') || '';
  const end = Number(url.searchParams.get('end')) || Date.now();
  // A Lichess game can be fetched by its id alone (a pasted link); Chess.com
  // needs the player, because its games live in each player's monthly archive.
  const needsUser = platform !== 'lichess';
  if (!PLATFORMS.includes(platform) || (needsUser || username ? !USERNAME_RE.test(username) : false) || !GAME_ID_RE.test(id)) {
    return send(res, 400, { error: 'That game link looks broken.' });
  }
  if (await overLimit(req, 'game', 60, 600)) return send(res, 429, { error: 'That’s a lot of games at once. Wait a few minutes and try again.' });
  const site = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  let found;
  try {
    found = await fetchGamePgn(platform, username, id, end);
  } catch (err) {
    if (err.status === 404) return send(res, 404, { error: `${site} has no such game.` });
    return send(res, 502, { error: `Could not reach ${site}. Try again in a moment.` });
  }
  if (!found || !found.pgn) return send(res, 404, { error: `${site} has no such game.` });
  // A finished game never changes, so the CDN can keep it for a day.
  send(res, 200, { platform, id, ...found }, 'public, s-maxage=86400');
}

// GET /api/moves?platform=lichess&username=name&since=<ms>&until=<ms>
// The moves of every game in that window (at most 35 days, inside the last
// 26 weeks), for the brilliant-move scan, which runs in the browser.
async function moves(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const platform = url.searchParams.get('platform');
  const username = (url.searchParams.get('username') || '').trim();
  const now = Date.now();
  const until = Math.min(now, Number(url.searchParams.get('until')) || now);
  const since = Math.max(now - WINDOW_DAYS * 86400000, Number(url.searchParams.get('since')) || 0);
  if (!PLATFORMS.includes(platform) || !USERNAME_RE.test(username)) return send(res, 400, { error: 'Pick an account.' });
  if (!(since < until) || until - since > MOVES_MAX_SPAN) return send(res, 400, { error: 'Ask for at most 35 days at a time.' });
  if (await overLimit(req, 'moves', 120, 600)) return send(res, 429, { error: 'That’s a lot of games at once. The scan will carry on in a few minutes.' });
  const site = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  let games;
  try {
    games = await fetchMoves(platform, username, since, until);
  } catch (err) {
    if (err.status === 404) return send(res, 404, { error: `No ${site} player named ${username}.` });
    if (err.status === 429) return send(res, 429, { error: `${site} is busy. The scan will carry on in a minute.` });
    return send(res, 502, { error: `Could not reach ${site}. Try again in a moment.` });
  }
  // Finished games never change, so a window that ended over an hour ago can be kept for a day.
  const old = now - until > 3600000;
  send(res, 200, { platform, username, since, until, games }, old ? 'public, s-maxage=86400' : 'public, s-maxage=60');
}

module.exports = { state, check, game, moves, parseAccounts };
