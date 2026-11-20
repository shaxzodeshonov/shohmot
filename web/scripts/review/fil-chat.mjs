// Fischer in the review's Coach tab: it greets you as soon as a review starts,
// and once Stockfish is done it coaches you through the game.
//
// With AI on for the site (/api/fil, Claude), Fischer is an agent: it leads the
// review moment by moment, moving the board itself (show_move), and answers
// questions. The first time, it asks before sending the game anywhere; that
// choice is remembered. Without AI, or if you'd rather not, Fischer steps through
// the key moments with the notes the review already has.

const OK = 'shohmot-fil-ok';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// hooks: facts() -> { header, plies }, moments() -> [{ ply, text }], where() -> "14...Nxe4",
// show(ply), speak(text), reading(text) as a reply comes in and reading(null) when it's done,
// track(name)
export function createFil(hooks) {
  const $ = (s) => document.querySelector(s);
  const log = $('#fil-log');
  const start = $('#fil-start');
  const chips = $('#fil-chips');
  const form = $('#fil-form');
  const input = $('#fil-input');
  const said = $('#fil-said');
  let aiOn = null; // unknown until /api/fil answers
  let ready = false;
  let busy = false;
  let history = [];
  let mode = null; // 'ai' | 'tour'
  let tour = [];
  let at = -1;

  const status = fetch('/api/fil', { cache: 'no-store' }).then((r) => r.json()).then((j) => { aiOn = !!j.on; }).catch(() => { aiOn = false; });

  // ---------- the log ----------
  function bubble(who, text = '') {
    const li = document.createElement('li');
    li.className = 'fil-msg';
    li.dataset.who = who.split(' ')[0];
    if (who.includes('thinking')) li.classList.add('thinking');
    li.textContent = text;
    log.append(li);
    follow();
    return li;
  }
  // Keep the newest words in view (the panel scrolls, not the page).
  const scroller = log.closest('.panel-body');
  function follow() { if (scroller) scroller.scrollTop = scroller.scrollHeight; }
  const clean = (t) => t.replace(/\*\*?|__|#+\s/g, '');
  // Screen readers hear each finished reply once, not every word as it streams.
  function announce(text) { said.textContent = ''; setTimeout(() => { said.textContent = text; }, 50); }

  function setChips(list) {
    chips.innerHTML = list.map(([label, say]) => `<button type="button" class="btn fil-chip" data-say="${say.replace(/"/g, '&quot;')}">${label}</button>`).join('');
    chips.hidden = !list.length;
  }
  const AI_CHIPS = [['Go on', 'Go on.'], ['Why was this move bad?', 'Why was the move on the board a mistake, and what should I have played?'], ['Explain this position', 'What is going on in the position on the board?'], ['What should I work on?', 'What should I work on after this game?']];

  // ---------- greeting, while Stockfish works ----------
  function greet() {
    log.innerHTML = '';
    history = [];
    mode = null;
    bubble('fil', 'I’m Fischer. I’m going through your game with Stockfish now, every move. When it’s done, I’ll show you where you won it and where you threw it away.');
    start.hidden = true;
    chips.hidden = true;
    form.hidden = true;
  }

  // ---------- the review is done ----------
  async function done() {
    ready = true;
    await status;
    // "I'm going through this game now" is out of date: the chat starts fresh.
    log.innerHTML = '';
    // The numbers are in Fischer's note at the top; here, just what's next.
    if (aiOn && store.get(OK) === '1') { bubble('fil', 'Done. My verdict is up top, next to my face. Now we go through it.'); return startAi(); }
    bubble('fil', 'Done. My verdict is up top, next to my face. Ready to go through the moments that decided it?');
    start.hidden = false;
    $('#fil-ai-note').hidden = !aiOn;
    $('#fil-go').hidden = !aiOn;
    $('#fil-tour').className = aiOn ? 'btn' : 'btn btn-solid';
  }

  // ---------- AI coaching ----------
  function startAi() {
    store.set(OK, '1');
    mode = 'ai';
    start.hidden = true;
    form.hidden = false;
    setChips(AI_CHIPS);
    send('Start the review. Take me through the key moments of this game, one at a time.', { quiet: true });
  }

  async function send(text, { quiet = false } = {}) {
    if (busy || !ready) return;
    if (mode !== 'ai') {
      if (!aiOn) return;
      store.set(OK, '1');
      mode = 'ai';
      start.hidden = true;
      form.hidden = false;
      setChips(AI_CHIPS);
    }
    busy = true;
    form.querySelector('button').disabled = true;
    for (const b of chips.querySelectorAll('button')) b.disabled = true;
    if (!quiet) bubble('you', text);
    const reply = bubble('fil thinking', '');
    let words = '';
    hooks.track('fil_message');
    try {
      const res = await fetch('/api/fil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: hooks.facts(), messages: history, say: `[The board is on ${hooks.where()}.] ${text}` }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || 'Fischer couldn’t answer just now. Try again in a moment.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') {
              words += ev.text;
              hooks.reading(ev.text);
              reply.classList.remove('thinking');
              reply.textContent = clean(words);
              follow();
            } else if (ev.type === 'show') {
              hooks.show(ev.ply);
            } else if (ev.type === 'done') {
              history = history.concat(ev.messages);
            } else if (ev.type === 'error') {
              throw new Error(ev.message);
            }
          }
        }
      }
      if (!words) reply.remove();
      else { announce(clean(words)); hooks.speak(clean(words)); }
    } catch (err) {
      reply.classList.remove('thinking');
      reply.classList.add('error');
      reply.textContent = err.message;
    } finally {
      hooks.reading(null);
      busy = false;
      form.querySelector('button').disabled = false;
      for (const b of chips.querySelectorAll('button')) b.disabled = false;
    }
  }

  // ---------- the key moments, without AI ----------
  function startTour() {
    mode = 'tour';
    start.hidden = true;
    tour = hooks.moments();
    at = -1;
    if (!tour.length) { bubble('fil', 'Nothing to go through: every move held up. That’s how it’s done. Step through with the arrow keys.'); return; }
    bubble('fil', `${tour.length === 1 ? 'One moment' : `${tour.length} moments`} decided this game. My notes on each are at the top, next to my face.`);
    stepTour(1);
  }
  function stepTour(d) {
    at = Math.max(0, Math.min(tour.length - 1, at + d));
    const m = tour[at];
    hooks.show(m.ply);
    bubble('fil', `${at + 1} of ${tour.length}: ${m.text}`);
    const list = [];
    if (at > 0) list.push(['Previous', '#prev']);
    if (at < tour.length - 1) list.push(['Next moment', '#next']);
    else list.push(['That’s all: start again', '#again']);
    if (aiOn) list.push(['Ask Fischer (AI)', '#ai']);
    setChips(list);
  }

  // ---------- events ----------
  $('#fil-go').addEventListener('click', startAi);
  $('#fil-tour').addEventListener('click', startTour);
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-say]');
    if (!b) return;
    const s = b.dataset.say;
    if (s === '#next') return stepTour(1);
    if (s === '#prev') return stepTour(-1);
    if (s === '#again') { at = -1; return stepTour(1); }
    if (s === '#ai') return startAi();
    send(s);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });

  return {
    greet,
    done,
    // Fischer is talking through the game: the move notes stay quiet so they don't talk over it.
    get talking() { return mode === 'ai'; },
  };
}
