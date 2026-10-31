// The account pop-up: a username, a site (Chess.com or Lichess) and an add
// button. The plus at the bottom adds another account; if something is
// typed but not added yet, it first asks whether to save or discard it.
(() => {
  'use strict';

  const SITES = { chesscom: 'Chess.com', lichess: 'Lichess' };
  const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  const lookups = new Map(); // "site:name" -> Promise of { ok, username, avatar, error }
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lookup(site, username) {
    const key = `${site}:${username.toLowerCase()}`;
    if (!lookups.has(key)) {
      const p = fetch(`/api/check?platform=${site}&username=${encodeURIComponent(username)}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (res.ok) return { ok: true, username: body.username, avatar: body.avatar };
          if (res.status >= 500) lookups.delete(key);
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

  // getAccounts() -> [{ platform, username }]; onChange(list) saves a new list.
  window.createAccountPopup = function createAccountPopup({ getAccounts, onChange, max = 4 }) {
    const dialog = $('#pop');
    const form = $('#pop-form');
    const input = $('#pop-user');
    const site = $('#pop-site');
    const status = $('#pop-status');
    const confirmBox = $('#pop-confirm');
    const plus = $('#pop-plus');
    const avatars = new Map();
    let seq = 0;
    let timer = null;

    const say = (html, kind = '') => { status.innerHTML = html; status.dataset.kind = kind; };
    const isDup = (name, pf) => getAccounts().some((a) => a.platform === pf && a.username.toLowerCase() === name.toLowerCase());

    function render() {
      const list = getAccounts();
      $('#pop-title').textContent = list.length ? 'Your accounts' : 'Add your chess account';
      $('#pop-saved').innerHTML = list.map((a, i) => {
        const av = avatars.get(`${a.platform}:${a.username.toLowerCase()}`);
        return `<li>
          <span class="saved-av" aria-hidden="true">${av ? `<img src="${esc(av)}" alt="" referrerpolicy="no-referrer">` : esc(a.username[0].toUpperCase())}</span>
          <span class="saved-name">${esc(a.username)}<small>${SITES[a.platform]}</small></span>
          <button type="button" class="saved-x" data-remove="${i}" aria-label="Remove ${esc(a.username)} on ${SITES[a.platform]}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          </button>
        </li>`;
      }).join('');
      const full = list.length >= max;
      $('#pop-row').hidden = full;
      plus.hidden = full;
      if (full) say(`That’s ${max} accounts, the most Shohmot can follow at once. Remove one to add another.`);
      $('#pop-close').hidden = !list.length;
    }

    function reset() {
      input.value = '';
      clearTimeout(timer);
      seq++;
      confirmBox.hidden = true;
      say('');
      // Suggest the site the visitor has used less so far.
      const cc = getAccounts().filter((a) => a.platform === 'chesscom').length;
      site.value = cc > getAccounts().length - cc ? 'lichess' : 'chesscom';
    }

    // Check the typed name. Returns the lookup result, or null if there's nothing valid to check.
    async function check() {
      const name = input.value.trim();
      const mine = ++seq;
      if (!name) { say(''); return null; }
      if (!USERNAME_RE.test(name)) {
        say(name.length < 2 ? 'That’s too short for a username.' : 'Usernames only use letters, numbers, - and _.', 'bad');
        return null;
      }
      if (isDup(name, site.value)) { say('You already added this account.', 'bad'); return null; }
      say(`<span class="spin" aria-hidden="true"></span><span>Looking for <b>${esc(name)}</b> on ${SITES[site.value]}…</span>`, 'busy');
      const result = await lookup(site.value, name);
      if (mine !== seq) return undefined; // something changed meanwhile
      if (result.ok) {
        avatars.set(`${site.value}:${result.username.toLowerCase()}`, result.avatar);
        const av = result.avatar ? `<img src="${esc(result.avatar)}" alt="" referrerpolicy="no-referrer">` : esc(result.username[0].toUpperCase());
        say(`<span class="saved-av" aria-hidden="true">${av}</span><span>Found <b>${esc(result.username)}</b> on ${SITES[site.value]}</span>`, 'ok');
      } else {
        say(esc(result.error), 'bad');
      }
      return result;
    }

    // Add whatever is typed. Returns true when it was saved.
    async function saveTyped() {
      const name = input.value.trim();
      if (!name) { say('Type a username first.', 'bad'); input.focus(); return false; }
      clearTimeout(timer);
      const btn = $('#pop-add');
      btn.disabled = true;
      const result = await check();
      btn.disabled = false;
      if (!result || !result.ok) { input.focus(); return false; }
      onChange([...getAccounts(), { platform: site.value, username: result.username }]);
      return true;
    }

    input.addEventListener('input', () => {
      confirmBox.hidden = true;
      clearTimeout(timer);
      seq++;
      say('');
      timer = setTimeout(check, 450);
    });
    site.addEventListener('change', () => { if (input.value.trim()) check(); });

    // The check button: add this account and show its games.
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim() && getAccounts().length) { dialog.close(); return; }
      if (await saveTyped()) { reset(); render(); dialog.close(); }
    });

    // The plus: start another account, after saving or discarding the typed one.
    plus.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) { say('Type the next username.'); input.focus(); return; }
      $('#pop-confirm-text').innerHTML = `Save <b>${esc(name)}</b> on ${SITES[site.value]} before adding another?`;
      confirmBox.hidden = false;
      confirmBox.querySelector('[data-act="save"]').focus();
    });
    confirmBox.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      confirmBox.hidden = true;
      if (act.dataset.act === 'save' && !(await saveTyped())) return;
      reset();
      render();
      if (act.dataset.act === 'save') say('Saved. Add the next one.', 'ok');
      input.focus();
    });

    $('#pop-saved').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const list = getAccounts().slice();
      list.splice(Number(b.dataset.remove), 1);
      onChange(list);
      render();
      if (!list.length) input.focus();
    });

    // It can only be closed once there's at least one account to show.
    $('#pop-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (e) => { if (!getAccounts().length) e.preventDefault(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog && getAccounts().length) dialog.close(); });

    return {
      open() {
        reset();
        render();
        dialog.showModal();
        input.focus();
      },
      remember(platform, username, avatar) {
        if (avatar) avatars.set(`${platform}:${username.toLowerCase()}`, avatar);
      },
    };
  };
})();
