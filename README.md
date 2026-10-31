# Shohmot

Today's chess games on your Chess.com and Lichess accounts: how many bullet, blitz, rapid and daily games you played on each account, and how many you lost. It refreshes every minute.

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://localhost:4321. `npm run dev` is Astro's dev server with live reload; it also answers `/api/*` with the same handlers Vercel runs. `npm start` builds the site into `dist/` and serves it with the API at http://localhost:3001, the way it runs in production. Needs Node 22.23+. Accounts are kept in `data/store.json` (gitignored).

## Stack

- **[Astro](https://astro.build)** builds the site (`web/`): pages in `web/pages`, shared layouts and components in `web/layouts` and `web/components`, feature-page copy in `web/data/features.ts` (the four feature pages are generated from it). Vite bundles, minifies and hashes the scripts and styles into `dist/_astro/`, which is cached forever.
- **Plain Node functions** for the API (`api/`, code in `src/`), no framework.
- **Upstash Redis** (on Vercel) or a JSON file (locally) for accounts.
- Static files that must keep their names (Stockfish, pieces, openings) stay in `public/`.

What makes it quick:

- **No wait to see if you're signed in.** Sign-in sets a readable `shohmot_in=1` cookie next to the HttpOnly session; a tiny inline script reads it before the first paint, so signed-out visitors are sent to sign in at once and public pages show the right buttons without a flash. The app draws straight from your last profile (kept in the browser) while `/api/me` confirms it in the background.
- **Instant clicks.** Links are prefetched on hover, and in Chromium the page is prerendered (Speculation Rules), so it opens immediately. Links to the review and analysis pages are left out, so Stockfish never starts in the background.
- **Smooth page changes.** Pages cross-fade with cross-document View Transitions and the top bar stays still.
- **Less to load.** The font is self-hosted and preloaded (no Google Fonts round trip); the landing page's boards and calendars are drawn at build time, so they cost no JavaScript; the public pages ship about 1 KB of script.
- Motion is subtle and switched off for people who ask for reduced motion.

## Deploy to Vercel

Vercel runs `astro build` and serves `dist/`, and the files in `api/` run as functions (see `vercel.json`). Import the GitHub repo in Vercel, or run `npx vercel --prod` from this folder.

Accounts need a database, because Vercel functions don't keep files. In the Vercel project, open **Storage → Create → Upstash for Redis** (free tier is plenty) and connect it to the project: that sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`), which `src/store.js` reads. Redeploy. Without it, sign-up answers "Accounts aren't set up on this server yet".

## Pages

- `/` is the landing page: a hero, a section for each feature and a footer. Each feature also has its own page at `/features/<name>.html`, generated from `web/data/features.ts` (game counter, game review, analysis board, set up & play).
- `/signup.html` and `/login.html`: create an account (your name, email, password) or sign in. Both send you on to the page you were going to.
- `/app.html` is the main page, the game counter. It, `review.html` and `analysis.html` need you to be signed in (`web/layouts/Base.astro` sends you to sign in otherwise). Old `/?accounts=…` links go to `/app.html?accounts=…`.

## Accounts and security

Built on Node's own `crypto`, no packages (`src/auth.js`):

- Passwords are hashed with **scrypt** (N=2^15, r=8, p=3, OWASP's settings) and a random salt, compared in constant time. At least 8 characters; a few very common ones are refused. Signing in with an unknown email still runs scrypt, so timing doesn't reveal which emails have accounts.
- A session is a random 32-byte token in an **HttpOnly, SameSite=Lax** cookie (Secure on Vercel), valid 30 days. The store keeps only the token's SHA-256, and signing out deletes it.
- **CSRF**: POSTs must be `application/json` (which a form on another site can't send) and, when the browser sends an Origin, it must be this site.
- **Rate limits**: 10 sign-ups an hour per IP; 30 sign-in attempts per 15 minutes per IP; 10 wrong passwords lock an email for 15 minutes.
- Your chess accounts are saved on your Shohmot account (`POST /api/me`), so they follow you to any device. Accounts saved in the browser before sign-in existed move over the first time you sign in.

API: `POST /api/register` `{ name, email, password }`, `POST /api/login` `{ email, password }`, `POST /api/logout`, `GET /api/me`, `POST /api/me` `{ name?, accounts? }`.

## How it works

- The page shows one day at a time, today by default. Use the arrows (or ← →), or click a day in the 26-week calendar, to see earlier days.
- Every 60 seconds the page asks `/api/state` for the last 26 weeks of games. Responses are cached for a minute, so Chess.com and Lichess are asked at most once a minute.
- New accounts get a pop-up over the (dimmed) page: a username, a Chess.com / Lichess dropdown and an add button. The name is checked as they type. "Add another account" at the bottom first asks whether to save or discard what's typed, then clears the card for the next one. Up to 4 accounts, saved on your Shohmot account; the Accounts button reopens it to add or remove.
- A link like `/app.html?accounts=chesscom:name,lichess:name` opens straight onto those accounts.
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

- **Accuracy** for both players, on the scale of the site the game was played on. Lichess games use Lichess's published formula exactly ([lila](https://github.com/lichess-org/lila): `AccuracyPercent.scala`); on 12 games Lichess had analysed, it came within about 3 points of Lichess's number on average. Chess.com's formula is private, so Chess.com games use the same formula with constants fitted to 26 games that Chess.com had also reviewed: on games left out of the fit it misses Chess.com's number by 4–5 points on average, down from about 8 (`ACCURACY` in `web/scripts/review/analysis.mjs`). The fit used players rated 100–1200, so it may drift for much stronger players.
- **The site's own accuracy**, under ours, when the game was reviewed on Chess.com or analysed on Lichess.
- **Game rating**: a rough "you played like ____" from accuracy. Chess.com's formula is private, so this is a hand fit.
- **Move labels**: Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Miss, Blunder. They use Chess.com's expected-points thresholds (0.02 / 0.05 / 0.10 / 0.20), plus: Brilliant is a sound sacrifice of 2+ pawns' worth, Great is the only good move, Miss is failing to punish an opponent's mistake.
- **Best move arrow** and the engine's line for every move that wasn't best, a short reason ("It loses a knight", "It allows mate in 2"), the **eval bar** and the **eval graph** (click to jump).
- **Opening name** and book moves, from Lichess's [chess-openings](https://github.com/lichess-org/chess-openings) list (CC0). Rebuild `public/openings.json` with `node scripts/build-openings.mjs`.
- Accuracy **by phase** (opening, middlegame, endgame) and a list of your key moments.
- **Analysis board.** Drag a piece or click it and then its square (dots show the legal moves, a picker handles promotion) to try your own moves. Anything other than the game's next move starts **your line**, shown under the game move it replaces; step through it with ← →, click it to jump in, "Back to the game" to leave and × to remove it. Once the review is done, a **live engine** follows the board and shows its top 3 lines and the best move as a blue arrow; click a move in a line to play the line up to it. The Engine switch turns it off.
- **Move sounds** in the style of Chess.com's: a wooden tock for a move, a brighter clack for a capture, two tocks for castling, a ping for check and promotion and a chime on mate. Chess.com's sound files are theirs (and Lichess's standard set isn't free either), so these are built in the browser, sample by sample, from a click of noise and the decaying tones a wooden piece rings at (`web/scripts/review/sound.mjs`). The speaker button (or M) mutes them.
- **Analysis board** button: opens the game on the analysis board at the move shown.
- Keys: ← → Home End, N for your next mistake, F to flip, M for sound, Esc to drop a picked piece.

## Analysis board

`analysis.html` (the "Analysis board" button on the main page) is a free board for playing out any position, laid out like Chess.com's analysis board:

- A fresh board opens on a **start menu**, as on Chess.com: a box to paste a PGN or FEN and Load, then **Set Up Position**, **New Analysis**, **Play Stockfish** and **Game Review**. The first move made on the board opens the analysis.
- **Set Up Position** (also the "Set up position" button on the main page, and Set Up under the board) turns the board into an editor: pick a piece from the rows above and below the board and click or drag across squares to place it (clicking a square that already has it empties it, the bin removes pieces), drag pieces around, or off the board to remove them, right-click to empty a square, or drag straight from the rows. Choose who moves and the castling rights (only the ones the king and rook allow), paste or copy the FEN, or start from the starting position or an empty board. It says what is wrong with an illegal position (no king, pawns on the back rank, the side not to move in check). **Analyze** opens the position with Stockfish's best move as an arrow and its top 3 lines.

- Move pieces by dragging or clicking. Going back and playing something else keeps both: the new move becomes a **variation**, shown indented under the move it replaces, nested as deep as you like (past three levels, in brackets). Right-click a move to make its line the main line or delete it.
- A **live Stockfish** (full or lite, from the bar) follows the board: its top 3 lines (click a move to play the line up to it), the best move as a blue arrow and the eval bar.
- **Play** (Play Stockfish) lets Stockfish play on from the position on the board. Pick who plays each side (You or Stockfish): Stockfish against itself to watch the game unfold (Slow, Normal or Fast), or against you, with your pieces at the bottom, its lines, arrow and eval bar hidden so they don't give moves away, and a Take back button. Six strengths, Beginner to Maximum (Stockfish's Skill Level). The moves go into the move tree like any others. Start / Pause (or Space); stepping through the moves pauses it.
- The opening name, a red glow on a king in check, and the result when the game is over.
- Under the board, as on Chess.com: **New** (back to the start menu with a new board), **Set Up**, **Play** and **⋯** with **Load PGN / FEN** (PGN with variations, comments and annotations, or a FEN), **Copy PGN** (with variations) and **Copy FEN**.
- The analysis is kept in the browser, so it's still there after a reload. A link like `analysis.html#pgn=<PGN>&ply=<n>` opens a game at a move; the review page uses it.
- Keys: ← → step, ↑ / Home to the start, ↓ / End to the end of the line, Space starts or pauses a simulation, F flip, M sound, Esc drops a picked piece.

`/api/game` fetches the game's PGN and the site's own accuracy numbers: Lichess's export-by-ids API (the single-game export asks for a login on some games), or the Chess.com monthly archive the game ended in.

Third-party files in `public/`: `vendor/stockfish-19-single.js` and `vendor/stockfish-19-lite-single.*` ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPLv3), `pieces/` (Colin M.L. Burnett's pieces, GPLv2+ as distributed by Lichess). [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 (BSD-2-Clause) comes from npm.

```bash
npm test
```
