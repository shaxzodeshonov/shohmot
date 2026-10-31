// A tiny key-value store for accounts and sessions.
// On Vercel it uses Upstash Redis over its REST API (add the Upstash for Redis
// integration in the Vercel dashboard; it sets the env vars below). On your
// machine it keeps everything in data/store.json.
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

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
};

// Vercel's file system doesn't keep anything between requests, so there it's
// Redis or nothing.
const missing = new Proxy({}, { get: () => async () => { throw new NotConfiguredError('No database configured'); } });
const store = REDIS_URL && REDIS_TOKEN ? redisStore : process.env.VERCEL ? missing : fileStore;

module.exports = { store, NotConfiguredError };
