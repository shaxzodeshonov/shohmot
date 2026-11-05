// Fischer, the review's coach: what it says about each move, how its face looks,
// and (if you turn it on) its voice. Fischer is Shohmot's own coach character.
// The facts (the label, what was lost, the better move) come from the review;
// Fischer adds the lesson in plain words.

// ---------- what Fischer says ----------

// The same move always gets the same line, so stepping back and forth
// doesn't reshuffle the text.
const pick = (list, seed) => list[Math.abs(seed) % list.length];

// A lesson for each kind of mistake (label.mjs explain() names the kind).
const MY_LESSONS = {
  mate: [
    'Before every move, look at every check your opponent could give next. Mates come from the checks we didn’t look at.',
    'When your king is short of squares, a quiet move can be the losing one. Make room for it, or cover the checks first.',
  ],
  missedMate: [
    'When the enemy king is boxed in, look at checks first, then captures, then threats. Mate was there.',
    'A king with no escape squares is a target. Try every check before anything else.',
  ],
  hung: [
    'Before you let go of a piece, ask what it was guarding and who guards it now.',
    'A piece that nothing defends is a gift. Check every piece that just lost its defender.',
  ],
  material: [
    'Count attackers and defenders on that square before you move away or trade.',
    'Every move undefends something. Look at what this one left behind.',
  ],
  missed: [
    'Your opponent had just slipped. After each of their moves, ask: what changed, and what can I take now?',
    'When the other side makes a mistake, slow down. That’s the moment to look for the punishment.',
  ],
  position: [
    'Nothing is lost straight away, but the position gets harder to play. Before you move, ask what your opponent’s best reply would be.',
    'Here the position starts to slide. Check your opponent’s most forcing replies (checks, captures, threats) before you commit.',
  ],
  // A blunder with nothing lost straight away: the damage is a move or two deeper.
  swing: [
    'That’s a big swing, even though nothing is lost at once. Before a capture or a check, look one move deeper: what is their best answer?',
    'The trouble here comes a move later. When a move looks good, check your opponent’s strongest reply before you play it.',
  ],
  inaccuracy: [
    'A small slip. Look for moves that do two jobs at once: develop and defend, attack and improve.',
    'Not a disaster, but there was something more useful. Ask what the position needs most before you move.',
  ],
};
const THEIR_LESSONS = {
  mate: ['Your opponent left their king open. Look at every check: one of them mates.'],
  missedMate: ['Your opponent let you off: they had mate. Keep an eye on your king’s escape squares.'],
  hung: ['Your opponent left something loose. Spot the undefended piece and take it.'],
  material: ['Your opponent just gave something away. Look at what their move stopped defending.'],
  missed: ['Your opponent missed their chance. Make sure you don’t give them a second one.'],
  position: ['Your opponent drifted. This is the time to push your advantage.'],
  inaccuracy: ['A small slip by your opponent. Little edges add up, so keep pressing.'],
};
const PRAISE = {
  brilliant: ['A real sacrifice, and it works. That’s a move to remember.', 'Brilliant! You gave something up and the position holds. Beautiful.'],
  great: ['The only move that holds it together. Finding those under pressure wins games.', 'Great move: anything else and the position slips.'],
  best: ['Exactly what the engine wanted.', 'Spot on. That’s the best move.', 'Perfect. Nothing better here.'],
  excellent: ['Very strong. Almost as good as the best move.', 'Excellent, that keeps everything under control.'],
  good: ['A good, solid move.', 'Fine. Not the very best, but it keeps you on track.'],
  book: ['Still in opening theory. Good players have played this many times.'],
  forced: ['The only legal move. Nothing to think about here.'],
};
const THEIR_GOOD = {
  brilliant: ['Your opponent found a brilliant sacrifice. Worth studying how it works.'],
  great: ['Your opponent found the only move. A tough one to see coming.'],
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
  const acc = accuracy != null ? `You played with ${accuracy.toFixed(1)} accuracy${theirs != null ? `, your opponent ${theirs.toFixed(1)}` : ''}. ` : '';
  const praise = brilliants ? `And you found ${brilliants === 1 ? 'a brilliant move' : `${brilliants} brilliant moves`}! ` : '';
  const todo = mistakes + blunders
    ? `I’ve marked ${mistakes + blunders === 1 ? 'one moment' : `${mistakes + blunders} moments`} worth a closer look. Press N to jump to the next one, or step through with the arrow keys.`
    : 'No mistakes or blunders: a clean game. Step through with the arrow keys and enjoy it.';
  return { mood: blunders ? 'calm' : 'happy', tip: `${acc}${praise}${todo}` };
}

// ---------- Fischer's face ----------
// One drawing; data-mood on the coach box picks the eyes and mouth (review.css).
export function setMood(el, mood) {
  if (el && el.dataset.mood !== mood) el.dataset.mood = mood;
}

// ---------- Fischer's voice ----------
// The browser's own speech, nothing sent anywhere. Off until you turn it on;
// a calm, natural voice if the device has one, a little slower and quieter
// than usual.
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

// Voices that sound calm, best first. Names differ by system; any English voice will do after these.
const SOFT = [/natural.*(aria|jenny|ava|emma|sonia|libby|michelle)/i, /(ava|samantha|allison|serena|karen|moira|tessa|fiona)/i, /google uk english female/i, /(aria|jenny|zira|hazel)/i, /google us english/i];

// onTalk(true/false): Fischer's mouth moves while it speaks.
export function createVoice({ key = 'shohmot-coach-voice', onTalk = () => {} } = {}) {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  let on = false;
  try { on = !!synth && localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  let voice = null;
  const choose = () => {
    const all = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    for (const re of SOFT) { const v = all.find((x) => re.test(x.name)); if (v) { voice = v; return; } }
    voice = all.find((v) => v.localService) || all[0] || null;
  };
  if (synth) { choose(); synth.addEventListener?.('voiceschanged', choose); }
  let timer = 0;
  let last = '';
  let guard = 0;
  let current = null;
  // Some browsers don't always say when speech ends (or was cut off), so a
  // timer from the length of the text closes the mouth anyway.
  const talking = (on, words = '') => {
    clearTimeout(guard);
    onTalk(on);
    if (on) guard = setTimeout(() => onTalk(false), 1500 + words.length * 90);
  };
  return {
    supported: !!synth,
    get on() { return on; },
    set(value) {
      on = !!value && !!synth;
      try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
      if (!on) { clearTimeout(timer); synth && synth.cancel(); last = ''; talking(false); }
    },
    // Says it once things settle (stepping quickly through moves doesn't queue them up).
    say(text) {
      if (!on || !synth) return;
      const words = sayable(text);
      if (!words || words === last) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = words;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(words);
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : 'en-US';
        u.rate = 0.92;
        u.pitch = 1.05;
        u.volume = 0.85;
        current = u;
        // A cut-off earlier utterance reports its end late: only the current one moves the mouth.
        u.onstart = () => { if (current === u) talking(true, words); };
        u.onend = u.onerror = () => { if (current === u) talking(false); };
        synth.speak(u);
      }, 280);
    },
    stop() { clearTimeout(timer); synth && synth.cancel(); last = ''; talking(false); },
  };
}
