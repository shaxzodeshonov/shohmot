# Shohmot

Today's chess games on your Chess.com and Lichess accounts: how many bullet, blitz, rapid and daily games you played on each account, and how many you lost. It refreshes every minute.

## Run it on your computer

```bash
npm start
```

Then open http://localhost:3001. No `npm install` needed; it uses only Node (20+).

## Deploy to Vercel

The repo is ready for Vercel as is: `public/` is served as the site and `api/state.js` / `api/check.js` run as functions. Import the GitHub repo in Vercel, or run `npx vercel --prod` from this folder.

## How it works

- The page shows one day at a time, today by default. Use the arrows (or ← →), or click a day in the 26-week calendar, to see earlier days.
- Every 60 seconds the page asks `/api/state` for the last 26 weeks of games. Responses are cached for a minute, so Chess.com and Lichess are asked at most once a minute.
- Accounts start as Chess.com `shaxzod_e`, Chess.com `kindofinterestedinchess` and Lichess `shaxzod_e`. Add or remove them with the Accounts button; the list is saved in your browser.
- Counts include rated and casual games unless "Rated games only" is ticked. Aborted Lichess games are left out.

```bash
npm test
```
