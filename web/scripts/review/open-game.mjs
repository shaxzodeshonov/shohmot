// Where a game opens in the review, from whatever the visitor has: a game in
// their recent list, a Lichess link, a PGN (pasted or from a file). Shared by
// the review page's paste box and the review pop-up (review-picker.js), so
// both accept the same things and say the same things when they can't.

const REVIEW = '/review.html';

// A game from a Chess.com or Lichess account (the list the pop-up shows).
// guest keeps it out of this browser's training: it may be someone else's game.
export function accountGameUrl(platform, username, game) {
  const qs = new URLSearchParams({ p: platform, u: username, id: game.id, t: String(game.end), guest: '1' });
  return `${REVIEW}?${qs}`;
}

// lichess.org/abcdEFGH, /abcdEFGHxyzw (a player's link), /abcdEFGH/black
const LICHESS = /lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(white|black))?/;

// The first game of a PGN that may hold several (a downloaded file often does).
export function firstGame(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  const events = [...t.matchAll(/^\[Event /gm)];
  return events.length > 1 ? t.slice(0, events[1].index).trim() : t;
}

// text: a Lichess link or a PGN; side: '', 'w' or 'b' (who you played).
// Resolves to { url } or { error, chesscom? } (chesscom: it was a Chess.com
// link, which can't be opened directly; the username or a PGN works instead).
export async function reviewUrlFor(text, side = '') {
  const t = String(text || '').trim();
  if (!t) return { error: 'Paste a Lichess link or a PGN first.' };
  const li = LICHESS.exec(t);
  if (li && t.length < 200) {
    const qs = new URLSearchParams({ p: 'lichess', id: li[1] });
    const s = side || (li[2] === 'black' ? 'b' : li[2] === 'white' ? 'w' : '');
    if (s) qs.set('side', s);
    return { url: `${REVIEW}?${qs}` };
  }
  if (/chess\.com\//i.test(t) && t.length < 200) {
    return { chesscom: true, error: 'Chess.com links can’t be opened directly. Find the game by your Chess.com username, or open it on Chess.com, press Share, choose PGN and paste that here.' };
  }
  const pgn = firstGame(t);
  try {
    const { Chess } = await import('chess.js');
    const chess = new Chess();
    chess.loadPgn(pgn);
    if (!chess.history().length) throw new Error('no moves');
  } catch {
    return { error: 'That isn’t a game Shohmot can read. Paste a Lichess link, or a PGN of a standard chess game.' };
  }
  const hash = new URLSearchParams({ pgn });
  if (side) hash.set('side', side);
  return { url: `${REVIEW}#${hash}` };
}

// Goes there. A pasted game only changes the #hash, which doesn't reload the
// review page by itself when you're already on it: then the address is
// changed in place and the page reloaded, as one navigation.
export function go(url) {
  if (location.pathname === REVIEW && url.startsWith(`${REVIEW}#`)) {
    history.replaceState(null, '', url);
    location.reload();
  } else {
    location.href = url;
  }
}
