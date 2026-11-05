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
- **The counter opens complete, in one step.** After each sync it keeps a small copy in the browser (`shohmot-counter:v1`: today's and yesterday's games, one game per type for the rating change, and a total per day for the calendar). The next visit draws the whole page from it, card and calendar included; the main area waits for that (at most 0.6 s, set by the inline head script) rather than showing a skeleton that changes shape. Sign-out clears it.
- **Syncs ask only for what's new.** Each minute the counter fetches the last two days (or since its last answer) and merges them in; the full 26 weeks are fetched at most twice a day, or when an older day is opened. Parts of the page are only redrawn when their markup changed.
- **Nothing jumps on a first visit either.** The HTML has placeholder rows (as many as last visit's accounts) and the demo's banner and rows; `web/scripts/counter-markup.js` draws them both at build time and in the browser, so they match.
- **Background work stays in the background.** The quick mistake check of new games uses one or two Stockfish workers, waits until the page has settled and is on screen, and loads chess.js only then.
- **Below-the-fold sections cost nothing until needed** (`content-visibility: auto` on the landing page's features).
- **The service worker uses navigation preload**, so having one never slows a page down.
- `server.js` compresses text with brotli or gzip, as Vercel does, so local measurements match production.

Accessibility: every page passes axe-core's WCAG 2.2 AA and best-practice rules, desktop and mobile, and fits a 320px-wide screen without sideways scrolling. Text colours are at least 4.5:1 on every background (keep new colours to that), each page has a "Skip to content" link to `#main`, and anything that scrolls sideways is focusable so keyboards can scroll it.

## Deploy to Vercel

Vercel runs `astro build` and serves `dist/`, and the files in `api/` run as functions (see `vercel.json`). Import the GitHub repo in Vercel, or run `npx vercel --prod` from this folder.

Accounts need a database, because Vercel functions don't keep files:

1. Make a free Redis database at [console.upstash.com](https://console.upstash.com).
2. Copy its REST URL and token into the Vercel project's environment variables, as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Redeploy.

`src/store.js` also finds Vercel's `KV_REST_API_*` names, with or without a prefix. `/api/health` says what it found or what's missing. Without a database, sign-up says so and points to `/demo.html`: the counter on well-known players' public games, which needs no database.

A ready-made admin login: set `ADMIN_EMAILS` and `ADMIN_PASSWORD`, and the first sign-in with them creates the account. Or run `npm run seed -- email "Name" 'password' [lichess:user]` against any store.

## Plans

Everything is **free for everyone** until Stripe is set up (`STRIPE_SECRET_KEY` and `STRIPE_PRICE_PRO`). While billing is off:

- every account gets every feature, with no daily limits and the full 26 weeks;
- anyone can coach;
- the site shows no plans, prices or Upgrade buttons.

Setting the Stripe env vars switches the plans on without a code change (`src/plans.js`: `hasPro`, `canCoach`). See `LAUNCH.md` for going live, and `.env.example` for every setting.

## Pages

- `/` is the landing page: a hero, a section for each feature and a footer. Each feature also has its own page at `/features/<name>.html`, generated from `web/data/features.ts`. Every feature can be tried from its section: `account: false` features (game counter via the live demo, game review, analysis board, set up & play, play yourself) open straight away; `account: true` ones (training, brilliant moves) send signed-out visitors to sign up and then on to the feature.
- The **review pop-up** (`web/components/ReviewPicker.astro`) opens from any link with `data-review-picker` on the public pages and the review page: pick a game from your recent Chess.com or Lichess games by username, paste a Lichess link or a PGN, or open a `.pgn` file (the first game is reviewed). Without JavaScript those links go to `/review.html`.
- `/review.html`, **no account needed**: paste a Lichess link or any PGN for a full review, then share it as an image (`web/scripts/review/share.mjs`) or copy its link. Pasted games never leave the browser. `/analysis.html` is open to everyone too.
- **Fil, the coach** (`web/scripts/review/coach.mjs`), sits at the top of the review: a bot whose face follows the move (happy, wow, hmm, worried, thinking), the move's label and better move, and a lesson for each kind of mistake (from `explain()` in `label.mjs`). Its voice is off until you turn it on (the speaker button, or V): the browser's own speech, a calm voice where the device has one, a little slower and quieter, with moves read as words ("knight takes f7, check"). Nothing is sent anywhere.
- `/privacy.html`, `/terms.html`, `/licenses.html`: the legal pages. Who runs the service and the governing law come from `PUBLIC_*` env vars (`web/data/site.ts`). `/sitemap.xml` and `/robots.txt` are generated at build time.
- Account pages:
  - `/train.html` (Training), `/brilliants.html` and `/settings.html`.
  - `/coach.html`: an invite link and each student's week, with every game a click away from a review.
  - `/join.html?code=…`: where a student accepts a coach.
  - `/admin.html`, for emails in `ADMIN_EMAILS`: visitors, sign-ups, the funnel, and which features get used.
- `/forgot.html`, `/reset.html` and `/verify.html`: password reset and email confirmation. The tokens travel in the link's `#hash`.
- `/signup.html` and `/login.html`: create an account (your name, email, password) or sign in. Both send you on to the page you were going to.
- `/app.html` is the main page, the game counter. It, `review.html` and `analysis.html` need you to be signed in (`web/layouts/Base.astro` sends you to sign in otherwise). Old `/?accounts=…` links go to `/app.html?accounts=…`.

## Accounts and security

Built on Node's own `crypto`, no packages (`src/auth.js`):

- Passwords are hashed with **scrypt** (N=2^15, r=8, p=3, OWASP's settings) and a random salt, compared in constant time. At least 8 characters; a few very common ones are refused. Signing in with an unknown email still runs scrypt, so timing doesn't reveal which emails have accounts.
- **Email** (`src/mail.js`) is sent by the first of these that's set up:
  1. Resend (`RESEND_API_KEY`), once you have a domain;
  2. Gmail (`GMAIL_USER` and `GMAIL_APP_PASSWORD`), which needs no domain;
  3. any SMTP server (`SMTP_*`).

  `/api/health` says which one is in use.
- **Breached passwords** are refused at sign-up. [Have I Been Pwned](https://haveibeenpwned.com/API/v3#PwnedPasswords)'s range API only ever sees the first 5 characters of the password's SHA-1, never the password; if it can't be reached within 3 seconds, sign-up goes ahead.
- A session is a random 32-byte token in an **HttpOnly, SameSite=Lax** cookie (Secure on Vercel), valid 30 days. The store keeps only the token's SHA-256. Signing out deletes it, and signing in deletes the session the browser had before.
- **CSRF**: POSTs must be `application/json` (which a form on another site can't send) and, when the browser sends an Origin, it must be this site.
- **Rate limits**: 10 sign-ups an hour per IP; 30 sign-in attempts per 15 minutes per IP; 10 wrong passwords lock an email for 15 minutes. Look-ups that reach Chess.com or Lichess are limited per IP too (60 username checks and 60 games per 10 minutes, 30 "Sync now"s, after which syncs use the cache), so one visitor can't get the server blocked by them.
- **Headers** (`vercel.json`, which `server.js` also reads): a Content-Security-Policy that only runs this site's own scripts (the one inline script is allowed by its hash) and only lets pages talk to this site, Lichess (cloud evals) and unpkg (the Stockfish network); HSTS; `X-Frame-Options: DENY` and `frame-ancestors 'none'`; `nosniff`; a strict Referrer-Policy; a Permissions-Policy that turns off camera, microphone, location and payments; and `Cross-Origin-Opener-Policy: same-origin`. `npm run build` runs `scripts/check-csp.mjs`, which fails the build if an inline script's hash is missing from the policy.
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

What the review shows:

- **Accuracy** for both players, on the scale of the site the game was played on. Lichess games use Lichess's published formula exactly ([lila](https://github.com/lichess-org/lila): `AccuracyPercent.scala`); on 12 games Lichess had analysed, it came within about 3 points of Lichess's number on average. Chess.com's formula is private, so Chess.com games use the same formula with constants fitted to 26 games that Chess.com had also reviewed: on games left out of the fit it misses Chess.com's number by 4–5 points on average, down from about 8 (`ACCURACY` in `web/scripts/review/analysis.mjs`). The fit used players rated 100–1200, so it may drift for much stronger players.
- **The site's own accuracy**, under ours, when the game was reviewed on Chess.com or analysed on Lichess.
- **Game rating**: a rough "you played like ____" from accuracy. Chess.com's formula is private, so this is a hand fit.
- **Move labels**: Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Miss, Blunder. They use expected-points thresholds (0.02 / 0.05 / 0.10 / 0.20), plus: Brilliant is a sound sacrifice of 2+ pawns' worth, Great is the only good move, Miss is failing to punish an opponent's mistake.
- **Best move arrow** and the engine's line for every move that wasn't best, a short reason ("It loses a knight", "It allows mate in 2"), the **eval bar** and the **eval graph** (click to jump).
- **Opening name** and book moves, from Lichess's [chess-openings](https://github.com/lichess-org/chess-openings) list (CC0). Rebuild `public/openings.json` with `node scripts/build-openings.mjs`.
- Accuracy **by phase** (opening, middlegame, endgame) and a list of your key moments.
- **Analysis board.** Drag a piece or click it and then its square (dots show the legal moves, a picker handles promotion) to try your own moves. Anything other than the game's next move starts **your line**, shown under the game move it replaces; step through it with ← →, click it to jump in, "Back to the game" to leave and × to remove it. Once the review is done, a **live engine** follows the board and shows its top 3 lines and the best move as a blue arrow; click a move in a line to play the line up to it. The Engine switch turns it off.
- **Move sounds**: a wooden tock for a move, a brighter clack for a capture, two tocks for castling, a ping for check and promotion and a chime on mate. No sound files are copied from any chess site; these are built in the browser, sample by sample, from a click of noise and the decaying tones a wooden piece rings at (`web/scripts/review/sound.mjs`). The speaker button (or M) mutes them.
- **Analysis board** button: opens the game on the analysis board at the move shown.
- Keys: ← → Home End, N for your next mistake, F to flip, M for sound, Esc to drop a picked piece.

## Play yourself

`/play-yourself.html` needs no account, only a username:

1. Shohmot reads up to 400 of the player's recent games through `/api/moves`: 30 days, or 90 for players who don't play much.
2. It builds a profile (`web/scripts/double/profile.mjs`):
   - **an opening book of their own moves:** in each position of the first 12 moves where it was their turn, what they played and how often;
   - **their rating** in their main time control;
   - **how they play:** captures, checks, castling (how often, which side, by what move), early queen trades and game length, turned into an aggression score and a few labels ("Attacker", "Safe king", "Loyal to 1.e4"…).
3. The double (`choose.mjs`) picks its moves like this:
   - in a book position, one of their own moves, at their frequency;
   - otherwise, one of Stockfish lite's top 4 moves, chosen with a spread that grows as the rating drops, a lean toward forcing or quiet moves to match their aggression, and an occasional clear slip at the rate players of that level make one. It never misses a mate in one or two.
4. After a game, **Review this game** opens it in the full review, and **Challenge a friend** shares a link that builds the same double (`?u=lichess:name`).

## Mistakes and training

**After every game.** While the counter is open, each new game gets a quick check (`web/scripts/training/analyze.mjs`):

- Stockfish lite analyses every position in this tab, at depth 12 and at most 0.7 s a position, losses first. A game takes a few seconds.
- Moves are labelled by the same code as the full review (`web/scripts/review/label.mjs`).
- If you made mistakes, a card appears on the counter: "You lost to X. Here's what to work on." It lists up to three of your worst moves, each with what went wrong ("It allows mate in 1", "It leaves a piece to be taken") and the better move. Its buttons are **Train these positions**, **Full review** and **Dismiss**.
- Games with mistakes get an "N to train" badge in the game list.
- The same check also finds brilliant moves.

**Training** (`/train.html`). Each mistake, miss or blunder you made becomes a position to solve: find the better move. The engine's choice counts, and so does any move nearly as good.

- **Scheduling** (spaced repetition, `web/scripts/training/store.mjs`): solve a position on the first try and it comes back after 1, 3, 7 and 21 days, then it's learned. Miss it, or need a hint or a second try, and it comes back in 10 minutes.
- **"What to work on"** counts your mistakes by kind (left a piece hanging, allowed a mate, missed a mate, lost material, missed a chance, let the position slip) and by game phase, with a tip for the most common kind.
- **"Check older games"** goes back through your losses.
- **Free vs Pro:** free accounts train 5 positions a day and check losses from the last 7 days. Pro has no daily limit and checks 26 weeks.
- **Overrides:** a full review overrides the quick check for its game, but keeps your training progress.
- **Storage:** everything is kept in the browser (`shohmot-training:v1`).

## Brilliant moves

**How a move becomes Brilliant** (`isBrilliant` in `web/scripts/review/analysis.mjs`), following Chess.com's published description, since its exact formula is private:

- It's a **piece sacrifice** (`web/scripts/review/sacrifice.mjs`): right after the move, the opponent can win a knight, bishop, rook or queen, net of anything the move captured (2+ pawns' worth, so the exchange counts and pawn grabs don't). It's worked out with a static exchange on legal first captures, so a piece left hanging counts even when taking it would lose, which is the classic brilliant move that a check of the engine's line alone misses.
- It's the **best move, or nearly**.
- You're **not worse** afterwards.
- You **weren't winning anyway**: the best other move must not have been crushing already.
- Book moves and forced moves never count.
- It's **more generous at lower ratings**, read from the PGN's WhiteElo/BlackElo. The thresholds are in `BRILLIANT`, one row per rating band.

**Every game on your accounts** (`/brilliants.html`, scan in `web/scripts/brilliants/scan.mjs`). Checking every move with Stockfish would take hours, so:

1. `GET /api/moves` returns the moves of each game, a window at a time (a month on Chess.com, a week on Lichess).
2. chess.js replays every game and keeps your moves that sacrifice a piece. This takes a few milliseconds a game and usually finds none to three.
3. Stockfish lite (depth 14) looks only at those positions, before and after the move.
4. The results are kept in the browser (`shohmot-brilliants:v1`), so a game is never checked twice.

A full review of a game overwrites the scan's answer for that game, because it searches deeper. The counter checks today's new games on its own, shows "!! N brilliant", and marks those games in the list. Free accounts scan the last 7 days; Pro scans all 26 weeks.

**Tuning against Chess.com.** Chess.com's API returns accuracy but not move labels, so the thresholds can't be fitted automatically. To check them:

1. Collect games where Chess.com's Game Review showed a Brilliant, and some where it didn't.
2. Review those games here, and compare the moves each site marked.
3. Adjust `BRILLIANT`.

## Analysis board

`analysis.html` (the "Analysis board" button on the main page) is a free board for playing out any position:

- A fresh board opens on a **start menu**: a box to paste a PGN or FEN and Load, then **Set Up Position**, **New Analysis**, **Play Stockfish** and **Game Review**. The first move made on the board opens the analysis.
- **Set Up Position** (also the "Set up position" button on the main page, and Set Up under the board) turns the board into an editor: pick a piece from the rows above and below the board and click or drag across squares to place it (clicking a square that already has it empties it, the bin removes pieces), drag pieces around, or off the board to remove them, right-click to empty a square, or drag straight from the rows. Choose who moves and the castling rights (only the ones the king and rook allow), paste or copy the FEN, or start from the starting position or an empty board. It says what is wrong with an illegal position (no king, pawns on the back rank, the side not to move in check). **Analyze** opens the position with Stockfish's best move as an arrow and its top 3 lines.

- Move pieces by dragging or clicking. Going back and playing something else keeps both: the new move becomes a **variation**, shown indented under the move it replaces, nested as deep as you like (past three levels, in brackets). Right-click a move to make its line the main line or delete it.
- A **live Stockfish** (full or lite, from the bar) follows the board: its top 3 lines (click a move to play the line up to it), the best move as a blue arrow and the eval bar.
- **Play** (Play Stockfish) lets Stockfish play on from the position on the board. Pick who plays each side (You or Stockfish): Stockfish against itself to watch the game unfold (Slow, Normal or Fast), or against you, with your pieces at the bottom, its lines, arrow and eval bar hidden so they don't give moves away, and a Take back button. Six strengths, Beginner to Maximum (Stockfish's Skill Level). The moves go into the move tree like any others. Start / Pause (or Space); stepping through the moves pauses it.
- The opening name, a red glow on a king in check, and the result when the game is over.
- Under the board: **New** (back to the start menu with a new board), **Set Up**, **Play** and **⋯** with **Load PGN / FEN** (PGN with variations, comments and annotations, or a FEN), **Copy PGN** (with variations) and **Copy FEN**.
- The analysis is kept in the browser, so it's still there after a reload. A link like `analysis.html#pgn=<PGN>&ply=<n>` opens a game at a move; the review page uses it.
- Keys: ← → step, ↑ / Home to the start, ↓ / End to the end of the line, Space starts or pauses a simulation, F flip, M sound, Esc drops a picked piece.

`/api/game` fetches the game's PGN and the site's own accuracy numbers: Lichess's export-by-ids API (the single-game export asks for a login on some games), or the Chess.com monthly archive the game ended in.

Third-party files in `public/`: `vendor/stockfish-19-single.js` and `vendor/stockfish-19-lite-single.*` ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPLv3), `pieces/` (Colin M.L. Burnett's pieces, GPLv2+ as distributed by Lichess). [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 (BSD-2-Clause) comes from npm.

```bash
npm test
```
