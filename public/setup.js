// The account setup form: how many accounts, which site each one is on, and
// the username. Each username is looked up as you type, so you can see right
// away whether Shohmot found you. Used on the welcome screen and in "Edit accounts".
(() => {
  'use strict';

  const SITES = { chesscom: 'Chess.com', lichess: 'Lichess' };
  const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  const lookups = new Map(); // "site:username" -> Promise of { ok, username, avatar, error }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lookup(site, username) {
    const key = `${site}:${username.toLowerCase()}`;
    if (!lookups.has(key)) {
      const p = fetch(`/api/check?platform=${site}&username=${encodeURIComponent(username)}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (res.ok) return { ok: true, username: body.username, avatar: body.avatar };
          if (res.status >= 500) lookups.delete(key); // try again next time
          return { ok: false, error: body.error || 'Could not check this username.' };
        })
        .catch(() => {
          lookups.delete(key);
          return { ok: false, error: 'Can’t reach Shohmot right now. Check your connection.' };
        });
      lookups.set(key, p);
    }
    return lookups.get(key);
  }

  window.mountSetup = function mountSetup(container, { accounts = [], submitLabel, onDone, max = 4 }) {
    const blank = (site) => ({ site, username: '', status: 'empty', found: null, error: '', seq: 0, timer: null });
    let rows = accounts.length
      ? accounts.slice(0, max).map((a) => ({ ...blank(a.platform), username: a.username, status: 'ok', found: { username: a.username, avatar: a.avatar || null } }))
      : [blank('chesscom')];

    container.innerHTML = `
      <form class="setup-form" novalidate>
        <fieldset class="count">
          <legend>How many accounts do you play on?</legend>
          <div class="count-pick">
            ${Array.from({ length: max }, (_, i) => `<button type="button" data-count="${i + 1}" aria-pressed="false">${i + 1}</button>`).join('')}
          </div>
        </fieldset>
        <ol class="setup-rows"></ol>
        <p class="setup-error" role="alert"></p>
        <div class="setup-foot">
          <button type="submit" class="btn-big">${esc(submitLabel)}</button>
          <p class="setup-note">Saved in this browser only. You can change it any time.</p>
        </div>
      </form>`;
    const form = container.querySelector('form');
    const list = container.querySelector('.setup-rows');
    const formError = container.querySelector('.setup-error');

    // A new row starts on whichever site has fewer accounts so far.
    function nextSite() {
      const cc = rows.filter((r) => r.site === 'chesscom').length;
      return cc > rows.length - cc ? 'lichess' : 'chesscom';
    }

    function statusHtml(r) {
      const site = SITES[r.site];
      switch (r.status) {
        case 'checking':
          return `<span class="spin" aria-hidden="true"></span>Looking for <b>${esc(r.username)}</b> on ${site}…`;
        case 'ok': {
          const av = r.found.avatar
            ? `<img src="${esc(r.found.avatar)}" alt="" referrerpolicy="no-referrer">`
            : esc(r.found.username[0].toUpperCase());
          return `<span class="found-av" aria-hidden="true">${av}</span><span>Found <b>${esc(r.found.username)}</b> on ${site}</span><svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        }
        case 'error':
          return `<span class="bad">${esc(r.error)}</span>`;
        default:
          return `<span class="hint">Type the name you use on ${site}.</span>`;
      }
    }

    function renderRows() {
      for (const b of container.querySelectorAll('[data-count]')) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.count) === rows.length));
      }
      list.innerHTML = rows.map((r, i) => `
        <li class="acct-row" data-i="${i}" data-status="${r.status}">
          <div class="row-top">
            <span class="row-num">Account ${i + 1}</span>
            <div class="site-pick" role="group" aria-label="Site for account ${i + 1}">
              ${Object.entries(SITES).map(([k, name]) => `<button type="button" data-site="${k}" aria-pressed="${r.site === k}">${name}</button>`).join('')}
            </div>
            ${rows.length > 1 ? `<button type="button" class="row-remove" aria-label="Remove account ${i + 1}">Remove</button>` : ''}
          </div>
          <label class="name-field">
            <span class="sr-only">Username on ${SITES[r.site]}</span>
            <input type="text" value="${esc(r.username)}" placeholder="Your ${SITES[r.site]} username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30" aria-describedby="row-status-${i}">
          </label>
          <p class="row-status" id="row-status-${i}" aria-live="polite">${statusHtml(r)}</p>
        </li>`).join('');
    }

    function paintStatus(i) {
      const li = list.querySelector(`[data-i="${i}"]`);
      if (!li) return;
      li.dataset.status = rows[i].status;
      li.querySelector('.row-status').innerHTML = statusHtml(rows[i]);
    }

    function isDuplicate(i) {
      const r = rows[i];
      return rows.some((o, j) => j < i && o.site === r.site && o.username.trim().toLowerCase() === r.username.trim().toLowerCase());
    }

    // Validate one row and look the name up. Resolves when the row has settled.
    async function check(i) {
      const r = rows[i];
      const name = r.username.trim();
      clearTimeout(r.timer);
      const seq = ++r.seq;
      if (!name) { r.status = 'empty'; r.found = null; paintStatus(i); return; }
      if (!USERNAME_RE.test(name)) {
        r.status = 'error';
        r.error = name.length < 2 ? 'That’s too short for a username.' : 'Usernames only use letters, numbers, - and _.';
        paintStatus(i);
        return;
      }
      if (isDuplicate(i)) { r.status = 'error'; r.error = 'You already added this account above.'; paintStatus(i); return; }
      r.status = 'checking';
      paintStatus(i);
      const result = await lookup(r.site, name);
      if (seq !== r.seq) return; // the user kept typing
      if (result.ok) { r.status = 'ok'; r.found = result; } else { r.status = 'error'; r.error = result.error; r.found = null; }
      paintStatus(i);
    }

    container.querySelector('.count-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-count]');
      if (!b) return;
      const n = Number(b.dataset.count);
      while (rows.length < n) rows.push(blank(nextSite()));
      rows = rows.slice(0, n);
      formError.textContent = '';
      renderRows();
      // Put the cursor in the first box that still needs a name.
      const firstEmpty = Math.max(0, rows.findIndex((r) => !r.username.trim()));
      list.querySelector(`[data-i="${firstEmpty}"] input`).focus();
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('.acct-row');
      if (!li) return;
      const i = Number(li.dataset.i);
      const siteBtn = e.target.closest('[data-site]');
      if (siteBtn && rows[i].site !== siteBtn.dataset.site) {
        rows[i].site = siteBtn.dataset.site;
        renderRows();
        check(i);
        list.querySelector(`[data-i="${i}"] input`).focus();
      }
      if (e.target.closest('.row-remove')) {
        rows.splice(i, 1);
        renderRows();
        rows.forEach((_, j) => check(j));
      }
    });

    list.addEventListener('input', (e) => {
      const li = e.target.closest('.acct-row');
      if (!li) return;
      const i = Number(li.dataset.i);
      rows[i].username = e.target.value;
      formError.textContent = '';
      clearTimeout(rows[i].timer);
      rows[i].timer = setTimeout(() => check(i), 450);
      if (rows[i].status !== 'empty') { rows[i].status = 'empty'; paintStatus(i); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formError.textContent = '';
      const filled = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.username.trim());
      if (!filled.length) {
        formError.textContent = 'Type at least one username to continue.';
        list.querySelector('input').focus();
        return;
      }
      const btn = form.querySelector('.btn-big');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      await Promise.all(filled.filter(({ r }) => r.status !== 'ok').map(({ i }) => check(i)));
      btn.disabled = false;
      btn.textContent = submitLabel;
      const bad = filled.find(({ r }) => r.status !== 'ok');
      if (bad) {
        formError.textContent = `Account ${bad.i + 1} needs a fix before you continue.`;
        list.querySelector(`[data-i="${bad.i}"] input`).focus();
        return;
      }
      onDone(filled.map(({ r }) => ({ platform: r.site, username: r.found.username, avatar: r.found.avatar || null })));
    });

    renderRows();
    return { focus: () => list.querySelector('input').focus() };
  };
})();
