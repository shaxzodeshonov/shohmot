// Move sounds. The default style, Classic, plays the recordings in
// public/sounds. The other styles are made here sample by sample: short, dry
// and crisp, a hard piece put down on a hard board.
//   move     one crisp "tock"
//   capture  a louder, sharper double "clack"
//   castle   two tocks in quick succession
//   check    a hard tock with a short ring on it
//   promote  a tock and a quick bright rising pair of notes
//   end      two soft notes, the second lower
// Every kind has a few takes at slightly different pitches so repeats don't
// sound mechanical. They're built once, the first time one plays.
const MUTE_KEY = 'shohmot-review-muted';
const TAKES = 4;
let ctx = null;
let bank = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* blocked storage: sound stays on */ }

// The same six sounds in a few characters, picked in the Options menu:
// p pitch, d how long it rings, c how much click, b how much thump, a attack (ms).
// "Classic" is the default: recorded sounds from public/sounds. Its numbers are
// Thock's, used only until the recordings have loaded (or if they can't).
export const STYLES = {
  classic: { name: 'Classic (recorded)', recorded: true, p: 0.62, d: 1.35, c: 0.7, b: 1.7, a: 0.5 },
  thock: { name: 'Thock (deep wood)', p: 0.62, d: 1.35, c: 0.7, b: 1.7, a: 0.5 },
  tock: { name: 'Tock (crisp wood)', p: 1, d: 1, c: 1, b: 1, a: 0.3 },
  click: { name: 'Click (light plastic)', p: 1.55, d: 0.6, c: 1.5, b: 0.45, a: 0.2 },
  soft: { name: 'Soft (felt)', p: 0.8, d: 1.1, c: 0.22, b: 1.2, a: 2 },
  marble: { name: 'Marble (bright)', p: 2.1, d: 1.6, c: 0.9, b: 0.3, a: 0.2 },
};
const STYLE_KEY = 'shohmot-sound-style';
let style = 'classic';
try { const saved = localStorage.getItem(STYLE_KEY); if (STYLES[saved]) style = saved; } catch { /* blocked storage: the default style */ }
export const getStyle = () => style;
export function setStyle(v) {
  if (!STYLES[v]) return;
  style = v;
  try { localStorage.setItem(STYLE_KEY, v); } catch { /* ignore */ }
  if (ctx) bank = buildBank(ctx);
  loadRecorded();
}

// ---------- the recorded sounds ----------
// The file each kind of move plays. They're fetched and decoded as soon as the
// page loads (an offline context can decode before the first click or key,
// when a real one may not start yet), so the first move already has them.
const FILES = { move: 'move-self', capture: 'capture', castle: 'castle', check: 'move-check', promote: 'promote', end: 'game-end' };
let recorded = null;
let loading = false;
function loadRecorded() {
  if (recorded || loading || !STYLES[style].recorded) return;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC || typeof fetch !== 'function') return;
  loading = true;
  const dec = new OAC(2, 1, 48000);
  Promise.all(Object.entries(FILES).map(async ([kind, file]) => {
    const res = await fetch(`/sounds/${file}.mp3`);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    return [kind, await dec.decodeAudioData(await res.arrayBuffer())];
  })).then(
    (list) => { recorded = Object.fromEntries(list); },
    () => { loading = false; /* the made sounds play instead; the next style pick tries again */ },
  );
}
loadRecorded();

// How the recordings are changed as they play. rate: speed and pitch together
// (1 = as recorded); wobble: how far the pitch may vary from one play to the
// next; low / high: dB added below 220 Hz and above 4.5 kHz.
const TUNE = { rate: 0.92, wobble: 0.04, low: 4, high: -3 };
let warm = null;
function warmth(c) {
  if (!warm) {
    warm = c.createBiquadFilter();
    warm.type = 'lowshelf';
    warm.frequency.value = 220;
    warm.gain.value = TUNE.low;
    const top = c.createBiquadFilter();
    top.type = 'highshelf';
    top.frequency.value = 4500;
    top.gain.value = TUNE.high;
    warm.connect(top).connect(c.destination);
  }
  return warm;
}

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

// ---------- making the sounds ----------
// A knock: [frequency Hz, level, decay ms] for each mode the piece and board
// ring at, a short body thump, and the click of contact: [level, decay ms]
// of bright noise. Everything is over in well under a tenth of a second.
const MOVE = {
  modes: [[540, 1, 15], [1120, 0.62, 10], [1980, 0.36, 7], [3250, 0.16, 4]],
  body: [215, 0.55, 16],
  click: [0.5, 1.1],
};
const CAPTURE = {
  modes: [[660, 1, 19], [1390, 0.8, 13], [2450, 0.5, 9], [3950, 0.26, 5]],
  body: [250, 0.5, 14],
  click: [0.85, 1.4],
};

function knock(out, sr, at, spec, { gain = 1, pitch = 1 } = {}) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor(sr * 0.2));
  const [clickLevel, clickMs] = spec.click;
  const S = STYLES[style];
  const part = ([f, a, ms], level = 1) => ({ w: 2 * Math.PI * f * pitch * S.p, a: a * level, tau: ((ms * S.d) / 1000) * sr, ph: Math.random() * 0.4 });
  const parts = [...spec.modes.map((m) => part(m)), part(spec.body, S.b)];
  let hp = 0;
  let prev = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // A fraction of a millisecond of attack: crisp, but not a hard step.
    const env = Math.min(1, i / ((S.a / 1000) * sr));
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-i / p.tau) * Math.sin(p.w * t + p.ph);
    // The click: noise between about 1.5 and 6 kHz that dies within a millisecond or two.
    const n = Math.random() * 2 - 1;
    hp = 0.8 * (hp + n - prev);
    prev = n;
    lp += 0.55 * (hp - lp);
    s += clickLevel * S.c * 3 * lp * Math.exp(-i / ((clickMs / 1000) * sr));
    out[start + i] += gain * env * s;
  }
}

// A short clear note (for check, promotion and game end).
function ping(out, sr, at, freq, { gain = 0.3, ms = 120 } = {}) {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.floor((sr * ms * 5) / 1000));
  const tau = (ms / 1000) * sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, i / (0.003 * sr)) * Math.exp(-i / tau);
    out[start + i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-i / (tau / 3)));
  }
}

const RECIPES = {
  move: (o, sr, j) => knock(o, sr, 0, MOVE, { pitch: j }),
  capture: (o, sr, j) => {
    knock(o, sr, 0, CAPTURE, { pitch: j * 1.1, gain: 0.6 });
    knock(o, sr, 0.014, CAPTURE, { pitch: j, gain: 1.15 });
  },
  castle: (o, sr, j) => {
    knock(o, sr, 0, MOVE, { pitch: j * 1.03, gain: 0.9 });
    knock(o, sr, 0.085, MOVE, { pitch: j * 0.96 });
  },
  check: (o, sr, j) => {
    knock(o, sr, 0, CAPTURE, { pitch: j * 1.08 });
    ping(o, sr, 0.004, 1245 * j, { gain: 0.3, ms: 38 });
  },
  promote: (o, sr, j) => {
    knock(o, sr, 0, MOVE, { pitch: j });
    ping(o, sr, 0.035, 880, { gain: 0.2, ms: 55 });
    ping(o, sr, 0.11, 1318.5, { gain: 0.22, ms: 120 });
  },
  end: (o, sr) => {
    ping(o, sr, 0, 659.25, { gain: 0.24, ms: 130 });
    ping(o, sr, 0.15, 493.88, { gain: 0.24, ms: 240 });
  },
};
// Peak level of each kind: captures loudest, notes softest.
const LEVEL = { move: 0.6, capture: 0.78, castle: 0.6, check: 0.68, promote: 0.62, end: 0.4 };
const LENGTH = { move: 0.24, capture: 0.27, castle: 0.34, check: 0.34, promote: 0.8, end: 1.4 };

// Exported so the sounds can be checked outside a browser.
export function buildBank(c) {
  const sr = c.sampleRate;
  const out = {};
  for (const [kind, recipe] of Object.entries(RECIPES)) {
    out[kind] = [];
    for (let k = 0; k < TAKES; k++) {
      const buf = c.createBuffer(1, Math.floor(sr * LENGTH[kind]), sr);
      const data = buf.getChannelData(0);
      recipe(data, sr, 1 + (k - (TAKES - 1) / 2) * 0.015);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      const scale = peak ? LEVEL[kind] / peak : 0;
      // Scale to the level, and fade the last 4 ms so nothing clicks at the end.
      const fade = Math.floor(sr * 0.004);
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
    bank = buildBank(ctx);
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
  // Mate: the move itself, then the two notes.
  if (kind === 'end') play('check');
  const takes = bank[kind] || bank.move;
  const file = STYLES[style].recorded && recorded && (recorded[kind] || recorded.move);
  const src = c.createBufferSource();
  src.buffer = file || takes[Math.floor(Math.random() * takes.length)];
  if (file) {
    // The recordings, made a little our own: a touch deeper and slower, never
    // quite the same pitch twice, and warmer (more low end, less top).
    src.playbackRate.value = TUNE.rate * (1 + (Math.random() - 0.5) * TUNE.wobble);
    src.connect(warmth(c));
  } else src.connect(c.destination);
  src.start(kind === 'end' ? c.currentTime + 0.15 : c.currentTime);
}
