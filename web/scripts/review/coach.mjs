// Fischer, the review's coach: what it says about each move, how its face looks,
// and (if you turn it on) its voice. Fischer is Shohmot's own coach character.
// The facts (the label, what was lost, the better move) come from the review;
// Fischer adds the lesson in plain words.
import { timeline } from './lipsync.mjs';

// ---------- what Fischer says ----------

// The same move always gets the same line, so stepping back and forth
// doesn't reshuffle the text.
const pick = (list, seed) => list[Math.abs(seed) % list.length];

// A lesson for each kind of mistake (label.mjs explain() names the kind).
const MY_LESSONS = {
  mate: [
    'You walked into mate. Every move, look at every check he can give. Every one. Mates come from the checks you didn’t look at.',
    'Your king had no air, and you played a quiet move. Make room for the king or cover the checks first. That’s not optional.',
  ],
  missedMate: [
    'He was mated and you let him live. Boxed-in king: checks first, then captures, then threats. Finish him.',
    'A king with no squares is a target. You had mate. Try every check before anything else, every time.',
  ],
  hung: [
    'You just gave a piece away. Before you let go of anything, ask what it was guarding and who guards it now.',
    'An undefended piece is a gift, and you gave one. Check every piece that just lost its defender.',
  ],
  material: [
    'That costs material. Count attackers and defenders on the square before you move away or trade. Count. Don’t hope.',
    'Every move leaves something behind. This one left too much. Look at what you stopped defending.',
  ],
  missed: [
    'He blundered and you didn’t punish it. After every one of his moves: what changed, and what can I take? That’s how you win games.',
    'He handed you the game and you handed it back. When he slips, slow down. That’s the moment to go for the kill.',
  ],
  position: [
    'Nothing is lost yet, but now you’re the one suffering. Before you move, find his best reply. Not the one you hope for.',
    'This is where it starts to slide. Checks, captures, threats: his most forcing replies first, then commit.',
  ],
  // A blunder with nothing lost straight away: the damage is a move or two deeper.
  swing: [
    'Big swing, even if nothing falls at once. You stopped calculating one move too early. What is his best answer? Find it.',
    'The trouble comes a move later. When a move looks good, that’s exactly when you check his strongest reply.',
  ],
  inaccuracy: [
    'Loose. Look for moves that do two jobs: develop and defend, attack and improve.',
    'Not a disaster, but not the best move either. Ask what the position needs most, then play that.',
  ],
};
const THEIR_LESSONS = {
  mate: ['He left his king open. Look at every check: one of them mates.'],
  missedMate: ['He had mate and missed it. You got lucky. Watch your king’s escape squares.'],
  hung: ['He left something hanging. Take it. Free material wins games.'],
  material: ['He just gave something away. See what his move stopped defending, and take it.'],
  missed: ['He missed his chance. Don’t give him a second one.'],
  position: ['He’s drifting. Now push. Don’t let him breathe.'],
  inaccuracy: ['A small slip by him. Small edges add up. Keep squeezing.'],
};
const PRAISE = {
  brilliant: ['A real sacrifice, and it works. That’s how you break a man.', 'Brilliant. You gave something up and the attack holds. That’s chess.'],
  great: ['The only move. Finding those under pressure is what wins games.', 'Great move. Anything else and it slips away.'],
  best: ['The best move. Good.', 'Correct. Nothing better here.', 'Exactly right. Keep playing like this.'],
  excellent: ['Strong. Almost the best move.', 'Excellent. Everything stays under control.'],
  good: ['Solid. Not the sharpest, but fine.', 'It does the job. There was more, though.'],
  book: ['Still theory. Know your openings cold.'],
  forced: ['The only legal move. Nothing to think about.'],
};
const THEIR_GOOD = {
  brilliant: ['He found a brilliant sacrifice. Study it. Then never let it happen again.'],
  great: ['He found the only move. Tough to see coming. Respect it.'],
};

// What Fischer adds for one move: { mood, tip }.
// label: the review's label; kind: explain()'s kind for bad moves; mine: it was your move.
export function coachFor({ label, kind, mine, ply }) {
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

// Fischer's greeting once the review is done.
export function summaryFor({ accuracy, theirs, mistakes, blunders, brilliants }) {
  const acc = accuracy != null ? `You played with ${accuracy.toFixed(1)} accuracy${theirs != null ? `, he played ${theirs.toFixed(1)}` : ''}. ` : '';
  const praise = brilliants ? `You found ${brilliants === 1 ? 'a brilliant move' : `${brilliants} brilliant moves`}. Good. ` : '';
  const todo = mistakes + blunders
    ? `${mistakes + blunders === 1 ? 'One moment' : `${mistakes + blunders} moments`} where it went wrong. We go through ${mistakes + blunders === 1 ? 'it' : 'every one'}. Press N for the next, or step through with the arrow keys.`
    : 'No mistakes, no blunders. A clean game. That’s how it should be played. Step through with the arrow keys.';
  return { mood: blunders ? 'calm' : 'happy', tip: `${acc}${praise}${todo}` };
}

// ---------- Fischer's face ----------
// One drawing; data-mood on the coach box picks the eyes and mouth (review.css).
export function setMood(el, mood) {
  if (el && el.dataset.mood !== mood) el.dataset.mood = mood;
}

// ---------- Fischer's voice ----------
// Off until you turn it on. For accounts that have it (src/voice.js), Fischer's
// own cloned voice: each line is fetched from /api/voice and played. For
// everyone else, and whenever that fails, the browser's own speech, with
// nothing sent anywhere: a man's voice if the device has one, pitched a
// little low.
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
  // Resolves false when the line couldn't be played (the caller falls back to the browser's speech).
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
    // The mouth follows the words at the pace this recording says them.
    const spoken = timeline(words);
    const natural = spoken.length ? spoken[spoken.length - 1].end : 0;
    const rate = natural && buf.duration ? Math.min(2, Math.max(0.5, natural / (buf.duration * 1000))) : 1;
    src.onended = () => { if (node === src) { node = null; talking(false); } };
    node = src;
    src.start();
    talking(true, words, rate, buf.duration * 1000 + 600);
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
  const talking = (on, words = '', rate = 1, ms = 1500 + words.length * 90) => {
    clearTimeout(guard);
    onTalk(on);
    if (lip) { if (on) lip.start(words, rate); else lip.end(true); }
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
        if (cloud && await sayCloud(words)) return;
        if (!synth || last !== words) return;
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
