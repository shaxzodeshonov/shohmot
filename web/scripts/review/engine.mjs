// Runs Stockfish (WebAssembly, in Web Workers) over many positions at once.
//
// Two builds of Stockfish 19: the full one with its big NNUE network (the same
// strength as desktop Stockfish) and the lite one (a much smaller network:
// quick to load, noticeably weaker). The full build's .wasm is 99 MB, too big
// for the repo and Vercel's free tier, so it comes from the npm package on
// unpkg. The page downloads it once (the browser caches it for next time) and
// every engine loads that one copy: the engine script reads its .wasm address
// from the part of its own URL after "#".
//
// The game is cut into short stretches and each engine works through a
// stretch from its last position back to its first, without clearing its
// hash. Searching backwards means that when an engine reaches a position, it
// has already seen what happens after the move that was played there, so
// "was this move as good as the best one?" is judged with the same knowledge
// on both sides. Chess GUIs call this backward or "blunder check" analysis.
export const ENGINES = {
  full: {
    name: 'Stockfish 19',
    url: '/vendor/stockfish-19-single.js',
    wasm: 'https://unpkg.com/stockfish@19.0.1/bin/stockfish-19-single.wasm',
    wasmSize: 99169054,
    hash: 64,
    workers: 3,
  },
  lite: { name: 'Stockfish 19 lite', url: '/vendor/stockfish-19-lite-single.js', hash: 32, workers: 4 },
};
const STRETCH = 8; // positions per stretch

class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listener = null;
    this.worker.onmessage = (e) => this.listener && this.listener(String(e.data));
  }

  // Sends commands and resolves with every line up to the one `done` matches.
  send(cmds, done) {
    return new Promise((resolve, reject) => {
      const lines = [];
      this.worker.onerror = (e) => reject(new Error(e.message || 'Stockfish failed to load.'));
      this.listener = (line) => {
        lines.push(line);
        if (done(line)) { this.listener = null; resolve(lines); }
      };
      for (const c of cmds) this.worker.postMessage(c);
    });
  }

  async init(multiPv, hash) {
    await this.send(['uci'], (l) => l === 'uciok');
    await this.send([
      `setoption name Hash value ${hash}`,
      `setoption name MultiPV value ${multiPv}`,
      'ucinewgame',
      'isready',
    ], (l) => l === 'readyok');
  }

  async analyse(fen, depth, movetime) {
    const lines = await this.send([`position fen ${fen}`, `go depth ${depth} movetime ${movetime}`], (l) => l.startsWith('bestmove'));
    return parseInfo(lines);
  }

  stop() { this.worker.terminate(); }
}

// Keeps the deepest line for each MultiPV slot. Scores are for the side to move.
export function parseInfo(lines) {
  const slots = [];
  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' pv ') || / (lower|upper)bound/.test(line)) continue;
    const t = line.split(' ');
    const at = (k) => t.indexOf(k);
    const depth = Number(t[at('depth') + 1]);
    const slot = at('multipv') >= 0 ? Number(t[at('multipv') + 1]) - 1 : 0;
    const kind = t[at('score') + 1];
    const value = Number(t[at('score') + 2]);
    const pv = t.slice(at('pv') + 1);
    if (!slots[slot] || depth >= slots[slot].depth) {
      slots[slot] = { depth, score: kind === 'mate' ? { mate: value } : { cp: value }, pv };
    }
  }
  return slots.filter(Boolean);
}

// The stretches to work through, last stretch of the game first, each one
// listed back to front. jobs are in game order.
export function stretches(count, size = STRETCH) {
  const out = [];
  for (let end = count; end > 0; end -= size) {
    const run = [];
    for (let k = end - 1; k >= Math.max(0, end - size); k--) run.push(k);
    out.push(run);
  }
  return out;
}

// The full build's .wasm as a blob: URL, downloaded once per page and kept
// in Cache Storage (the HTTP cache often skips a file this big).
// onProgress(loadedBytes, totalBytes) while it comes in.
const CACHE = 'shohmot-stockfish-19.0.1';
let fullWasm = null;
function loadFullWasm(onProgress) {
  fullWasm ??= (async () => {
    const { wasm, wasmSize } = ENGINES.full;
    const cache = globalThis.caches ? await caches.open(CACHE).catch(() => null) : null;
    const hit = cache && await cache.match(wasm).catch(() => null);
    if (hit) return URL.createObjectURL(await hit.blob());
    const res = await fetch(wasm);
    if (!res.ok) throw new Error(`HTTP ${res.status} for the Stockfish network`);
    const total = Number(res.headers.get('content-length')) || wasmSize;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
    const blob = new Blob(chunks, { type: 'application/wasm' });
    // Only a complete download is worth keeping.
    if (cache && loaded === total) cache.put(wasm, new Response(blob, { headers: { 'Content-Type': 'application/wasm' } })).catch(() => {});
    return URL.createObjectURL(blob);
  })().catch((err) => { fullWasm = null; throw err; });
  return fullWasm;
}

// The engine script's address, with the full network's blob: URL after "#".
export async function engineUrl(kind, onDownload = () => {}) {
  const { url } = ENGINES[kind];
  return kind === 'full' ? `${url}#${encodeURIComponent(await loadFullWasm(onDownload))}` : url;
}

function workerCount(kind) {
  const cores = navigator.hardwareConcurrency || 2;
  let n = Math.min(ENGINES[kind].workers, cores - 1);
  // Each full engine holds its own copy of the network, so go easy on small devices.
  if (kind === 'full' && navigator.deviceMemory) n = Math.min(n, Math.floor(navigator.deviceMemory / 2));
  return Math.max(1, n);
}

export class EnginePool {
  constructor(kind = 'lite') {
    this.kind = kind;
    this.size = workerCount(kind);
    this.engines = [];
    this.stopped = false;
  }

  // jobs: [{ fen }] in game order. onResult(index, lines) is called as each
  // finishes; onDownload(loaded, total) while the full network downloads.
  async run(jobs, { depth = 16, movetime = 3000, multiPv = 2, onResult, onDownload = () => {} }) {
    const { hash } = ENGINES[this.kind];
    const url = await engineUrl(this.kind, onDownload);
    if (this.stopped) return;
    const queue = stretches(jobs.length);
    const worker = async () => {
      const engine = new Engine(url);
      this.engines.push(engine);
      await engine.init(multiPv, hash);
      while (!this.stopped && queue.length) {
        for (const i of queue.shift()) {
          if (this.stopped) return;
          onResult(i, await engine.analyse(jobs[i].fen, depth, movetime));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.size, queue.length) }, worker));
  }

  stop() {
    this.stopped = true;
    for (const e of this.engines) e.stop();
    this.engines = [];
  }
}

// One engine that plays moves, for simulating a game: Stockfish's own
// "Skill Level" (0 = weakest, 20 = full strength) and a time per move.
// Asks are queued, so one search finishes before the next starts.
export class MoveEngine {
  constructor(kind) {
    this.kind = kind;
    this.engine = null;
    this.ready = null;
    this.skill = null;
    this.queue = Promise.resolve();
  }

  start() {
    this.ready ??= (async () => {
      this.engine = new Engine(await engineUrl(this.kind));
      await this.engine.init(1, 32);
    })();
    return this.ready;
  }

  // Resolves with the move to play, as UCI ("e2e4"), or null if there is none.
  pick(fen, { skill = 20, movetime = 800 } = {}) {
    const run = async () => {
      await this.start();
      if (skill !== this.skill) {
        await this.engine.send([`setoption name Skill Level value ${skill}`, 'isready'], (l) => l === 'readyok');
        this.skill = skill;
      }
      const lines = await this.engine.send([`position fen ${fen}`, `go movetime ${movetime}`], (l) => l.startsWith('bestmove'));
      const best = lines[lines.length - 1].split(' ')[1];
      return best && best !== '(none)' ? best : null;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  stop() {
    if (this.engine) this.engine.stop();
    this.engine = null;
    this.ready = null;
  }
}

// One engine that follows the board: it searches whatever position is shown
// (top 3 lines, up to depth 24) and reports as it goes deeper. Asking for a
// new position stops the current search first; UCI answers a stop with
// "bestmove", and only then does the next search start.
export class LiveEngine {
  constructor(kind, onUpdate) {
    this.kind = kind;
    this.onUpdate = onUpdate; // (fen, lines) with lines like parseInfo's
    this.worker = null;
    this.ready = null;
    this.searching = null; // fen being searched
    this.want = null;      // fen to search next
    this.lines = [];
  }

  async start() {
    this.ready ??= (async () => {
      this.worker = new Worker(await engineUrl(this.kind));
      this.worker.onmessage = (e) => this.onLine(String(e.data));
      await new Promise((resolve) => {
        this.onReady = resolve;
        for (const c of ['uci', 'setoption name Hash value 64', 'setoption name MultiPV value 3', 'isready']) this.worker.postMessage(c);
      });
    })();
    return this.ready;
  }

  async show(fen) {
    this.want = fen;
    await this.start();
    if (this.want !== fen) return;
    if (this.searching) this.worker.postMessage('stop');
    else this.go();
  }

  go() {
    const fen = this.want;
    this.want = null;
    if (!fen) return;
    this.searching = fen;
    this.lines = [];
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage('go depth 24');
  }

  onLine(line) {
    if (line === 'readyok' && this.onReady) { this.onReady(); this.onReady = null; return; }
    if (line.startsWith('bestmove')) {
      this.searching = null;
      this.go();
      return;
    }
    if (!this.searching || this.want || !line.startsWith('info ') || !line.includes(' multipv ')) return;
    const [info] = parseInfo([line]);
    if (!info) return;
    const k = Number(line.split(' multipv ')[1].split(' ')[0]) - 1;
    this.lines[k] = info;
    this.onUpdate(this.searching, this.lines.filter(Boolean));
  }

  stop() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    this.searching = null;
    this.want = null;
  }
}
