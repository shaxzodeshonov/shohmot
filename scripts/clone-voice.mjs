// Makes the coach's voice at ElevenLabs from a speech sample, and says a test
// line with it.
//
//   node scripts/clone-voice.mjs [sample.mp3] [name]
//
// Needs ELEVENLABS_API_KEY in .env (or the environment). The sample defaults
// to data/coach-voice-sample.mp3: one to two minutes of one person talking,
// with no music or other voices. It prints the COACH_VOICE_ID line to add to
// .env and writes data/coach-voice-test.mp3 so you can hear the result.
//
// Only clone a voice you have the right to use: ElevenLabs asks you to confirm
// that, and so does this script.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const root = path.join(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env */ }

const key = process.env.ELEVENLABS_API_KEY;
const api = (process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');
const sample = path.resolve(process.argv[2] || path.join(root, 'data', 'coach-voice-sample.mp3'));
const name = process.argv[3] || 'Shohmot coach';

if (!key) { console.error('Put ELEVENLABS_API_KEY=… in .env first (elevenlabs.io → your profile → API keys).'); process.exit(1); }
if (!fs.existsSync(sample)) { console.error(`No sample at ${sample}.`); process.exit(1); }

if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Clone the voice in ${path.basename(sample)}? Type "yes" to confirm you have the right to use this voice: `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') { console.log('Nothing was sent.'); process.exit(0); }
}

const form = new FormData();
form.append('name', name);
form.append('description', 'The coach on Shohmot.');
form.append('files', new Blob([fs.readFileSync(sample)], { type: 'audio/mpeg' }), path.basename(sample));
const made = await fetch(`${api}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
const body = await made.json().catch(() => ({}));
if (!made.ok || !body.voice_id) {
  console.error(`ElevenLabs said no (${made.status}):`, JSON.stringify(body.detail || body));
  process.exit(1);
}
console.log(`\nThe voice is made. Add this line to .env (and to the Vercel project's settings):\n\n  COACH_VOICE_ID=${body.voice_id}\n`);
if (body.requires_verification) console.log('ElevenLabs wants this voice verified before it can speak: open it on elevenlabs.io and follow the steps.');

const line = 'That move loses the queen. Count the attackers and the defenders before you trade. Knight to f3 was better.';
const spoken = await fetch(`${api}/v1/text-to-speech/${body.voice_id}?output_format=mp3_44100_128`, {
  method: 'POST',
  headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: line, model_id: process.env.COACH_VOICE_MODEL || 'eleven_flash_v2_5' }),
});
if (spoken.ok) {
  const out = path.join(root, 'data', 'coach-voice-test.mp3');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await spoken.arrayBuffer()));
  console.log(`A test line is in ${path.relative(root, out)}: listen to it before switching the voice on.`);
} else {
  console.log(`The voice was made, but the test line failed (${spoken.status}).`);
}
