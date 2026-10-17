// Shohmot: a live game counter for Chess.com and Lichess.
// No dependencies. Run with `npm start` and open http://localhost:3001
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./src/store');
const { syncAccount, accountExists } = require('./src/sync');

const PORT = Number(process.env.PORT) || 3001;
const SYNC_MS = Number(process.env.SYNC_SECONDS || 60) * 1000;
const PUBLIC = path.join(__dirname, 'public');
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;

const state = store.load();
const clients = new Set();
let syncing = false;
let lastSyncAt = null;
let nextSyncAt = Date.now();
let timer = null;

function snapshot() {
  return {
    serverTime: Date.now(),
    syncing,
    lastSyncAt,
    nextSyncAt,
    syncIntervalMs: SYNC_MS,
    accounts: state.accounts.map((a) => {
      const d = state.data[a.id] || store.emptyAccountData();
      return {
        id: a.id,
        platform: a.platform,
        username: a.username,
        profile: d.profile,
        lastSyncAt: d.lastSyncAt,
        lastError: d.lastError,
        games: d.games,
      };
    }),
  };
}

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

async function runSync(onlyId) {
  if (syncing) return;
  syncing = true;
  clearTimeout(timer);
  broadcast('status', { syncing: true });
  const added = [];
  try {
    for (const account of state.accounts) {
      if (onlyId && account.id !== onlyId) continue;
      const data = state.data[account.id];
      const n = await syncAccount(account, data);
      if (n > 0 && data.lastSyncAt && data.games.length > n) added.push({ id: account.id, count: n });
    }
    lastSyncAt = Date.now();
    store.save(state);
  } finally {
    syncing = false;
    nextSyncAt = Date.now() + SYNC_MS;
    timer = setTimeout(runSync, SYNC_MS);
    broadcast('state', { ...snapshot(), added });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (pathname === '/api/state' && req.method === 'GET') return sendJson(res, 200, snapshot());

    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify({ ...snapshot(), added: [] })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (pathname === '/api/sync' && req.method === 'POST') {
      runSync();
      return sendJson(res, 202, { ok: true });
    }

    if (pathname === '/api/accounts' && req.method === 'POST') {
      const body = await readBody(req);
      const platform = body.platform;
      const username = String(body.username || '').trim();
      if (!['chesscom', 'lichess'].includes(platform)) return sendJson(res, 400, { error: 'Pick Chess.com or Lichess.' });
      if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: 'Usernames are 2–30 letters, numbers, - or _.' });
      const id = store.accountId(platform, username);
      if (state.accounts.some((a) => a.id === id)) return sendJson(res, 409, { error: 'That account is already on the list.' });
      if (!(await accountExists(platform, username))) {
        return sendJson(res, 404, { error: `No ${platform === 'lichess' ? 'Lichess' : 'Chess.com'} player named ${username}.` });
      }
      state.accounts.push({ id, platform, username, addedAt: Date.now() });
      state.data[id] = store.emptyAccountData();
      store.save(state);
      broadcast('state', { ...snapshot(), added: [] });
      sendJson(res, 201, { id });
      if (syncing) setTimeout(() => runSync(id), 5000);
      else runSync(id);
      return;
    }

    const del = /^\/api\/accounts\/(.+)$/.exec(pathname);
    if (del && req.method === 'DELETE') {
      const id = decodeURIComponent(del[1]);
      const before = state.accounts.length;
      state.accounts = state.accounts.filter((a) => a.id !== id);
      if (state.accounts.length === before) return sendJson(res, 404, { error: 'Account not found.' });
      delete state.data[id];
      store.save(state);
      broadcast('state', { ...snapshot(), added: [] });
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, () => {
  console.log(`Shohmot running at http://localhost:${PORT} (syncing every ${SYNC_MS / 1000}s)`);
  runSync();
});
