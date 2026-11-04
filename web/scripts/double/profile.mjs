// A player's chess style, from their own games: the openings they play (as a
// book of their moves, position by position, with how often), and how they
// play (rating, captures, checks, castling, queen trades, game length). Pure
// apart from chess.js, so Node can test it (test/double.test.mjs).
//
// buildProfile(games, { username, platform, openings }) ->
//   { username, platform, games, rating, speed, book, stats, traits, style, firsts }
//   games: [{ color: 'w'|'b', moves: 'e4 e5 …', fen?, rating, speed, result, end }]
//   openings: Lichess's chess-openings list ({ epd: 'ECO|Name' }), optional
import { Chess } from 'chess.js';

const BOOK_PLIES = 24;          // the first 12 moves each
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const pct = (a, b) => (b ? a / b : 0);

export function buildProfile(games, { username = '', platform = '', openings = {} } = {}) {
  const book = {};               // epd -> { san: count } (only positions where it was their move)
  const firsts = { w: {}, b: {} }; // White's first move; Black's reply to 1.e4 / 1.d4
  const named = { w: {}, b: {} };  // opening names reached, by colour
  const speeds = {};
  let moves = 0, captures = 0, checks = 0, plies = 0;
  let castled = 0, castleK = 0, castleQ = 0, castleMoveSum = 0;
  let queenTrades = 0, wins = 0, losses = 0, draws = 0, counted = 0;
  const ratings = [];

  for (const g of games) {
    let chess;
    try { chess = new Chess(g.fen || undefined); } catch { continue; }
    const sans = String(g.moves || '').split(' ').filter(Boolean);
    if (!sans.length) continue;
    counted++;
    speeds[g.speed] = (speeds[g.speed] || 0) + 1;
    if (g.rating) ratings.push({ r: g.rating, speed: g.speed, end: g.end || 0 });
    if (g.result === 'win') wins++; else if (g.result === 'loss') losses++; else if (g.result === 'draw') draws++;
    let didCastle = false;
    let opening = null;
    for (let i = 0; i < sans.length; i++) {
      const mine = chess.turn() === g.color;
      const before = chess.fen();
      let m;
      try { m = chess.move(sans[i]); } catch { break; }
      if (!m) break;
      plies++;
      if (!g.fen && i < 30) { const hit = openings[epd(chess.fen())]; if (hit) opening = hit; }
      if (!mine) continue;
      moves++;
      if (m.captured) captures++;
      if (m.san.includes('+') || m.san.includes('#')) checks++;
      if (!didCastle && (m.flags.includes('k') || m.flags.includes('q'))) {
        didCastle = true;
        castled++;
        if (m.flags.includes('k')) castleK++; else castleQ++;
        castleMoveSum += Math.ceil((i + 1) / 2);
      }
      if (!g.fen && i < BOOK_PLIES) {
        const k = epd(before);
        const row = book[k] || (book[k] = {});
        row[m.san] = (row[m.san] || 0) + 1;
      }
      if (!g.fen && i === 0 && g.color === 'w') firsts.w[m.san] = (firsts.w[m.san] || 0) + 1;
      if (!g.fen && i === 1 && g.color === 'b') {
        const key = `${sans[0]} ${m.san}`;
        firsts.b[key] = (firsts.b[key] || 0) + 1;
      }
    }
    // Queens off within the first 20 moves each.
    const early = new Chess(g.fen || undefined);
    for (let i = 0; i < Math.min(40, sans.length); i++) { try { early.move(sans[i]); } catch { break; } }
    const queens = early.board().flat().filter((sq) => sq && sq.type === 'q').length;
    if (queens === 0) queenTrades++;
    if (opening) {
      const name = opening.split('|')[1].split(':')[0];
      named[g.color][name] = (named[g.color][name] || 0) + 1;
    }
  }

  // The rating to play at: their latest rating in the time control they play most.
  const speed = Object.entries(speeds).sort((a, b) => b[1] - a[1])[0]?.[0] || 'blitz';
  const inSpeed = ratings.filter((r) => r.speed === speed).sort((a, b) => b.end - a.end);
  const recent = inSpeed.slice(0, 20);
  const rating = recent.length ? Math.round(recent.reduce((s, r) => s + r.r, 0) / recent.length) : 1200;

  const stats = {
    captureRate: pct(captures, moves),
    checkRate: pct(checks, moves),
    castleRate: pct(castled, counted),
    castleKingside: pct(castleK, castled || 1),
    castleQueenside: pct(castleQ, castled || 1),
    castleMove: castled ? castleMoveSum / castled : null,
    queenTradeRate: pct(queenTrades, counted),
    avgMoves: counted ? plies / counted / 2 : 0,
    winRate: pct(wins, counted),
    lossRate: pct(losses, counted),
    drawRate: pct(draws, counted),
    speeds,
  };
  // Aggression, 0 to 1: how much more they capture and check than a typical
  // player (about 22% captures and 6% checks of their moves).
  const aggression = Math.max(0, Math.min(1, 0.5 + (stats.captureRate - 0.22) * 2.2 + (stats.checkRate - 0.06) * 4));

  const traits = [];
  if (aggression >= 0.65) traits.push({ id: 'attacker', name: 'Attacker', text: 'You capture and give check more than most players.' });
  else if (aggression <= 0.35) traits.push({ id: 'quiet', name: 'Quiet player', text: 'You build up rather than go for captures and checks.' });
  if (stats.castleRate >= 0.85 && stats.castleMove && stats.castleMove <= 9) traits.push({ id: 'safe-king', name: 'Safe king', text: `You castle in ${Math.round(stats.castleRate * 100)}% of games, around move ${Math.round(stats.castleMove)}.` });
  if (counted >= 5 && stats.castleRate < 0.6) traits.push({ id: 'king-walker', name: 'Brave king', text: `You leave your king in the centre in ${Math.round((1 - stats.castleRate) * 100)}% of games.` });
  if (stats.queenTradeRate >= 0.35) traits.push({ id: 'trader', name: 'Queen trader', text: `The queens come off by move 20 in ${Math.round(stats.queenTradeRate * 100)}% of your games.` });
  if (stats.castleQueenside >= 0.3 && castled >= 3) traits.push({ id: 'long-castle', name: 'Castles long', text: `${Math.round(stats.castleQueenside * 100)}% of your castling is queenside.` });
  const topWhite = Object.entries(firsts.w).sort((a, b) => b[1] - a[1])[0];
  const whiteGames = Object.values(firsts.w).reduce((s, n) => s + n, 0);
  if (topWhite && whiteGames >= 5 && topWhite[1] / whiteGames >= 0.8) traits.push({ id: 'loyal', name: 'Loyal to 1.' + topWhite[0], text: `You open 1.${topWhite[0]} in ${Math.round((topWhite[1] / whiteGames) * 100)}% of your White games.` });
  if (counted >= 5 && stats.avgMoves <= 28) traits.push({ id: 'quick', name: 'Quick finisher', text: `Your games last ${Math.round(stats.avgMoves)} moves on average.` });
  if (counted >= 5 && stats.avgMoves >= 48) traits.push({ id: 'grinder', name: 'Grinder', text: `Your games last ${Math.round(stats.avgMoves)} moves on average: you play it out.` });

  const style = aggression >= 0.65 ? 'Attacking' : aggression <= 0.35 ? 'Positional' : 'Balanced';
  const top = (o, n = 3) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, n: v }));

  return {
    username, platform, games: counted, rating, speed, book, stats, aggression, traits, style,
    firsts: { white: top(firsts.w), black: top(firsts.b) },
    openings: { white: top(named.w), black: top(named.b) },
    builtAt: Date.now(),
  };
}

// How many of their games reached this position with them to move, and what they played.
export function bookAt(profile, fen) {
  const row = profile.book[epd(fen)];
  if (!row) return null;
  const total = Object.values(row).reduce((s, n) => s + n, 0);
  return { total, moves: Object.entries(row).sort((a, b) => b[1] - a[1]).map(([san, n]) => ({ san, n })) };
}
