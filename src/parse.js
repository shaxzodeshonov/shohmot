// Turns raw Chess.com / Lichess game objects into one compact shape:
// { id, end, speed, rated, variant, result, color, rating, opponent, oppRating, url }

const CHESSCOM_DRAWS = new Set([
  'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient',
]);

// Lichess statuses that never became a real game.
const LICHESS_SKIP = new Set(['aborted', 'noStart', 'created', 'started']);

function normSpeed(speed) {
  switch (speed) {
    case 'ultraBullet':
    case 'bullet':
      return 'bullet';
    case 'blitz':
      return 'blitz';
    case 'rapid':
      return 'rapid';
    case 'classical':
      return 'classical';
    case 'daily':
    case 'correspondence':
      return 'daily';
    default:
      return 'other';
  }
}

function parseChesscomGame(g, username) {
  const me = username.toLowerCase();
  const white = g.white || {};
  const black = g.black || {};
  let color;
  if ((white.username || '').toLowerCase() === me) color = 'white';
  else if ((black.username || '').toLowerCase() === me) color = 'black';
  else return null;

  const side = color === 'white' ? white : black;
  const opp = color === 'white' ? black : white;
  const result = side.result === 'win' ? 'win' : CHESSCOM_DRAWS.has(side.result) ? 'draw' : 'loss';

  return {
    id: g.uuid || g.url,
    end: (g.end_time || 0) * 1000,
    speed: normSpeed(g.time_class),
    rated: !!g.rated,
    variant: g.rules || 'chess',
    result,
    color,
    rating: side.rating ?? null,
    opponent: opp.username || 'Unknown',
    oppRating: opp.rating ?? null,
    url: g.url,
  };
}

function parseLichessGame(g, username) {
  if (LICHESS_SKIP.has(g.status)) return null;
  const me = username.toLowerCase();
  const white = (g.players && g.players.white) || {};
  const black = (g.players && g.players.black) || {};
  let color;
  if (white.user && white.user.id === me) color = 'white';
  else if (black.user && black.user.id === me) color = 'black';
  else return null;

  const side = color === 'white' ? white : black;
  const opp = color === 'white' ? black : white;
  const result = !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss';
  const opponent = opp.user ? opp.user.name : opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous';

  return {
    id: g.id,
    start: g.createdAt,
    end: g.lastMoveAt || g.createdAt,
    speed: normSpeed(g.speed),
    rated: !!g.rated,
    variant: g.variant || 'standard',
    result,
    color,
    rating: side.rating ?? null,
    ratingDiff: side.ratingDiff ?? null,
    opponent,
    oppRating: opp.rating ?? null,
    url: `https://lichess.org/${g.id}`,
  };
}

function parseNdjson(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // A truncated last line is possible if the stream was cut; skip it.
    }
  }
  return out;
}

// End of a Chess.com archive month, e.g. ".../games/2026/09" -> Oct 1 2026 UTC.
function archiveMonthEnd(url) {
  const m = /\/(\d{4})\/(\d{2})$/.exec(url);
  if (!m) return Infinity;
  return Date.UTC(Number(m[1]), Number(m[2]), 1);
}

// Start of a Chess.com archive month.
function archiveMonthStart(url) {
  const m = /\/(\d{4})\/(\d{2})$/.exec(url);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
}

// The moves of a PGN as plain SAN separated by spaces, without headers,
// comments ({[%clk 0:02:59]}), move numbers, NAGs or the result. Plus the
// starting position when the game didn't start from the usual one.
function pgnMoves(pgn) {
  const text = String(pgn || '');
  const fen = /\[SetUp "1"\]/.test(text) ? (/\[FEN "([^"]+)"\]/.exec(text) || [])[1] || null : null;
  const body = text.replace(/^\s*\[[^\]]*\]\s*$/gm, '');
  const moves = body
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  return { moves: moves.join(' '), fen };
}

// The compact game the brilliant-move scan needs:
// { id, end, color: 'w'|'b', rating, speed, opponent, moves, fen? }
function movesOfChesscom(g, username) {
  const base = parseChesscomGame(g, username);
  if (!base || base.variant !== 'chess' || !g.pgn) return null;
  const { moves, fen } = pgnMoves(g.pgn);
  if (!moves) return null;
  return { id: base.id, end: base.end, color: base.color[0], rating: base.rating, speed: base.speed, opponent: base.opponent, moves, ...(fen ? { fen } : {}) };
}

function movesOfLichess(g, username) {
  const base = parseLichessGame(g, username);
  if (!base || !['standard', 'fromPosition'].includes(g.variant) || !g.moves) return null;
  if (g.variant === 'fromPosition' && !g.initialFen) return null;
  return { id: base.id, end: base.end, color: base.color[0], rating: base.rating, speed: base.speed, opponent: base.opponent, moves: g.moves, ...(g.initialFen ? { fen: g.initialFen } : {}) };
}

module.exports = { normSpeed, parseChesscomGame, parseLichessGame, parseNdjson, archiveMonthEnd, archiveMonthStart, pgnMoves, movesOfChesscom, movesOfLichess };
