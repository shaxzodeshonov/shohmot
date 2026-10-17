# Shohmot

How many games you've played on Chess.com and Lichess, per account, synced live.

```bash
npm start
```

Then open http://localhost:3001. No `npm install` needed; it uses only Node (20+).

- The page shows one day at a time, today by default: for each account, how many bullet, blitz, rapid and daily games you played and how many you lost. Use the arrows (or ← →), or click a day in the 26-week calendar, to see earlier days.
- On first run it pulls your full history from both sites. After that it checks for new games every 60 seconds and pushes them straight to the open page.
- Accounts start as Chess.com `shaxzod_e`, Chess.com `kindofinterestedinchess` and Lichess `shaxzod_e`. Add or remove them with the Accounts button.
- Games are cached in `data/store.json`. Delete it to resync from scratch.
- Change the sync interval with `SYNC_SECONDS=30 npm start`, and the port with `PORT`.

Counts include rated and casual games. Aborted Lichess games are left out, which matches Lichess's own total.

```bash
npm test
```
