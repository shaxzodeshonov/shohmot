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

```bash
npm test
```
