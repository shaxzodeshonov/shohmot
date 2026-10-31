// The math behind a game review: engine score -> win chance, move labels,
// accuracy, an estimated game rating and game phases. No chess rules or DOM
// here, so Node can test it (test/analysis.test.mjs).
//
// Win chance and accuracy follow Lichess's published formulas
// (lila: WinPercent.scala, AccuracyPercent.scala). Chess.com's accuracy
// formula is private, so for Chess.com games the same formula runs with
// constants fitted to Chess.com's own numbers (see ACCURACY). Move labels
// follow Chess.com's "expected points" thresholds from their Game Review help pages.

export const LABELS = {
  brilliant: { name: 'Brilliant', mark: '!!' },
  great: { name: 'Great', mark: '!' },
  best: { name: 'Best', mark: '★' },
  excellent: { name: 'Excellent', mark: '✦' },
  good: { name: 'Good', mark: '✓' },
  book: { name: 'Book', mark: '≡' },
  forced: { name: 'Forced', mark: '→' },
  inaccuracy: { name: 'Inaccuracy', mark: '?!' },
  mistake: { name: 'Mistake', mark: '?' },
  miss: { name: 'Miss', mark: '✕' },
  blunder: { name: 'Blunder', mark: '??' },
};
export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Accuracy constants per site.
//   k: how fast the win chance curve rises with the score (winPercent)
//   a: how hard one move's accuracy falls with the win chance it threw away
//   floor: lowest move accuracy the harmonic mean sees
//   mix: share of the volatility-weighted mean (the rest is the harmonic mean)
// lichess is lila's code exactly; on 12 of our Lichess games it came within
// about 3 points of Lichess's own numbers on average. chesscom was fitted to
// 26 of our games that Chess.com had also reviewed (players rated 100–1200):
// on games left out of the fit it misses Chess.com's number by 4–5 points on
// average, against 8 for the Lichess constants. Chess.com's flatter curve fits its beginner-friendly expected
// points: a big lead isn't treated as a sure win.
export const ACCURACY = {
  lichess: { k: 0.00368208, a: 0.04354415386753951, floor: 1, mix: 0.5 },
  chesscom: { k: 0.0013, a: 0.13, floor: 25, mix: 0.25 },
};
const LICHESS_K = ACCURACY.lichess.k;

// Chance of winning (0–100) for the side the score belongs to.
// score is { cp } in centipawns or { mate } in moves (negative: being mated).
export function winPercent(score, k = LICHESS_K) {
  if (score.mate != null) return score.mate > 0 ? 100 : 0;
  const cp = clamp(score.cp, -1000, 1000);
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

// How accurate one move was, from the mover's win chance before and after.
export function moveAccuracy(before, after, a = ACCURACY.lichess.a) {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-a * (before - after)) - 3.166924740191411;
  return clamp(raw + 1, 0, 100); // +1: Lichess's allowance for imperfect analysis
}

function stdDev(xs) {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

// Accuracy for both players. wins: White's win chance for every position
// (worked out with the same k as the constants), starting position first.
// Moves in sharp stretches of the game weigh more, and the harmonic mean
// keeps blunders from hiding behind many easy moves.
export function gameAccuracy(wins, whiteMovesFirst = true, { a, floor, mix } = ACCURACY.lichess) {
  const n = wins.length;
  if (n < 2) return { white: null, black: null };
  const size = clamp(Math.floor(n / 10), 2, 8);
  const windows = [];
  for (let i = 0; i < Math.min(size, n) - 2; i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= n; i++) windows.push(wins.slice(i, i + size));
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12));

  const sums = { white: { w: 0, wa: 0, inv: 0, n: 0 }, black: { w: 0, wa: 0, inv: 0, n: 0 } };
  for (let i = 0; i < n - 1; i++) {
    const white = (i % 2 === 0) === whiteMovesFirst;
    const before = white ? wins[i] : 100 - wins[i];
    const after = white ? wins[i + 1] : 100 - wins[i + 1];
    const acc = moveAccuracy(before, after, a);
    const s = sums[white ? 'white' : 'black'];
    s.w += weights[i];
    s.wa += weights[i] * acc;
    s.inv += 1 / Math.max(acc, floor);
    s.n++;
  }
  const mean = (s) => (s.n ? mix * (s.wa / s.w) + (1 - mix) * (s.n / s.inv) : null);
  return { white: mean(sums.white), black: mean(sums.black) };
}

// A move's label. All win chances are the mover's, 0–100.
//   before: win chance with the engine's best move
//   after: win chance after the move played
//   second: win chance with the engine's second choice (null if there is none)
//   isBest: the move played is the engine's choice (or ties with it)
//   legal: how many legal moves there were
//   book: the position after the move is a named opening line
//   sacrifice: the move gives up material (2+ pawns' worth) once the captures settle
//   recapture: the move takes back on the square the opponent just captured on
//   oppLabel: the label of the opponent's previous move
export function classify(m) {
  if (m.book) return 'book';
  if (m.legal === 1) return 'forced';
  const loss = Math.max(0, m.before - m.after) / 100;

  if (m.isBest) {
    // Brilliant: a good sacrifice, when you weren't already completely winning
    // and aren't worse after it.
    if (m.sacrifice && m.before < 95 && m.after >= 45) return 'brilliant';
    // Great: the only good move, the other choices were clearly worse.
    if (m.isBest && m.second != null && !m.recapture
      && (m.before - m.second) / 100 >= 0.15 && m.second < 90 && m.before > 10) return 'great';
    return 'best';
  }
  if (loss < 0.02) {
    if (m.sacrifice && m.before < 95 && m.after >= 45) return 'brilliant';
    return 'excellent';
  }
  if (loss < 0.05) return 'good';
  // Miss: the opponent just slipped and you didn't make them pay, without
  // going on to lose the position yourself.
  if (loss >= 0.1 && (m.oppLabel === 'mistake' || m.oppLabel === 'blunder') && m.before >= 60 && m.after >= 40) return 'miss';
  if (loss < 0.1) return 'inaccuracy';
  if (loss < 0.2) return 'mistake';
  return 'blunder';
}

// A rough "you played like a ____" number from accuracy. Chess.com's own
// formula is private; these points are a hand fit and only meant as a guide.
const RATING_POINTS = [
  [0, 100], [40, 250], [50, 400], [60, 700], [70, 1050], [75, 1300],
  [80, 1600], [85, 1900], [90, 2250], [95, 2650], [100, 3100],
];
export function gameRating(accuracy) {
  if (accuracy == null) return null;
  const a = clamp(accuracy, 0, 100);
  for (let i = 1; i < RATING_POINTS.length; i++) {
    const [x1, y1] = RATING_POINTS[i];
    if (a <= x1) {
      const [x0, y0] = RATING_POINTS[i - 1];
      return Math.round((y0 + ((a - x0) / (x1 - x0)) * (y1 - y0)) / 50) * 50;
    }
  }
  return 3100;
}

// Where the middlegame and endgame start, as ply numbers (moves played).
// pieces: queens, rooks, bishops and knights on the board after each ply,
// both sides together, starting position first. bookPlies: book moves played.
export function phases(pieces, bookPlies = 0) {
  const n = pieces.length;
  let endStart = n;
  for (let i = 0; i < n; i++) if (pieces[i] <= 6) { endStart = i; break; }
  let middleStart = endStart;
  for (let i = bookPlies; i < endStart; i++) {
    if (i >= 24 || pieces[i] <= 10) { middleStart = i; break; }
  }
  return { middleStart, endStart };
}
