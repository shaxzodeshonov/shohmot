// A tiny key-value store for accounts and sessions.
// On Vercel it uses Upstash Redis over its REST API (add the Upstash for Redis
// integration in the Vercel dashboard; it sets the env vars below). On your
// machine it keeps everything in data/store.json.
const fs = require('fs');
const path = require('path');

// Finds the database's REST address and token, whatever Vercel named them:
// UPSTASH_REDIS_REST_URL / _TOKEN (Upstash's own names), KV_REST_API_URL /
// _TOKEN (Vercel's), or either with a custom prefix chosen when connecting
// the store (e.g. STORAGE_KV_REST_API_URL, MYDB_UPSTASH_REDIS_REST_URL).
function findRedis(env = process.env) {
  const pairs = [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u], token: env[t], from: u };
  for (const name of Object.keys(env).sort()) {
    const m = /^(.+)_(UPSTASH_REDIS_REST_URL|KV_REST_API_URL|REST_API_URL|REDIS_REST_URL)$/.exec(name);
    if (!m || !/^https:\/\//.test(env[name] || '')) continue;
    const token = env[`${m[1]}_${m[2].replace(/URL$/, 'TOKEN')}`];
    if (token) return { url: env[name], token, from: name };
  }
  return null;
}

// What's there and what's missing, for /api/health. Only variable names,
// never their values.
function describeDb(env = process.env) {
  const found = findRedis(env);
  if (found) return { db: 'redis', from: found.from };
  if (!env.VERCEL) return { db: 'file', from: 'data/store.json' };
  const related = Object.keys(env).filter((k) => /KV_|REDIS|UPSTASH/.test(k)).sort();
  let hint = 'No database connected. In Vercel: Storage → Create Database → Upstash (Redis) → Connect to this project, tick Production, then redeploy.';
  if (related.length) hint = `Found ${related.join(', ')} but not a REST URL and token pair (…_REST_API_URL and …_REST_API_TOKEN). Reconnect the Upstash store to this project, or copy its REST URL and token into UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, then redeploy.`;
  return { db: 'missing', related, hint };
}

const FOUND = findRedis();
const REDIS_URL = FOUND && FOUND.url;
const REDIS_TOKEN = FOUND && FOUND.token;

class NotConfiguredError extends Error {}

// ---------- Upstash Redis (REST) ----------
async function redis(body, pipeline = false) {
  const res = await fetch(pipeline ? `${REDIS_URL.replace(/\/$/, '')}/pipeline` : REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out) throw new Error(`Redis HTTP ${res.status}`);
  if (pipeline) return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
  if (out.error) throw new Error(out.error);
  return out.result;
}

const redisStore = {
  get: (key) => redis(['GET', key]),
  async set(key, value, { ttl, nx } = {}) {
    const cmd = ['SET', key, value];
    if (ttl) cmd.push('EX', String(ttl));
    if (nx) cmd.push('NX');
    return (await redis(cmd)) === 'OK';
  },
  del: (key) => redis(['DEL', key]),
  // Counts up within a window that starts at the first hit.
  async incr(key, ttl) {
    const [, n] = await redis([['SET', key, '0', 'EX', String(ttl), 'NX'], ['INCR', key]], true);
    return n;
  },
  async mget(keys) { return keys.length ? redis(['MGET', ...keys]) : []; },
  // Sets, for the list of all users (weekly emails, admin numbers).
  sadd: (key, member) => redis(['SADD', key, member]),
  srem: (key, member) => redis(['SREM', key, member]),
  smembers: (key) => redis(['SMEMBERS', key]),
  scard: (key) => redis(['SCARD', key]),
  // HyperLogLog: counts distinct visitors without keeping who they were.
  async pfadd(key, member, ttl) { await redis([['PFADD', key, member], ['EXPIRE', key, String(ttl)]], true); },
  async pfcount(keys) { return Promise.all(keys.map((k) => redis(['PFCOUNT', k]))); },
  shared: true,
};

// ---------- JSON file (local) ----------
const DATA_DIR = process.env.SHOHMOT_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');
let mem = null;

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = {}; }
  const now = Date.now();
  for (const [k, e] of Object.entries(mem)) if (e.exp && e.exp <= now) delete mem[k];
  return mem;
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(mem));
  fs.renameSync(tmp, FILE);
}
function live(key) {
  const e = load()[key];
  if (e && e.exp && e.exp <= Date.now()) { delete mem[key]; return null; }
  return e || null;
}

const fileStore = {
  async get(key) { const e = live(key); return e ? e.v : null; },
  async set(key, value, { ttl, nx } = {}) {
    if (nx && live(key)) return false;
    load()[key] = { v: value, exp: ttl ? Date.now() + ttl * 1000 : 0 };
    save();
    return true;
  },
  async del(key) { if (live(key)) { delete mem[key]; save(); } },
  async incr(key, ttl) {
    const e = live(key) || (load()[key] = { v: '0', exp: Date.now() + ttl * 1000 });
    e.v = String(Number(e.v) + 1);
    save();
    return Number(e.v);
  },
  async mget(keys) { return keys.map((k) => { const e = live(k); return e ? e.v : null; }); },
  async sadd(key, member) {
    const e = live(key) || (load()[key] = { v: [], exp: 0 });
    if (e.v.includes(member)) return 0;
    e.v.push(member);
    save();
    return 1;
  },
  async srem(key, member) {
    const e = live(key);
    if (!e || !e.v.includes(member)) return 0;
    e.v = e.v.filter((m) => m !== member);
    save();
    return 1;
  },
  async smembers(key) { const e = live(key); return e ? e.v.slice() : []; },
  async scard(key) { const e = live(key); return e ? e.v.length : 0; },
  // Locally an exact set stands in for Redis's HyperLogLog.
  async pfadd(key, member, ttl) {
    const e = live(key) || (load()[key] = { v: [], exp: Date.now() + ttl * 1000 });
    if (!e.v.includes(member)) { e.v.push(member); save(); }
  },
  async pfcount(keys) { return keys.map((k) => { const e = live(k); return e ? e.v.length : 0; }); },
  shared: false,
};

// Vercel's file system doesn't keep anything between requests, so there it's
// Redis or nothing.
const missing = new Proxy({}, { get: (_, k) => (k === 'shared' ? false : async () => { throw new NotConfiguredError('No database configured'); }) });
const store = REDIS_URL && REDIS_TOKEN ? redisStore : process.env.VERCEL ? missing : fileStore;

module.exports = { store, NotConfiguredError, findRedis, describeDb };
