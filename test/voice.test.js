// The coach's cloned voice (src/voice.js): who gets it, and what's refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHOHMOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shohmot-voice-'));
const { voice, allowed, clean, configured, setFetch } = require('../src/voice');
test.after(() => fs.rmSync(process.env.SHOHMOT_DATA_DIR, { recursive: true, force: true }));

const call = async (req) => {
  const out = {};
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { out.body = b; } };
  await voice({ headers: {}, ...req }, res);
  return { status: res.statusCode, body: out.body, headers: res.headers };
};
const off = () => { for (const k of ['ELEVENLABS_API_KEY', 'COACH_VOICE_ID', 'COACH_VOICE_EMAILS', 'ADMIN_EMAILS']) delete process.env[k]; };

test('the voice is off until a key and a voice are set', async () => {
  off();
  assert.equal(configured(), false);
  assert.equal(JSON.parse((await call({ method: 'GET' })).body).on, false);
  assert.equal((await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: 'hi' } })).status, 503);
});

test('only the listed accounts hear it; admins by default', () => {
  off();
  process.env.ADMIN_EMAILS = 'boss@example.com';
  assert.equal(allowed(null), false);
  assert.equal(allowed({ email: 'boss@example.com' }), true);
  assert.equal(allowed({ email: 'someone@example.com' }), false);
  process.env.COACH_VOICE_EMAILS = 'Friend@Example.com, other@example.com';
  assert.equal(allowed({ email: 'friend@example.com' }), true);
  assert.equal(allowed({ email: 'boss@example.com' }), false);
  process.env.COACH_VOICE_EMAILS = '*';
  assert.equal(allowed({ email: 'someone@example.com' }), true);
  off();
});

test('signed-out visitors never reach the voice service', async () => {
  off();
  process.env.ELEVENLABS_API_KEY = 'test-key';
  process.env.COACH_VOICE_ID = 'voice123';
  process.env.COACH_VOICE_EMAILS = '*';
  let asked = 0;
  setFetch(async () => { asked++; return new Response(new Uint8Array([1, 2, 3])); });
  assert.equal(JSON.parse((await call({ method: 'GET' })).body).on, false);
  assert.equal((await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: 'Knight takes f7, check.' } })).status, 403);
  assert.equal(asked, 0);
  off();
});

test('what is sent to be spoken is plain, short text', () => {
  assert.equal(clean('  It loses\n the <b>queen</b>.  '), 'It loses the b queen /b .');
  assert.equal(clean('x'.repeat(900)).length, 600);
  assert.equal(clean(null), '');
});
