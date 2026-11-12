// Builds public/openings.json from Lichess's opening list (CC0):
// https://github.com/lichess-org/chess-openings
// Each named line's final position becomes "<board side castling ep>": "<ECO>|<name>".
// The review page uses it to name the opening and to mark book moves.
// It also writes public/opening-lines.json: every named line as [ECO, name, "e4 c5 Nf3 …"]
// (SAN moves), which the opening trainer drills.
// Run with `node scripts/build-openings.mjs` (needs the internet).
import { writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const out = {};
const lines = [];

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const text = await fetch(`${BASE}${letter}.tsv`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${letter}.tsv`);
    return r.text();
  });
  for (const line of text.split('\n').slice(1)) {
    const [eco, name, pgn] = line.split('\t');
    if (!pgn) continue;
    const chess = new Chess();
    chess.loadPgn(pgn);
    out[chess.fen().split(' ').slice(0, 4).join(' ')] = `${eco}|${name}`;
    lines.push([eco, name, chess.history().join(' ')]);
  }
}

await writeFile(new URL('../public/openings.json', import.meta.url), JSON.stringify(out));
await writeFile(new URL('../public/opening-lines.json', import.meta.url), JSON.stringify(lines));
console.log(`Wrote ${Object.keys(out).length} openings and ${lines.length} lines.`);
