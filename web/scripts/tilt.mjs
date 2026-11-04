// The tilt guard: what to tell a player about today's games. Pure (no DOM),
// so test/tilt.test.mjs can check it.
//
// tiltAlerts(games, prefs, { pro, now }) -> [{ key, kind, title, text, upsell? }]
//   games  every game on every account ({ id, end, result })
//   prefs  { lossStreak, dailyLimit } from the account's settings
// Each alert has a key that changes when there's something new to say, so a
// dismissed alert stays dismissed until then.
const HOUR = 3600000;

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function lossStreak(games) {
  let n = 0;
  for (let i = games.length - 1; i >= 0 && games[i].result === 'loss'; i--) n++;
  return n;
}

export function tiltAlerts(all, prefs = {}, { pro = false, now = Date.now() } = {}) {
  const from = startOfDay(now);
  const today = all.filter((g) => g.end >= from && g.end <= now).sort((a, b) => a.end - b.end);
  const out = [];
  if (!today.length) return out;
  const last = today[today.length - 1];
  const recent = now - last.end < 2 * HOUR; // still at the board

  const streak = lossStreak(today);
  if (prefs.lossStreak > 0 && streak >= prefs.lossStreak && recent) {
    out.push({
      key: `streak:${last.id}`,
      kind: 'warn',
      title: `${streak} losses in a row.`,
      text: 'Losing streaks tend to keep going while you’re tilted. A 10-minute break, a walk or a puzzle usually does more for your rating than the next game.',
    });
  }

  if (pro && prefs.dailyLimit > 0 && today.length >= prefs.dailyLimit) {
    out.push({
      key: `limit:${dayKey(now)}`,
      kind: 'warn',
      title: today.length === prefs.dailyLimit ? `That’s your ${prefs.dailyLimit} games for today.` : `${today.length} games today, past your limit of ${prefs.dailyLimit}.`,
      text: 'You set this limit to protect your rating. Tomorrow’s games will go better for the rest.',
    });
  } else if (!pro && today.length >= 20 && recent) {
    out.push({
      key: `upsell:${dayKey(now)}`,
      kind: 'info',
      upsell: true,
      title: `${today.length} games today.`,
      text: 'With Pro, Shohmot can stop you at a daily limit you choose, send a desktop notification, and show you after which game your results start to slide.',
    });
  }
  return out;
}
