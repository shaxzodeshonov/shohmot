// Fischer's own voice: the coach's words, spoken by a cloned voice kept at
// ElevenLabs. The browser's built-in speech stays the fallback (and is what
// everyone else hears).
//
//   GET  /api/voice           -> { on }   whether this visitor gets the voice
//   POST /api/voice { text }  -> audio/mpeg
//
// Settings:
//   ELEVENLABS_API_KEY   the account that holds the voice (off without it)
//   COACH_VOICE_ID       the voice (scripts/clone-voice.mjs makes one and prints its id)
//   COACH_VOICE_EMAILS   who hears it: emails, comma-separated, or * for every
//                        signed-in account. Default: the ADMIN_EMAILS.
//   COACH_VOICE_MODEL    default eleven_flash_v2_5 (quick and cheap)
//   ELEVENLABS_API_URL   default https://api.elevenlabs.io (their regional servers work too)
//   COACH_VOICE_HOURLY_LIMIT   lines an hour per account (default 150)
//   COACH_VOICE_DAILY_CHARS    characters a day for the whole site (default 150000)
//
// Every line costs money, so: signed-in accounts on the list only, a budget per
// account and per day, and lines already spoken are kept in memory (the
// coach's lessons repeat a lot).
const crypto = require('crypto');
const { HttpError, send, handler, readJson, currentUser } = require('./auth');
const { store } = require('./store');
const plans = require('./plans');

const MAX_TEXT = 600;
const MODEL = () => process.env.COACH_VOICE_MODEL || 'eleven_flash_v2_5';
const API = () => (process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');
const configured = () => !!(process.env.ELEVENLABS_API_KEY && process.env.COACH_VOICE_ID);

function allowed(user) {
  if (!user) return false;
  const list = (process.env.COACH_VOICE_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return plans.isAdmin(user);
  return list.includes('*') || list.includes(user.email);
}

// Tests swap in a stand-in for the network.
let fetcher = (...args) => fetch(...args);
function setFetch(fn) { fetcher = fn; cache.clear(); }

// ---------- limits ----------
const local = new Map();
async function count(key, windowSec, by = 1) {
  try {
    return await store.incr(key, windowSec, by);
  } catch {
    const now = Date.now();
    const hit = local.get(key);
    if (!hit || hit.until < now) { local.set(key, { n: by, until: now + windowSec * 1000 }); return by; }
    hit.n += by;
    return hit.n;
  }
}
// The store counts one at a time; characters are counted here, per server instance.
const chars = { day: '', n: 0 };
function spendChars(n) {
  const day = new Date().toISOString().slice(0, 10);
  if (chars.day !== day) { chars.day = day; chars.n = 0; }
  const cap = Number(process.env.COACH_VOICE_DAILY_CHARS) || 150000;
  if (chars.n + n > cap) throw new HttpError(429, 'Fischer has talked so much today that the voice is resting until tomorrow.');
  chars.n += n;
}

// ---------- lines already spoken ----------
const cache = new Map(); // key -> Buffer, oldest first
const CACHE_BYTES = 24 * 1024 * 1024;
let cached = 0;
function remember(key, buf) {
  cache.set(key, buf);
  cached += buf.length;
  for (const [k, b] of cache) {
    if (cached <= CACHE_BYTES) break;
    cache.delete(k);
    cached -= b.length;
  }
}

// Plain text only: what the coach says is a sentence or two.
function clean(text) {
  return String(text ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

async function speak(text) {
  const voice = process.env.COACH_VOICE_ID;
  const key = crypto.createHash('sha256').update(`${voice}|${MODEL()}|${text}`).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  spendChars(text.length);
  const res = await fetcher(`${API()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL(), voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1 } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Coach voice: ElevenLabs answered', res.status, detail.slice(0, 300));
    if (res.status === 401 || res.status === 403) throw new HttpError(503, 'The coach’s voice isn’t set up correctly on this site.');
    if (res.status === 429) throw new HttpError(429, 'The coach’s voice is busy. Try again in a moment.');
    throw new HttpError(502, 'The coach’s voice couldn’t be reached just now.');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  remember(key, buf);
  return buf;
}

const voice = handler(async (req, res) => {
  const user = configured() ? await currentUser(req) : null;
  const on = configured() && allowed(user);
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { on }, { 'Cache-Control': 'no-store' });
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!configured()) throw new HttpError(503, 'The coach’s voice isn’t switched on for this site.');
  if (!on) throw new HttpError(403, 'The coach’s voice isn’t switched on for this account.');
  const text = clean((await readJson(req)).text);
  if (!text) throw new HttpError(400, 'Nothing to say.');
  const perHour = Number(process.env.COACH_VOICE_HOURLY_LIMIT) || 150;
  if ((await count(`rl:voice:${user.id || user.email}`, 3600)) > perHour) throw new HttpError(429, 'That’s a lot of talking for one hour. The voice is back a little later.');
  const audio = await speak(text);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', audio.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(audio);
});

module.exports = { voice, configured, allowed, clean, setFetch };
