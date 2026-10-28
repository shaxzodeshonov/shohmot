# Shohmot

Today's chess games on your Chess.com and Lichess accounts: how many bullet, blitz, rapid and daily games you played on each account, and how many you lost. It refreshes every minute.

## Run it on your computer

```bash
npm start
```

Then open http://localhost:3001. No `npm install` needed; it uses only Node (20+).

## Deploy to Vercel

The repo is ready for Vercel as is: `public/` is served as the site and `api/state.js` (games) and `api/check.js` (username lookup) run as functions. Import the GitHub repo in Vercel, or run `npx vercel --prod` from this folder.

## How it works

- The page shows one day at a time, today by default. Use the arrows (or ← →), or click a day in the 26-week calendar, to see earlier days.
- Every 60 seconds the page asks `/api/state` for the last 26 weeks of games. Responses are cached for a minute, so Chess.com and Lichess are asked at most once a minute.
- New visitors get a pop-up over the (dimmed) page: a username, a Chess.com / Lichess dropdown and an add button. The name is checked as they type. "Add another account" at the bottom first asks whether to save or discard what's typed, then clears the card for the next one. Up to 4 accounts, saved in the visitor's browser; the Accounts button reopens it to add or remove.
- A link like `/?accounts=chesscom:name,lichess:name` opens straight onto those accounts.
- The first load asks for just the last two days so today's numbers appear quickly, then fills in the 26-week calendar.
- Counts include rated and casual games unless "Rated games only" is ticked. Aborted Lichess games are left out.

## Game review

Every standard-chess game in the list has a **Review** button. It opens `review.html`, which analyses the game in the visitor's own browser, so the server does no engine work. Results are kept in the browser, so a game opens instantly the second time.

How the evaluations are made, most accurate first:

1. **Lichess cloud evaluations.** Positions Lichess has already searched deeply (often depth 40–60) come from its [cloud-eval API](https://lichess.org/api#tag/Analysis). That covers most openings; the page stops asking after three misses in a row.
2. **Stockfish 19, full network** (default on desktop): the same engine strength as desktop Stockfish, as WebAssembly, on up to 3 cores. Its 99 MB `.wasm` is loaded from the [stockfish npm package on unpkg](https://unpkg.com/stockfish@19.0.1/bin/) and cached by the browser; the small `.js` loader is in `public/vendor`. **Lite** (a 2 MB network, up to 4 cores) is faster but weaker, and is the default on phones.
3. **Backward analysis.** The game is split into 8-position stretches and each engine works through its stretch from the last position back to the first, keeping its hash. So when a move is judged, the engine has already seen the position it led to, and both sides of the comparison come from the same search knowledge.

Depth runs from Quick (12) to Deep (22); Strong (18) is the default.

What the review shows, modelled on Chess.com's Game Review:

- **Accuracy** for both players, on the scale of the site the game was played on. Lichess games use Lichess's published formula exactly ([lila](https://github.com/lichess-org/lila): `AccuracyPercent.scala`); on 12 games Lichess had analysed, it came within about 3 points of Lichess's number on average. Chess.com's formula is private, so Chess.com games use the same formula with constants fitted to 26 games that Chess.com had also reviewed: on games left out of the fit it misses Chess.com's number by 4–5 points on average, down from about 8 (`ACCURACY` in `public/review/analysis.mjs`). The fit used players rated 100–1200, so it may drift for much stronger players.
- **The site's own accuracy**, under ours, when the game was reviewed on Chess.com or analysed on Lichess.
- **Game rating**: a rough "you played like ____" from accuracy. Chess.com's formula is private, so this is a hand fit.
- **Move labels**: Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Miss, Blunder. They use Chess.com's expected-points thresholds (0.02 / 0.05 / 0.10 / 0.20), plus: Brilliant is a sound sacrifice of 2+ pawns' worth, Great is the only good move, Miss is failing to punish an opponent's mistake.
- **Best move arrow** and the engine's line for every move that wasn't best, a short reason ("It loses a knight", "It allows mate in 2"), the **eval bar** and the **eval graph** (click to jump).
- **Opening name** and book moves, from Lichess's [chess-openings](https://github.com/lichess-org/chess-openings) list (CC0). Rebuild `public/openings.json` with `node scripts/build-openings.mjs`.
- Accuracy **by phase** (opening, middlegame, endgame) and a list of your key moments. Keys: ← → Home End, N for your next mistake, F to flip.

`/api/game` fetches the game's PGN and the site's own accuracy numbers: Lichess's export-by-ids API (the single-game export asks for a login on some games), or the Chess.com monthly archive the game ended in.

Third-party files in `public/`: `vendor/stockfish-19-single.js` and `vendor/stockfish-19-lite-single.*` ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPLv3), `vendor/chess.mjs` ([chess.js](https://github.com/jhlywa/chess.js) 1.4.0, BSD-2-Clause), `pieces/` (Colin M.L. Burnett's pieces, GPLv2+ as distributed by Lichess).

```bash
npm test
```
