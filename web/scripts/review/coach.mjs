// Fischer, the review's coach: what it says about each move, how its face looks,
// and (if you turn it on) its voice. Fischer is Shohmot's own coach character.
// The facts (the label, what was lost, the better move) come from the review;
// Fischer adds the lesson in plain words.
import { timeline } from './lipsync.mjs';

// ---------- what Fischer says ----------

// The same move always gets the same line, so stepping back and forth
// doesn't reshuffle the text.
const pick = (list, seed) => list[Math.abs(seed) % list.length];

// Fischer's lines, in his manner: short, blunt, a little cocky, hard on the
// move and never on the person. No assistant talk: no "Remember", no "Great
// job", no explaining what the screen already shows.

// A lesson for each kind of mistake (label.mjs explain() names the kind).
const MY_LESSONS = {
  mate: [
    'You walked into mate. Look at every check he has. Every one.',
    'No air for your king and you play a quiet move. Coffeehouse chess. Give the king a square first.',
  ],
  missedMate: [
    'He was dead and you let him walk. Checks first. Always.',
    'Mate was right there. You didn’t look. Checks, captures, threats. In that order.',
  ],
  hung: [
    'You gave a piece away. For nothing. Before you let go, look at what’s hanging.',
    'A free piece. Even a patzer takes that. Don’t hand them out.',
  ],
  material: [
    'That drops material. Count attackers and defenders. Count. Don’t hope.',
    'You stopped guarding something, and now it’s gone. Look at what every move leaves behind.',
  ],
  missed: [
    'He blundered and you let him off. When he slips, you punish him. Every time.',
    'He handed you the game and you handed it back. I’d have seen that in two seconds.',
  ],
  position: [
    'Nothing’s lost yet. But now you’re the one squirming. Find his best reply, not the one you want.',
    'This is where it starts to slide. Forcing moves first. Then commit.',
  ],
  // A blunder with nothing lost straight away: the damage is a move or two deeper.
  swing: [
    'You stopped calculating one move too soon. What’s his best answer? Find it.',
    'Looks fine. It isn’t. The trouble is one move deeper.',
  ],
  inaccuracy: [
    'Loose. Every move should do two jobs.',
    'Not a disaster. Not the best move either. I don’t play second-best moves.',
  ],
};
const THEIR_LESSONS = {
  mate: ['He left his king open. One of your checks mates. Find it.'],
  missedMate: ['He had mate and missed it. You got lucky. Don’t count on it twice.'],
  hung: ['He left something hanging. Take it. Free material wins games.'],
  material: ['He just dropped material. See what his move stopped guarding, and take it.'],
  missed: ['He missed his chance. Don’t give him another one.'],
  position: ['He’s drifting. Squeeze him. Don’t let him breathe.'],
  inaccuracy: ['Small slip by him. Small edges add up. Keep squeezing.'],
};
const PRAISE = {
  brilliant: ['You gave up material and it holds. Now he’s squirming.', 'A real sacrifice, and it’s sound. That’s chess.'],
  great: ['The only move, and you found it. Good.', 'Only move. Now you’re playing chess.'],
  best: ['Good.', 'That’s the move.', 'Correct.'],
  excellent: ['Strong. Almost the best.', 'Good move.'],
  good: ['Fine. There was better.', 'It does the job. Not the best.'],
  book: ['Book. Know your openings cold.'],
  forced: ['Only legal move. Nothing to think about.'],
};
const THEIR_GOOD = {
  brilliant: ['He found a real sacrifice. Study it. Then never allow it again.'],
  great: ['He found the only move. Respect it. Then beat him.'],
};

// What Fischer adds for one move: { mood, tip }.
// label: the review's label; kind: explain()'s kind for bad moves; mine: it was your move.
export function coachFor({ label, kind, mine, ply, san }) {
  if (mine && ply === 1 && san === 'e4') return { mood: 'happy', tip: 'e4. Best by test.' };
  if (label === 'inaccuracy') kind = 'inaccuracy';
  if (label === 'blunder' && kind === 'position' && mine) kind = 'swing';
  if (['mistake', 'miss', 'blunder', 'inaccuracy'].includes(label)) {
    const lessons = (mine ? MY_LESSONS : THEIR_LESSONS)[kind] || (mine ? MY_LESSONS.position : THEIR_LESSONS.position);
    return { mood: mine ? (label === 'inaccuracy' ? 'hmm' : 'worried') : 'happy', tip: pick(lessons, ply) };
  }
  if (!mine) {
    if (THEIR_GOOD[label]) return { mood: 'wow', tip: pick(THEIR_GOOD[label], ply) };
    return { mood: 'calm', tip: '' };
  }
  if (label === 'brilliant' || label === 'great') return { mood: 'wow', tip: pick(PRAISE[label], ply) };
  return { mood: 'happy', tip: pick(PRAISE[label] || PRAISE.good, ply) };
}

// Fischer's greeting once the review is done: one short line, your accuracy
// and how many moments went wrong.
export function summaryFor({ accuracy, mistakes, blunders }) {
  const acc = accuracy != null ? `${accuracy.toFixed(1)} accuracy. ` : '';
  const n = mistakes + blunders;
  const todo = !n ? 'Clean game. That’s chess.' : n === 1 ? 'One bad move. We fix it.' : `${n} bad moves. We fix them.`;
  return { mood: blunders ? 'calm' : 'happy', tip: `${acc}${todo}` };
}

// What Fischer says on the game's last move. result: 'win', 'loss', 'draw' or null.
export function resultFor(result) {
  if (result === 'win') return { mood: 'happy', tip: 'You won. That’s the point.' };
  if (result === 'loss') return { mood: 'worried', tip: 'You lost. Now we find out why.' };
  if (result === 'draw') return { mood: 'calm', tip: 'A draw. I don’t play for draws.' };
  return null;
}

// ---------- Fischer's face ----------
// One drawing; data-mood on the coach box picks the eyes and mouth (review.css).
export function setMood(el, mood) {
  if (el && el.dataset.mood !== mood) el.dataset.mood = mood;
}

// ---------- Fischer's voice ----------
// Off until you turn it on. For accounts that have it (src/voice.js), Fischer's
// own cloned voice: each line is fetched from /api/voice and played; a line
// that can't be fetched goes unspoken, never into a second voice. For everyone
// else, the browser's own speech, with nothing sent anywhere: a man's voice if
// the device has one, pitched a little low.
const PIECE = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };
const SAN = /\b(O-O-O|O-O|([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=([QRBN]))?([+#])?)(?=[\s.,!?;:)]|$)/g;

// "Nxf7+" -> "knight takes f7, check"; "O-O" -> "castles".
export function sayable(text) {
  return String(text)
    .replace(/(\d+)\.{3}|(\d+)…/g, (m, a, b) => `${a || b},`)
    .replace(/\b(\d+)\.(?=\s*(?:O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8]))/g, '$1,')
    .replace(SAN, (m, whole, piece, file, rank, take, to, promo, promoPiece, check) => {
      if (whole === 'O-O-O') return 'castles queenside';
      if (whole === 'O-O') return 'castles';
      const words = [];
      if (piece) words.push(PIECE[piece]);
      else if (take && file) words.push(file);
      if (take) words.push('takes');
      words.push(to);
      if (promoPiece) words.push(`promotes to ${PIECE[promoPiece]}`);
      if (check === '+') words.push(', check');
      if (check === '#') words.push(', checkmate');
      return words.join(' ').replace(' ,', ',');
    })
    .replace(/(?<=[1-8])[?!]{1,2}(?=[\s.,]|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A man's voice, low and quick, best first. Names differ by system: Edge's
// natural voices, then Windows, macOS/iOS, Chrome's and Android's.
const MALE = [
  /natural.*(guy|christopher|eric|andrew|brian|davis|roger|steffan|tony|jason)/i,
  /(guy|christopher|andrew|brian|davis|roger|steffan).*online/i,
  /google uk english male/i,
  /(david|mark|james|george|richard|sean)/i,
  /(alex|daniel|aaron|evan|nathan|reed|tom|fred|oliver|arthur|rishi|gordon)/i,
  /male/i,
];
// Never these when guessing: the system defaults that sound like a woman.
const FEMALE = /female|woman|aria|jenny|ava|emma|sonia|libby|michelle|samantha|allison|serena|karen|moira|tessa|fiona|zira|hazel|susan|victoria|kate|catherine|linda|heera|nicky|joanna|salli|kimberly|ivy|kendra|amy|emily|olivia|ana|google us english/i;

// The voice the coach gets on this device: a male English voice if there is
// one, or at least not a female one.
export function pickVoice(voices) {
  const all = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  for (const re of MALE) { const v = all.find((x) => re.test(x.name) && !FEMALE.test(x.name)); if (v) return v; }
  return all.find((v) => !FEMALE.test(v.name) && v.localService) || all.find((v) => !FEMALE.test(v.name)) || all[0] || null;
}

// onTalk(true/false): Fischer is speaking. lip (lipsync.mjs): the mouth
// follows the words: start(text, rate), boundary(charIndex) as each word is
// reached, end().
export function createVoice({ key = 'shohmot-coach-voice', onTalk = () => {}, lip = null } = {}) {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  let cloud = false; // this account has Fischer's own voice
  let on = false;
  try { on = localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  const signedIn = typeof document !== 'undefined' && document.cookie.split('; ').includes('shohmot_in=1');
  // Asked once per page; signed-out visitors never have it, so they aren't asked.
  const ready = signedIn && AC && typeof fetch === 'function'
    ? fetch('/api/voice').then((r) => r.json()).then((d) => { cloud = !!(d && d.on); return cloud; }).catch(() => false)
    : Promise.resolve(false);
  const can = () => !!synth || cloud;

  // ----- the cloned voice: fetched, decoded and played through Web Audio -----
  let ctx = null;
  let node = null;
  let turn = 0;
  const clips = new Map(); // words -> Promise<AudioBuffer>, the newest 40
  const audio = () => (ctx ||= new AC());
  function clip(words) {
    if (clips.has(words)) return clips.get(words);
    const p = fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: words }) })
      .then((r) => { if (!r.ok) throw new Error(`voice ${r.status}`); return r.arrayBuffer(); })
      .then((b) => audio().decodeAudioData(b));
    clips.set(words, p);
    p.catch(() => clips.delete(words));
    if (clips.size > 40) clips.delete(clips.keys().next().value);
    return p;
  }
  function hush() {
    turn++;
    if (node) { const n = node; node = null; try { n.stop(); } catch { /* not started */ } }
  }
  // Resolves false when the line couldn't be played (it then goes unspoken).
  async function sayCloud(words) {
    const mine = ++turn;
    let buf;
    try {
      if (audio().state === 'suspended') await Promise.race([audio().resume(), new Promise((r) => setTimeout(r, 400))]);
      buf = await clip(words);
    } catch { return false; }
    if (mine !== turn || !on) return true; // something newer was said meanwhile
    if (audio().state !== 'running') return false;
    const src = audio().createBufferSource();
    const gain = audio().createGain();
    gain.gain.value = 0.9;
    src.buffer = buf;
    src.connect(gain).connect(audio().destination);
    // The mouth opens with the recording's own loudness; the words, spread over
    // the recording's length, only pick the shapes (rounded, wide, lips closed).
    const meter = audio().createAnalyser();
    meter.fftSize = 512;
    gain.connect(meter);
    const samples = new Float32Array(meter.fftSize);
    const level = () => {
      meter.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      return Math.sqrt(sum / samples.length);
    };
    const spoken = timeline(words);
    const natural = spoken.length ? spoken[spoken.length - 1].end : 0;
    const rate = natural && buf.duration ? Math.min(2, Math.max(0.5, natural / (buf.duration * 1000))) : 1;
    src.onended = () => { if (node === src) { node = null; talking(false); } };
    node = src;
    src.start();
    talking(true, words, rate, buf.duration * 1000 + 600, level);
    return true;
  }
  let voice = null;
  const choose = () => { voice = pickVoice(synth.getVoices()); };
  if (synth) { choose(); synth.addEventListener?.('voiceschanged', choose); }
  let timer = 0;
  let last = '';
  let guard = 0;
  let current = null;
  // Some browsers don't always say when speech ends (or was cut off), so a
  // timer from the length of the text closes the mouth anyway.
  const talking = (on, words = '', rate = 1, ms = 1500 + words.length * 90, level = null) => {
    clearTimeout(guard);
    onTalk(on);
    if (lip) { if (on) lip.start(words, rate, { level }); else lip.end(true); }
    if (on) guard = setTimeout(() => talking(false), ms);
  };
  const quiet = () => { clearTimeout(timer); hush(); synth && synth.cancel(); last = ''; talking(false); };
  return {
    get supported() { return can(); },
    // Resolves (true or false) once it's known whether this account has Fischer's own voice.
    ready,
    get cloned() { return cloud; },
    get on() { return on && can(); },
    set(value) {
      on = !!value && can();
      try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
      // Turning it on is a click: the one moment a browser lets a page start sound.
      if (on && cloud) audio().resume().catch(() => {});
      if (!on) quiet();
    },
    // Says it once things settle (stepping quickly through moves doesn't queue them up).
    say(text) {
      if (!on || !can()) return;
      const words = sayable(text);
      if (!words || words === last) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        last = words;
        hush();
        synth && synth.cancel();
        // Know first whether this account has Fischer's own voice, so an early
        // line doesn't go to the browser's voice while that's being asked.
        await ready;
        if (last !== words) return;
        // One voice per page: with Fischer's own voice, a line it can't say
        // (budget used up, offline, sound not allowed yet) stays on the screen,
        // unspoken, rather than coming out in the browser's robot voice.
        if (cloud) { await sayCloud(words); return; }
        if (!synth) return;
        const u = new SpeechSynthesisUtterance(words);
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : 'en-US';
        // Quick and low: a man who knows what he's talking about.
        u.rate = 1;
        u.pitch = 0.8;
        u.volume = 0.95;
        current = u;
        // A cut-off earlier utterance reports its end late: only the current one moves the mouth.
        u.onstart = () => { if (current === u) talking(true, words, u.rate); };
        u.onend = u.onerror = () => { if (current === u) talking(false); };
        // Each word as the voice reaches it, so the mouth says that word now.
        u.onboundary = (e) => { if (current === u && lip && (!e.name || e.name === 'word')) lip.boundary(e.charIndex); };
        synth.speak(u);
      }, 280);
    },
    stop: quiet,
  };
}
