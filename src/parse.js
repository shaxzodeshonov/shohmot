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

module.exports = { normSpeed, parseChesscomGame, parseLichessGame, parseNdjson, archiveMonthEnd };
