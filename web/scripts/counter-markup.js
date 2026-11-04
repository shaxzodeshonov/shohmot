// Markup the counter shares between the build (Counter.astro draws the demo's
// placeholder rows into the HTML) and the browser (app.js), so the rows drawn
// before the games arrive are the same shape as the ones drawn after.

export const PLATFORM = { chesscom: 'Chess.com', lichess: 'Lichess' };
export const BASE_SPEEDS = ['bullet', 'blitz', 'rapid', 'daily'];
export const ALL_SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'daily', 'other'];
export const SPEED_NAME = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', other: 'Other' };
const ICON = {
  bullet: 'M13 2 4 14h7l-1 8 9-12h-7z',
  blitz: 'M12 2c1 3.5-2.5 5-2.5 8.5 0 1.4.8 2.5 2 2.8-.3-1.6.6-3 2-4 .2 2.4 2.5 3.4 2.5 6 0 2.6-2.2 4.7-5 4.7S6 17.9 6 15c0-5.2 6-7.4 6-13z',
  rapid: 'M9 1h6v2H9zM12 5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm1 8.4V8h-2v6.5l4.3 2.5 1-1.7z',
  classical: 'M6 2h12v5l-4 5 4 5v5H6v-5l4-5-4-5z',
  daily: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5z',
  other: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (speed) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[speed]}" fill="currentColor" fill-rule="evenodd"/></svg>`;

export function cellLabel(speed, label) {
  return `<span class="cell-label" style="--c:var(--${speed})">${speed === 'total' ? '' : icon(speed)}${label}</span>`;
}

export function gridHeadHtml(speeds) {
  return `<span></span>${speeds.map((s) => `<span style="--c:var(--${s})">${icon(s)}${SPEED_NAME[s]}</span>`).join('')}<span class="total-h">Total</span>`;
}

// One row per account while its games load, with the same cells a full row has.
// An account with no username draws a nameless row (the counter's HTML has four
// of those, shown before app.js knows the accounts).
export function loadingRowsHtml(accounts, speeds = BASE_SPEEDS, cls = '') {
  const cell = (speed, label) => `<div class="cell zero${speed === 'total' ? ' total' : ''}">${cellLabel(speed, label)}<span class="played">–</span><span class="lost">counting…</span><span class="mini"></span>${speed === 'total' ? '' : '<span class="rt">&nbsp;</span>'}</div>`;
  return accounts.map((a) => `<div class="row loading${cls ? ` ${cls}` : ''}" style="--cols:${speeds.length}"><div class="who"><span class="avatar" aria-hidden="true">${esc((a.username[0] || '').toUpperCase())}</span><div class="who-text"><span class="who-name">${a.username ? esc(a.username) : '&nbsp;'}</span><span class="who-meta">${a.platform ? `<span class="site">${PLATFORM[a.platform]}</span>, loading…` : 'Loading…'}</span></div></div>${speeds.map((s) => cell(s, SPEED_NAME[s])).join('')}${cell('total', 'Total')}</div>`).join('');
}
