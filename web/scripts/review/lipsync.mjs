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

// The player. apply(viseme) changes the face; it's called only when the shape
// changes. onLive(true/false): the mouth starts or stops talking.
export function createLipSync(apply, { onLive = () => {}, now = () => performance.now(), frame = (fn) => requestAnimationFrame(fn), cancel = (id) => cancelAnimationFrame(id), later = (fn, ms) => setTimeout(fn, ms), clear = (id) => clearTimeout(id) } = {}) {
  let words = [];
  let shift = 0; // timeline time = now() - shift
  let raf = 0;
  let shown = 'rest';
  let text = '';
  let rate = 1;
  let live = false;
  let closing = 0;

  const setLive = (on) => { if (on !== live) { live = on; onLive(on); } };
  const show = (v) => { if (v !== shown) { shown = v; apply(v); } };
  function tick() {
    raf = 0;
    if (!live) return;
    const t = now() - shift;
    let v = 'rest';
    for (const w of words) {
      if (t < w.at) break;
      if (t >= w.end) continue;
      const s = w.shapes.find((x) => t >= x.at && t < x.end);
      if (s) v = s.v;
      break;
    }
    show(v);
    raf = frame(tick);
  }
  const run = () => { if (!raf) raf = frame(tick); };
  const stop = () => { clear(closing); closing = 0; setLive(false); if (raf) cancel(raf); raf = 0; show('rest'); };

  return {
    // The voice starts saying text (exactly the string it speaks).
    start(spoken, speakRate = 1) {
      text = spoken;
      rate = speakRate;
      words = timeline(text, { rate });
      shift = now();
      clear(closing);
      setLive(true);
      run();
    },
    // The voice reached the word at charIndex: that word plays from now.
    boundary(charIndex) {
      if (!live) return;
      const w = words.find((x) => x.char === charIndex) || words.find((x) => x.char > charIndex - 1);
      if (w) shift = now() - w.at;
    },
    // Text arriving without a voice (a reply being written): read it along.
    read(more) {
      clear(closing);
      if (!live) { words = []; text = ''; shift = now(); setLive(true); }
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
