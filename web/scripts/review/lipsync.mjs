// Lip sync for Fischer: the words being said -> the mouth shapes ("visemes")
// that say them, played in time with the voice.
//
// The browser's speech engine tells us when each word starts (a "boundary"
// event); each word's shapes play from that moment. Voices that don't report
// words still get a timeline, from the text and the speaking rate. Without
// the voice, the mouth reads a reply along as it arrives.

// The mouth shapes, as frames: rest (closed), mbp (lips pressed: m, b, p),
// fv (lip on teeth: f, v), ee, eh, ah, oo.
export const VISEMES = ['rest', 'mbp', 'fv', 'ee', 'eh', 'ah', 'oo'];

// Letter pairs first: they're one sound.
const PAIRS = {
  ee: 'ee', ea: 'ee', ie: 'ee', ey: 'ee', ei: 'ee',
  oo: 'oo', ou: 'oo', ow: 'oo', ew: 'oo', wh: 'oo', qu: 'oo', oa: 'oo', ue: 'oo',
  sh: 'oo', ch: 'oo', th: 'eh', ph: 'fv', ng: 'eh', ck: 'eh', ai: 'eh', ay: 'eh', au: 'ah', aw: 'ah',
};
const SINGLE = {
  a: 'ah', e: 'eh', i: 'ee', u: 'eh', y: 'ee',
  m: 'mbp', b: 'mbp', p: 'mbp', f: 'fv', v: 'fv', w: 'oo', r: 'eh', j: 'oo',
};
// How long each shape lasts at normal speed, in ms. Lips that close (m, b, p)
// need to be seen, so they're not shorter than the rest.
const LENGTH = { ee: 115, eh: 85, ah: 125, oo: 120, mbp: 85, fv: 85, rest: 60 };

// "board" -> ["mbp", "oo", "eh", "eh"]: the shapes of one word, in order,
// with a repeated shape merged into one longer one.
export function wordVisemes(word) {
  const w = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = [];
  const push = (v, len = LENGTH[v]) => {
    const last = out[out.length - 1];
    if (last && last.v === v) last.ms += len * 0.6;
    else out.push({ v, ms: len });
  };
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if (/[0-9]/.test(c)) { push('eh'); push('ah'); continue; } // digits: "four", "twenty"…
    const pair = PAIRS[w.slice(i, i + 2)];
    if (pair) { push(pair, LENGTH[pair] * 1.2); i++; continue; }
    if (c === 'e' && i === w.length - 1 && i > 1) continue; // silent final e
    if (c === 'o') { push(i === w.length - 1 || 'wua'.includes(w[i + 1] || '') ? 'oo' : 'ah'); continue; }
    if (c === 'h' && i > 0) continue;
    if (SINGLE[c]) { push(SINGLE[c]); continue; }
    // Other consonants (t, d, n, s, k, l…): a small, quick opening.
    push('eh', 60);
  }
  return out;
}

// The whole text as a timeline: [{ at, end, char, shapes: [{ v, at, end }] }],
// times in ms from the start at the given speaking rate.
export function timeline(text, { rate = 1, from = 0, offset = 0 } = {}) {
  const words = [];
  let t = from;
  const re = /[A-Za-z0-9’']+|[.,!?;:]/g;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[0];
    if (/^[.,!?;:]$/.test(tok)) { t += (tok === ',' ? 160 : 260) / rate; continue; }
    const shapes = [];
    let s = t;
    for (const { v, ms } of wordVisemes(tok)) {
      const d = ms / rate;
      shapes.push({ v, at: s, end: s + d });
      s += d;
    }
    words.push({ at: t, end: s, char: offset + m.index, shapes });
    t = s + 45 / rate; // a breath of rest between words
  }
  return words;
}

// A shape stays at least this long: faster than that, a mouth twitches.
export const HOLD_MS = 90;
// Between words closer than this, the mouth doesn't shut; it stays a little open.
const RUN_ON_MS = 120;

// With the recording itself (level mode): how open the mouth is, from how loud
// the voice is right now relative to its recent peaks, in four steps: shut, a
// little, half, wide. To change step the loudness has to clearly cross the line
// (by MARGIN), so a voice hovering near one doesn't make the mouth flutter.
const STEPS = [0.14, 0.34, 0.64];
const MARGIN = 0.07;
export function levelStep(open, prev = 0) {
  let s = prev;
  while (s < STEPS.length && open > STEPS[s] + MARGIN) s++;
  while (s > 0 && open < STEPS[s - 1] - MARGIN) s--;
  return s;
}
// The shape for a step: the words only choose rounded ("oo") or wide ("ee")
// while the mouth is open. Lips closing for m, b, p come from the recording
// itself (it goes quiet), not from the text's guess at when they are.
export function shapeForStep(step, wordShape) {
  if (step === 0) return 'rest';
  if (wordShape === 'oo' || wordShape === 'ee') return wordShape;
  return ['rest', 'fv', 'eh', 'ah'][step];
}

// The player. apply(viseme) changes the face; it's called only when the shape
// changes. onLive(true/false): the mouth starts or stops talking.
export function createLipSync(apply, { onLive = () => {}, now = () => performance.now(), frame = (fn) => requestAnimationFrame(fn), cancel = (id) => cancelAnimationFrame(id), later = (fn, ms) => setTimeout(fn, ms), clear = (id) => clearTimeout(id) } = {}) {
  let words = [];
  let shift = 0; // timeline time = now() - shift
  let raf = 0;
  let shown = 'rest';
  let changed = -Infinity; // when the shape last changed
  let text = '';
  let rate = 1;
  let live = false;
  let closing = 0;
  let level = null; // () => the recording's loudness now (level mode), or null
  let env = 0;      // the loudness, smoothed
  let peak = 0;     // recent loudest, slowly forgotten
  let step = 0;     // how open (levelStep)

  const setLive = (on) => { if (on !== live) { live = on; onLive(on); } };
  const show = (v, force = false) => {
    if (v === shown) return;
    const t = now();
    if (!force && t - changed < HOLD_MS) return;
    shown = v;
    changed = t;
    apply(v);
  };
  // The word shape the text says at timeline time t ('rest' between words).
  function wordShape(t) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (t < w.at) {
        // In the short gap between two words the mouth stays a little open.
        const prev = words[i - 1];
        return prev && t - prev.end < RUN_ON_MS / rate && w.at - t < RUN_ON_MS / rate ? 'fv' : 'rest';
      }
      if (t >= w.end) continue;
      const s = w.shapes.find((x) => t >= x.at && t < x.end);
      return s ? s.v : 'rest';
    }
    return 'rest';
  }
  function tick() {
    raf = 0;
    if (!live) return;
    const t = now() - shift;
    let v = wordShape(t);
    if (level) {
      const l = level();
      // Opens quickly, closes a little slower: like a jaw, not a switch.
      env += (l - env) * (l > env ? 0.4 : 0.18);
      peak = Math.max(peak * 0.996, env, 0.02);
      step = levelStep(env / peak, step);
      v = shapeForStep(step, v);
    }
    show(v);
    raf = frame(tick);
  }
  const run = () => { if (!raf) raf = frame(tick); };
  const stop = () => { clear(closing); closing = 0; level = null; setLive(false); if (raf) cancel(raf); raf = 0; show('rest', true); };

  return {
    // The voice starts saying text (exactly the string it speaks). With
    // `level` (() => loudness 0–1 of the recording playing), the mouth opens
    // with the sound itself and the text only picks the shapes.
    start(spoken, speakRate = 1, { level: loudness = null } = {}) {
      text = spoken;
      rate = speakRate;
      words = timeline(text, { rate });
      shift = now();
      level = loudness;
      env = 0;
      peak = 0;
      step = 0;
      clear(closing);
      setLive(true);
      run();
    },
    // The voice reached the word at charIndex: that word plays from now.
    boundary(charIndex) {
      if (!live) return;
      const w = words.find((x) => x.char === charIndex) || words.find((x) => x.char > charIndex - 1);
      if (w) { shift = now() - w.at; changed = -Infinity; }
    },
    // Text arriving without a voice (a reply being written): read it along.
    read(more) {
      clear(closing);
      if (!live) { words = []; text = ''; level = null; shift = now(); setLive(true); }
      const t = now() - shift;
      const last = words.length ? words[words.length - 1].end + 45 : 0;
      // A little quicker than the voice: about reading pace.
      words = words.concat(timeline(more, { rate: 1.15, from: Math.max(t, last), offset: text.length }));
      text += more;
      run();
    },
    // Done talking: back to rest once what's queued has played (or at once).
    end(immediately = false) {
      clear(closing);
      if (immediately || !words.length) return stop();
      const close = () => {
        const left = words[words.length - 1].end - (now() - shift);
        if (left <= 1) stop(); else closing = later(close, left);
      };
      close();
    },
    get playing() { return live; },
  };
}
