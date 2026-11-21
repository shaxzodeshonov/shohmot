// Fischer's own voice: the coach's words, spoken by a cloned voice kept at
// ElevenLabs. The browser's built-in speech stays the fallback (and is what
// everyone else hears).
//
//   GET  /api/voice           -> { on }   whether this visitor gets the voice
//   POST /api/voice { text }  -> audio/mpeg
//
// Settings:
//   ELEVENLABS_API_KEY   the account that holds the voice (off without it)
//   COACH_VOICE_ID       the voice. Default: Brian, one of ElevenLabs' own voices
//                        (a deep American man), so the key alone switches it on.
//                        Any voice id from your ElevenLabs account works here.
//   COACH_VOICE_EMAILS   who hears it. Default: every signed-in account. To narrow
//                        it: emails, comma-separated, and/or `admins` for the
//                        ADMIN_EMAILS. Signed-out visitors never get it.
//   COACH_VOICE_MODEL    default eleven_multilingual_v2 (the most natural;
//                        eleven_flash_v2_5 is quicker and half the price)
//   ELEVENLABS_API_URL   default https://api.elevenlabs.io (their regional servers work too)
//   COACH_VOICE_HOURLY_LIMIT   lines an hour per account (default 150)
//   COACH_VOICE_DAILY_CHARS    optional: characters a day for the whole site, to
//                              spread a plan over the month (none by default: the
//                              ElevenLabs plan itself is the limit). Once a limit
//                              is reached, lines already spoken still play and
//                              new ones are shown but not spoken.
//
// Every line costs money, so: signed-in accounts only, a budget per account
// an hour and for the site a day, and lines already spoken are kept and reused
// (the coach's lessons repeat a lot).
const crypto = require('crypto');
const { HttpError, send, handler, readJson, currentUser } = require('./auth');
const { store } = require('./store');
const plans = require('./plans');

const MAX_TEXT = 600;
const DEFAULT_VOICE = 'nPczCjzI2devNBz1zQrb'; // Brian
const VOICE = () => process.env.COACH_VOICE_ID || DEFAULT_VOICE;
const MODEL = () => process.env.COACH_VOICE_MODEL || 'eleven_multilingual_v2';
const API = () => (process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');
const configured = () => !!process.env.ELEVENLABS_API_KEY;

function allowed(user) {
  if (!user) return false;
  const list = (process.env.COACH_VOICE_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes('*')) return true;
  if (list.includes('admins') && plans.isAdmin(user)) return true;
  return list.includes(String(user.email || '').toLowerCase());
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
// Characters sent to ElevenLabs today, counted in the store so every server
// instance shares one budget.
async function spendChars(n) {
  const cap = Number(process.env.COACH_VOICE_DAILY_CHARS) || 0;
  if (!cap) return; // no cap of our own: the ElevenLabs plan is the limit
  const day = new Date().toISOString().slice(0, 10);
  if ((await count(`voice:chars:${day}`, 25 * 3600, n)) > cap) throw new HttpError(429, 'Fischer has talked so much today that the voice is resting until tomorrow.');
}

// ---------- lines already spoken ----------
// Kept in memory, and on Vercel also in the store (Redis) for 30 days, so a
// line is paid for once however many people hear it. Locally the store is a
// JSON file, so lines stay in memory only.
const SAVE_FOR = 30 * 86400;
async function saved(key) {
  if (!store.shared) return null;
  try { const b64 = await store.get(`voice:line:${key}`); return b64 ? Buffer.from(b64, 'base64') : null; } catch { return null; }
}
async function save(key, buf) {
  if (!store.shared) return;
  try { await store.set(`voice:line:${key}`, buf.toString('base64'), { ttl: SAVE_FOR }); } catch { /* the line still plays */ }
}
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

// Tuned by ear for the Fischer clone: stay close to the recording, a touch of style.
const SETTINGS = { stability: 0.55, similarity_boost: 0.95, style: 0.1, use_speaker_boost: true, speed: 1.0 };

async function speak(text) {
  const voice = VOICE();
  const key = crypto.createHash('sha256').update(`${voice}|${MODEL()}|${JSON.stringify(SETTINGS)}|${text}`).digest('hex');
  const hit = cache.get(key) || await saved(key);
  if (hit) { if (!cache.has(key)) remember(key, hit); return hit; }
  await spendChars(text.length);
  const res = await fetcher(`${API()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL(), voice_settings: SETTINGS }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Coach voice: ElevenLabs answered', res.status, detail.slice(0, 300));
    if (/quota_exceeded/.test(detail)) throw new HttpError(429, 'Fischer’s voice has used up this month’s words. The browser’s voice fills in until the plan renews.');
    if (res.status === 401 || res.status === 403) throw new HttpError(503, 'The coach’s voice isn’t set up correctly on this site.');
    if (res.status === 429) throw new HttpError(429, 'The coach’s voice is busy. Try again in a moment.');
    throw new HttpError(502, 'The coach’s voice couldn’t be reached just now.');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  remember(key, buf);
  await save(key, buf);
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
