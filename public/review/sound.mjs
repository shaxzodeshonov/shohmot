// Move sounds, made in the browser with Web Audio (no sound files): a short
// wooden knock for a move, a heavier double knock for a capture, two taps for
// castling, and a soft bell on top for check and promotion.
const MUTE_KEY = 'shohmot-review-muted';
let ctx = null;
let noise = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* blocked storage: sound stays on */ }

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // A tenth of a second of white noise, reused for every knock.
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// One knock: filtered noise for the click plus a low sine for the body.
function knock(c, t, { freq = 1500, gain = 0.55, decay = 0.06 } = {}) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(band).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + decay + 0.02);

  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(freq / 7, t);
  body.frequency.exponentialRampToValueAtTime(freq / 12, t + decay * 1.5);
  const bg = c.createGain();
  bg.gain.setValueAtTime(gain * 0.7, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + decay * 1.5);
  body.connect(bg).connect(c.destination);
  body.start(t);
  body.stop(t + decay * 1.5 + 0.02);
}

function bell(c, t, freq, gain = 0.12, length = 0.25) {
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + length + 0.02);
}

// The kind of sound a move makes, from its SAN and whether it took a piece.
export function soundOf(move) {
  if (!move) return 'move';
  if (move.san.includes('=')) return 'promote';
  if (/[+#]$/.test(move.san)) return 'check';
  if (move.san.startsWith('O-O')) return 'castle';
  if (move.captured || move.san.includes('x')) return 'capture';
  return 'move';
}

export function play(kind = 'move') {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.005;
  if (kind === 'capture') {
    knock(c, t, { freq: 1100, gain: 0.8, decay: 0.08 });
    knock(c, t + 0.04, { freq: 1900, gain: 0.35, decay: 0.05 });
  } else if (kind === 'castle') {
    knock(c, t, { freq: 1500 });
    knock(c, t + 0.12, { freq: 1300 });
  } else if (kind === 'check') {
    knock(c, t, { freq: 1500 });
    bell(c, t + 0.02, 988);
  } else if (kind === 'promote') {
    knock(c, t, { freq: 1500 });
    bell(c, t + 0.03, 784, 0.1, 0.2);
    bell(c, t + 0.12, 1175, 0.1, 0.3);
  } else {
    knock(c, t);
  }
}
