// The review pop-up (components/ReviewPicker.astro): pick a game to review
// from your recent games, a Lichess link or PGN, or a .pgn file.
import { accountGameUrl, reviewUrlFor, firstGame, go } from './review/open-game.mjs';
import { track } from './track.js';

const dialog = document.getElementById('rp');
if (dialog) {
  const $ = (s) => dialog.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LAST = 'shohmot-review-user';
  const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;
  const SPEED = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', other: 'Other' };
  const RESULT = { win: 'Won', loss: 'Lost', draw: 'Draw' };
  const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ---------- tabs ----------
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  function show(name, focus = true) {
    for (const t of tabs) {
      const on = t.id === `rp-tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (!focus) return;
    const first = { user: '#rp-name', paste: '#rp-text', file: '#rp-file-input' }[name];
    $(first).focus();
  }
  for (const t of tabs) t.addEventListener('click', () => show(t.id.replace('rp-tab-', '')));
  // Arrow keys move between tabs (the usual tabs pattern).
  dialog.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    show(tabs[next].id.replace('rp-tab-', ''), false);
    tabs[next].focus();
  });
  dialog.addEventListener('click', (e) => {
    const to = e.target.closest('[data-rp-tab]');
    if (to) show(to.dataset.rpTab);
    if (e.target === dialog) dialog.close(); // a click on the backdrop
  });
  $('#rp-close').addEventListener('click', () => dialog.close());

  // ---------- open ----------
  function open(tab = 'user') {
    try {
      const last = JSON.parse(localStorage.getItem(LAST));
      if (last && !$('#rp-name').value) { $('#rp-site').value = last.site; $('#rp-name').value = last.name; }
    } catch { /* nothing saved */ }
    if (!dialog.open) dialog.showModal();
    show(tab);
    track('review_picker');
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-review-picker]');
    // A new tab or window (Ctrl/⌘-click, middle click) still opens the review page.
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(a.dataset.reviewPicker || 'user');
  });

  // ---------- your username: pick from your recent games ----------
  const status = $('#rp-user-status');
  const list = $('#rp-games');
  const more = $('#rp-more');
  let shownFor = '';
  function say(text, kind = '') { status.textContent = text; status.dataset.kind = kind; }

  async function find(days) {
    const site = $('#rp-site').value;
    const name = $('#rp-name').value.trim();
    if (!USERNAME.test(name)) { say('Usernames are 2–30 letters, numbers, - or _.', 'bad'); $('#rp-name').focus(); return; }
    try { localStorage.setItem(LAST, JSON.stringify({ site, name })); } catch { /* private mode */ }
    say(days > 30 ? 'Looking further back…' : 'Finding your games…');
    more.hidden = true;
    const btn = $('#rp-user .rp-go');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/state?accounts=${encodeURIComponent(`${site}:${name}`)}&days=${days}`);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Couldn’t reach Shohmot. Try again in a moment.');
      const acct = (out.accounts || [])[0];
      if (!acct || (acct.error && !acct.games.length)) throw new Error((acct && acct.error) || 'No games found.');
      const games = acct.games.slice().sort((a, b) => b.end - a.end).slice(0, 50);
      shownFor = `${site}:${name}`;
      if (!games.length) {
        list.hidden = true;
        say(`No games in the last ${days} days on ${acct.username || name}.`);
      } else {
        const user = acct.username || name;
        list.innerHTML = games.map((g) => {
          const ok = g.variant === 'chess' || g.variant === 'standard';
          const inner = `<span class="rp-res ${g.result}">${RESULT[g.result] || ''}</span>
            <span class="rp-opp"><b>vs ${esc(g.opponent)}${g.oppRating ? ` (${g.oppRating})` : ''}</b><small>${SPEED[g.speed] || ''}${g.rated ? '' : ', casual'}${ok ? '' : ', variant: can’t be reviewed'}</small></span>
            <span class="rp-when">${esc(when.format(g.end))}</span>`;
          return ok ? `<li><a href="${esc(accountGameUrl(site, user, g))}">${inner}</a></li>` : `<li><span class="rp-off">${inner}</span></li>`;
        }).join('');
        list.hidden = false;
        say(`${games.length === 50 ? 'Your 50 latest games' : `${games.length} game${games.length === 1 ? '' : 's'}`} on ${user}. Pick one to review.`);
      }
      more.hidden = days >= 180;
      more.dataset.days = days >= 30 ? '180' : '30';
    } catch (err) {
      list.hidden = true;
      say(err.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  }
  $('#rp-user').addEventListener('submit', (e) => { e.preventDefault(); find(30); });
  more.addEventListener('click', () => find(Number(more.dataset.days) || 180));
  // A different name or site: the list shown is no longer for it.
  for (const el of [$('#rp-name'), $('#rp-site')]) {
    el.addEventListener('input', () => {
      if (shownFor && shownFor !== `${$('#rp-site').value}:${$('#rp-name').value.trim()}`) { list.hidden = true; more.hidden = true; say(''); shownFor = ''; }
    });
  }

  // ---------- a Lichess link or a PGN ----------
  async function openText(text, side, errEl) {
    errEl.hidden = true;
    const out = await reviewUrlFor(text, side);
    if (out.url) return go(out.url);
    errEl.textContent = out.error;
    errEl.hidden = false;
  }
  $('#rp-paste').addEventListener('submit', (e) => {
    e.preventDefault();
    openText($('#rp-text').value, $('#rp-side').value, $('#rp-paste-error'));
  });

  // ---------- a .pgn file ----------
  const MAX_FILE = 5 * 1024 * 1024;
  async function openFile(file) {
    const err = $('#rp-file-error');
    err.hidden = true;
    if (!file) return;
    if (file.size > MAX_FILE) { err.textContent = 'That file is too big for one game. Pick a .pgn file under 5 MB.'; err.hidden = false; return; }
    let text = '';
    try { text = await file.text(); } catch { /* unreadable */ }
    if (!/\d\s*\.\s*[a-hKQRBNO]/.test(text)) { err.textContent = 'That doesn’t look like a PGN file. It should have moves like “1. e4 e5”.'; err.hidden = false; return; }
    openText(firstGame(text), '', err);
  }
  $('#rp-file-input').addEventListener('change', (e) => openFile(e.target.files[0]));
  const drop = $('#rp-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); });
}
