// Lichess's cloud evaluations: positions that have already been searched very
// deeply (often depth 40–60) on Lichess. Where one exists it is far better
// than a few seconds of browser Stockfish, so we use it instead. They mostly
// cover the opening, so we stop asking once a few positions in a row miss.
// Lichess asks for one request at a time, and a 429 means back off.
const CLOUD_URL = 'https://lichess.org/api/cloud-eval';

// Cloud scores are from White's side; ours are from the side to move, like UCI.
export function cloudLines(data, fen) {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  return (data.pvs || []).map((pv) => ({
    depth: data.depth,
    score: pv.mate != null ? { mate: pv.mate * sign } : { cp: pv.cp * sign },
    pv: String(pv.moves || '').split(' ').filter(Boolean).slice(0, 10),
    cloud: true,
  }));
}

// fens: positions in game order. onResult(index, lines) for every hit.
export async function cloudEvals(fens, { multiPv = 2, minDepth = 20, maxMisses = 3, shouldStop = () => false, onResult }) {
  let misses = 0;
  for (let i = 0; i < fens.length && misses < maxMisses && !shouldStop(); i++) {
    let res;
    try {
      res = await fetch(`${CLOUD_URL}?${new URLSearchParams({ fen: fens[i], multiPv: String(multiPv) })}`);
    } catch {
      return; // offline or blocked: local Stockfish does it all
    }
    if (res.status === 429) return;
    const data = res.ok ? await res.json().catch(() => null) : null;
    const lines = data ? cloudLines(data, fens[i]) : [];
    if (!data || data.depth < minDepth || !lines.length) { misses++; continue; }
    misses = 0;
    onResult(i, lines);
  }
}
