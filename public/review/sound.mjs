// Move sounds in the style of Chess.com's: a short wooden "tock" for a move, a
// brighter, louder "clack" for a capture, two quick tocks for castling, and a
// tock with a little ping for check, a rising ping for promotion, and a soft
// two-note chime when the game ends. Chess.com's own sound files are theirs,
// so these are made here, sample by sample: each knock is a click of noise
// plus a few decaying tones at the pitches a wooden piece rings at. Every kind
// has a few takes with slightly different pitches, so repeats don't sound
// mechanical. They're built once, the first time a sound plays.
const MUTE_KEY = 'shohmot-review-muted';
const TAKES = 4;
let ctx = null;
let bank = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* blocked storage: sound stays on */ }

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

// ---------- making the sounds ----------
// A knock: [frequency Hz, level, decay ms] for each ringing mode, a body thump
// and a click of filtered noise for the moment of contact.
const MOVE = {
  modes: [[880, 1, 16], [1480, 0.5, 10], [2350, 0.26, 6.5], [3600, 0.12, 4]],
  body: [190, 0.55, 22],
  click: [0.32, 0.7],
};
const CAPTURE = {
  modes: [[1180, 1, 24], [1990, 0.72, 16], [3050, 0.42, 10], [4500, 0.22, 6]],
  body: [240, 0.4, 16],
  click: [0.6, 0.9],
};

function knock(out, sr, at, spec, { gain = 1, pitch = 1 } = {}) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor(sr * 0.25));
  const [clickLevel, clickMs] = spec.click;
  const parts = [...spec.modes, spec.body].map(([f, a, ms]) => ({ w: 2 * Math.PI * f * pitch, a, tau: (ms / 1000) * sr, ph: Math.random() * 0.6 }));
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // 0.4 ms attack, so the start isn't a hard step.
    const env = Math.min(1, i / (0.0004 * sr));
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-i / p.tau) * Math.sin(p.w * t + p.ph);
    // The click: high-passed noise that dies within a millisecond or two.
    const n = Math.random() * 2 - 1;
    hp = 0.82 * (hp + n - prev);
    prev = n;
    s += clickLevel * 3 * hp * Math.exp(-i / ((clickMs / 1000) * sr));
    out[start + i] += gain * env * s;
  }
}

// A soft bell-like ping (for check, promotion and game end).
function ping(out, sr, at, freq, { gain = 0.3, ms = 120 } = {}) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor((sr * ms * 5) / 1000));
  const tau = (ms / 1000) * sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, i / (0.003 * sr)) * Math.exp(-i / tau);
    out[start + i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-i / (tau / 3)));
  }
}

const RECIPES = {
  move: (o, sr, j) => knock(o, sr, 0, MOVE, { pitch: j }),
  capture: (o, sr, j) => {
    knock(o, sr, 0, CAPTURE, { pitch: j, gain: 1.15 });
    knock(o, sr, 0.016, CAPTURE, { pitch: j * 1.12, gain: 0.45 });
  },
  castle: (o, sr, j) => {
    knock(o, sr, 0, MOVE, { pitch: j * 1.04, gain: 0.85 });
    knock(o, sr, 0.09, MOVE, { pitch: j * 0.94 });
  },
  check: (o, sr, j) => {
    knock(o, sr, 0, MOVE, { pitch: j });
    ping(o, sr, 0.012, 1568 * j, { gain: 0.22, ms: 70 });
  },
  promote: (o, sr, j) => {
    knock(o, sr, 0, MOVE, { pitch: j });
    ping(o, sr, 0.03, 1047, { gain: 0.16, ms: 60 });
    ping(o, sr, 0.1, 1568, { gain: 0.18, ms: 110 });
  },
  end: (o, sr) => {
    ping(o, sr, 0, 784, { gain: 0.2, ms: 160 });
    ping(o, sr, 0.14, 1175, { gain: 0.2, ms: 260 });
  },
};
// Peak level of each kind: captures loudest, chimes softest.
const LEVEL = { move: 0.62, capture: 0.8, castle: 0.62, check: 0.66, promote: 0.66, end: 0.42 };
const LENGTH = { move: 0.2, capture: 0.25, castle: 0.3, check: 0.35, promote: 0.6, end: 1.5 };

function build(c) {
  const sr = c.sampleRate;
  const out = {};
  for (const [kind, recipe] of Object.entries(RECIPES)) {
    out[kind] = [];
    for (let k = 0; k < TAKES; k++) {
      const buf = c.createBuffer(1, Math.floor(sr * LENGTH[kind]), sr);
      const data = buf.getChannelData(0);
      recipe(data, sr, 1 + (k - (TAKES - 1) / 2) * 0.025);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      const scale = peak ? LEVEL[kind] / peak : 0;
      // Scale to the level, and fade the last 5 ms so nothing clicks at the end.
      const fade = Math.floor(sr * 0.005);
      for (let i = 0; i < data.length; i++) data[i] *= scale * Math.min(1, (data.length - i) / fade);
      out[kind].push(buf);
    }
  }
  return out;
}

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bank = build(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// The kind of sound a move makes, from its SAN and whether it took a piece.
export function soundOf(move) {
  if (!move) return 'move';
  if (move.san.endsWith('#')) return 'end';
  if (move.san.endsWith('+')) return 'check';
  if (move.san.includes('=')) return 'promote';
  if (move.san.startsWith('O-O')) return 'castle';
  if (move.captured || move.san.includes('x')) return 'capture';
  return 'move';
}

export function play(kind = 'move') {
  if (muted) return;
  const c = audio();
  if (!c) return;
  // Mate: the move itself, then the chime.
  if (kind === 'end') play('check');
  const takes = bank[kind] || bank.move;
  const src = c.createBufferSource();
  src.buffer = takes[Math.floor(Math.random() * takes.length)];
  src.connect(c.destination);
  src.start(kind === 'end' ? c.currentTime + 0.12 : c.currentTime);
}
