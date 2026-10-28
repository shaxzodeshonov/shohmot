// Builds public/openings.json from Lichess's opening list (CC0):
// https://github.com/lichess-org/chess-openings
// Each named line's final position becomes "<board side castling ep>": "<ECO>|<name>".
// The review page uses it to name the opening and to mark book moves.
// Run with `node scripts/build-openings.mjs` (needs the internet).
import { writeFile } from 'node:fs/promises';
import { Chess } from '../public/vendor/chess.mjs';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const out = {};

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
  }
}

await writeFile(new URL('../public/openings.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} openings.`);
