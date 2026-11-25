// The coach's cloned voice (src/voice.js): who gets it, and what's refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHOHMOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-voice-'));
const { voice, allowed, clean, configured, setFetch } = require('../src/voice');
const { store } = require('../src/store');
test.after(() => fs.rmSync(process.env.SHOHMOT_DATA_DIR, { recursive: true, force: true }));

const call = async (req, handler = voice) => {
  const out = {};
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { out.body = b; } };
  await handler({ headers: {}, ...req }, res);
  return { status: res.statusCode, body: out.body, headers: res.headers };
};
const say = (text, handler) => call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { text } }, handler);
const off = () => { for (const k of ['ELEVENLABS_API_KEY', 'COACH_VOICE_ID', 'COACH_VOICE_EMAILS', 'ADMIN_EMAILS', 'COACH_VOICE_DAILY_CHARS']) delete process.env[k]; };
const on = () => { off(); process.env.ELEVENLABS_API_KEY = 'test-key'; process.env.COACH_VOICE_ID = 'voice123'; };

// The voice is reached only by a signed-in account: a fresh copy of the module
// that sees one (and has its own memory of lines).
function signedIn() {
  const auth = require('../src/auth');
  const was = auth.currentUser;
  const file = require.resolve('../src/voice');
  const kept = require.cache[file];
  delete require.cache[file];
  auth.currentUser = async () => ({ id: 'u1', email: 'a@example.com' });
  const mod = require('../src/voice');
  auth.currentUser = was;
  require.cache[file] = kept;
  return mod;
}
const quietly = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('the voice is off until the ElevenLabs key is set', async () => {
  off();
  assert.equal(configured(), false);
  assert.equal(JSON.parse((await call({ method: 'GET' })).body).on, false);
  assert.equal((await say('hi')).status, 503);
});

test('every signed-in account hears it, unless the list narrows it', () => {
  off();
  process.env.ADMIN_EMAILS = 'boss@example.com';
  assert.equal(allowed(null), false);
  assert.equal(allowed({ email: 'someone@example.com' }), true);
  process.env.COACH_VOICE_EMAILS = 'Friend@Example.com, other@example.com';
  assert.equal(allowed({ email: 'friend@example.com' }), true);
  assert.equal(allowed({ email: 'boss@example.com' }), false);
  process.env.COACH_VOICE_EMAILS = 'admins, friend@example.com';
  assert.equal(allowed({ email: 'boss@example.com' }), true);
  assert.equal(allowed({ email: 'someone@example.com' }), false);
  process.env.COACH_VOICE_EMAILS = '*';
  assert.equal(allowed({ email: 'someone@example.com' }), true);
  off();
});

test('signed-out visitors never reach the voice service', async () => {
  on();
  let asked = 0;
  setFetch(async () => { asked++; return new Response(new Uint8Array([1, 2, 3])); });
  assert.equal(JSON.parse((await call({ method: 'GET' })).body).on, false);
  assert.equal((await say('Knight takes f7, check.')).status, 403);
  assert.equal(asked, 0);
  off();
});

test('a used-up ElevenLabs plan says so, instead of "not set up"', async () => {
  on();
  const v = signedIn();
  v.setFetch(async () => new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'over' } }), { status: 401 }));
  const r = await quietly(() => say('Knight takes f7.', v.voice));
  assert.equal(r.status, 429);
  assert.match(String(r.body), /used up/);
  off();
});

test('a line already spoken is saved in the database and replayed for free', async () => {
  on();
  store.shared = true; // as on Vercel, where the store is Redis
  try {
    let asked = 0;
    const fetcher = async () => { asked++; return new Response(new Uint8Array([7, 8, 9])); };
    const first = signedIn();
    first.setFetch(fetcher);
    const a = await say('Count the attackers.', first.voice);
    assert.equal(a.status, 200);
    // Another server instance, with nothing in memory.
    const second = signedIn();
    second.setFetch(fetcher);
    const b = await say('Count the attackers.', second.voice);
    assert.equal(b.status, 200);
    assert.deepEqual([...b.body], [7, 8, 9]);
    assert.equal(asked, 1);
  } finally { store.shared = false; off(); }
});

test('the daily character budget is shared by every server instance', async () => {
  on();
  process.env.COACH_VOICE_DAILY_CHARS = '25';
  const fetcher = async () => new Response(new Uint8Array([1]));
  const one = signedIn(); one.setFetch(fetcher);
  const two = signedIn(); two.setFetch(fetcher);
  const day = new Date().toISOString().slice(0, 10);
  await store.del(`voice:chars:${day}`);
  assert.equal((await say('Twelve chars', one.voice)).status, 200);
  assert.equal((await say('Twelve char!', two.voice)).status, 200);
  assert.equal((await say('One more line', one.voice)).status, 429);
  await store.del(`voice:chars:${day}`);
  off();
});

test('with no daily limit set, only the ElevenLabs plan limits the voice', async () => {
  on();
  const v = signedIn();
  v.setFetch(async () => new Response(new Uint8Array([1])));
  for (let i = 0; i < 30; i++) assert.equal((await say(`Line number ${i}: ${'x'.repeat(80)}`, v.voice)).status, 200);
  off();
});

test('what is sent to be spoken is plain, short text', () => {
  assert.equal(clean('  It loses\n the <b>queen</b>.  '), 'It loses the b queen /b .');
  assert.equal(clean('x'.repeat(900)).length, 600);
  assert.equal(clean(null), '');
});
