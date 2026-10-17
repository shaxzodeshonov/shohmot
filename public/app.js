(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const PLATFORM = { chesscom: 'Chess.com', lichess: 'Lichess' };
  const BASE_SPEEDS = ['bullet', 'blitz', 'rapid', 'daily'];
  const ALL_SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'daily', 'other'];
  const SPEED_NAME = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', other: 'Other' };
  const ICON = {
    bullet: 'M13 2 4 14h7l-1 8 9-12h-7z',
    blitz: 'M12 2c1 3.5-2.5 5-2.5 8.5 0 1.4.8 2.5 2 2.8-.3-1.6.6-3 2-4 .2 2.4 2.5 3.4 2.5 6 0 2.6-2.2 4.7-5 4.7S6 17.9 6 15c0-5.2 6-7.4 6-13z',
    rapid: 'M9 1h6v2H9zM12 5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm1 8.4V8h-2v6.5l4.3 2.5 1-1.7z',
    classical: 'M6 2h12v5l-4 5 4 5v5H6v-5l4-5-4-5z',
    daily: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5z',
    other: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  };
  const WEEKS = 26;
  const DAY = 86400000;
  const nf = new Intl.NumberFormat();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const shortDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let state = null;
  let connection = 'connecting';
  let day = startOfDay(Date.now()); // the day being shown
  let ratedOnly = store.get('shohmot-rated', false);
  let gamesFilter = 'all';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (speed) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[speed]}" fill="currentColor" fill-rule="evenodd"/></svg>`;
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

  // ---------- time helpers (local timezone) ----------
  function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeek(t) { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return startOfDay(d.getTime()); }
  function isToday() { return day === startOfDay(Date.now()); }
  function isYesterday() { return day === addDays(startOfDay(Date.now()), -1); }
  function dayWord() { return isToday() ? 'today' : isYesterday() ? 'yesterday' : `on ${shortDayFmt.format(day)}`; }
  function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
  function ago(t) {
    const s = Math.round((t - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return 'just now';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }

  // ---------- stats ----------
  function filtered(games, from = day, to = addDays(day, 1)) {
    return games.filter((g) => g.end >= from && g.end < to && (!ratedOnly || g.rated));
  }
  function tally(games) {
    const t = { n: 0, w: 0, d: 0, l: 0, by: {} };
    for (const g of games) {
      const s = t.by[g.speed] || (t.by[g.speed] = { n: 0, w: 0, d: 0, l: 0 });
      const k = g.result === 'win' ? 'w' : g.result === 'draw' ? 'd' : 'l';
      t.n++; t[k]++; s.n++; s[k]++;
    }
    return t;
  }
  // The four usual types are always shown; classical/other only if ever played.
  function speedColumns() {
    const seen = new Set();
    for (const a of state.accounts) for (const g of a.games) seen.add(g.speed);
    return ALL_SPEEDS.filter((s) => BASE_SPEEDS.includes(s) || seen.has(s));
  }
  // Lichess stores the pre-game rating plus a diff; Chess.com stores the post-game rating.
  function postRating(g) { return g.ratingDiff != null ? g.rating + g.ratingDiff : g.rating; }
  // Rating at the end of the shown day for one type, and how far it moved that day.
  function dayRating(a, speed) {
    const end = addDays(day, 1);
    let before = null;
    let last = null;
    for (const g of a.games) {
      if (!g.rated || g.speed !== speed || g.rating == null || !['chess', 'standard'].includes(g.variant)) continue;
      if (g.end < day) before = g;
      else if (g.end < end) last = g;
      else break;
    }
    if (!last) return null;
    return { rating: postRating(last), change: before ? postRating(last) - postRating(before) : null };
  }

  // ---------- render ----------
  function render() {
    renderDay();
    if (!state) return;
    renderHero();
    renderRows();
    renderGames();
    renderBoard();
    renderSheet();
    renderStatus();
  }

  function renderDay() {
    const today = isToday();
    $('#day-label').innerHTML = today ? `<b>Today</b>, ${esc(longDayFmt.format(day))}`
      : isYesterday() ? `<b>Yesterday</b>, ${esc(longDayFmt.format(day))}` : `<b>${esc(longDayFmt.format(day))}</b>`;
    $('#day-next').disabled = today;
    $('#day-today').hidden = today;
    document.title = today ? 'Shohmot' : `Shohmot, ${shortDayFmt.format(day)}`;
  }

  function renderHero() {
    const accts = state.accounts;
    const t = tally(accts.flatMap((a) => filtered(a.games)));
    const syncedOnce = accts.some((a) => a.lastSyncAt);
    const h = $('#headline');
    const lead = isToday() ? 'Today you' : isYesterday() ? 'Yesterday you' : `On ${shortDayFmt.format(day)} you`;
    if (!accts.length) h.textContent = 'Add an account to start counting.';
    else if (!syncedOnce) h.textContent = 'Counting your games…';
    else if (!t.n) h.textContent = isToday() ? 'No games yet today.' : `No games ${dayWord()}.`;
    else h.innerHTML = `${lead} played ${plural(t.n, 'game', 'games')} and lost <span class="n-lost">${nf.format(t.l)}</span>.`;

    $('#split').innerHTML = t.n
      ? `<i class="w" style="width:${pct(t.w, t.n)}%"></i><i class="d" style="width:${pct(t.d, t.n)}%"></i><i class="l" style="width:${pct(t.l, t.n)}%"></i>`
      : '';
    $('#split').hidden = !t.n;
    $('#hero-sub').innerHTML = t.n
      ? `<span><i class="k" style="background:var(--win)"></i><b>${t.w}</b> won</span>
         <span><i class="k" style="background:var(--draw)"></i><b>${t.d}</b> drawn</span>
         <span><i class="k" style="background:var(--loss)"></i><b>${t.l}</b> lost, ${Math.round(pct(t.l, t.n))}%</span>`
      : '';
  }

  function cellHtml(speed, s, rt, label) {
    const head = `<span class="cell-label" style="--c:var(--${speed})">${speed === 'total' ? '' : icon(speed)}${label}</span>`;
    const rating = rt && rt.rating
      ? `<span class="rt">Rating <b>${rt.rating}</b>${rt.change ? `<em class="${rt.change > 0 ? 'up' : 'down'}">${rt.change > 0 ? '+' : '−'}${Math.abs(rt.change)}</em>` : ''}</span>`
      : '';
    if (!s || !s.n) {
      return `<div class="cell zero${speed === 'total' ? ' total' : ''}">${head}<span class="played">0</span><span class="lost">none</span></div>`;
    }
    return `
      <div class="cell${speed === 'total' ? ' total' : ''}">
        ${head}
        <span class="played">${nf.format(s.n)}</span>
        <span class="lost">${nf.format(s.l)} lost</span>
        <span class="mini" title="${s.w} won, ${s.d} drawn, ${s.l} lost"><i class="w" style="width:${pct(s.w, s.n)}%"></i><i class="d" style="width:${pct(s.d, s.n)}%"></i><i class="l" style="width:${pct(s.l, s.n)}%"></i></span>
        ${rating}
      </div>`;
  }

  function renderRows() {
    const speeds = speedColumns();
    const cols = `--cols:${speeds.length}`;
    $('#grid-head').setAttribute('style', cols);
    $('#grid-head').innerHTML = `<span></span>${speeds.map((s) => `<span style="--c:var(--${s})">${icon(s)}${SPEED_NAME[s]}</span>`).join('')}<span class="total-h">Total</span>`;

    if (!state.accounts.length) {
      $('#rows').innerHTML = '<p class="empty">No accounts yet. Add one with the Accounts button at the top.</p>';
      return;
    }
    $('#rows').innerHTML = state.accounts.map((a) => {
      const t = tally(filtered(a.games));
      const p = a.profile || {};
      const avatar = p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(a.username[0].toUpperCase());
      const name = p.url
        ? `<a class="who-name" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.displayName || a.username)}</a>`
        : `<span class="who-name">${esc(a.username)}</span>`;
      let meta = `<span class="site">${PLATFORM[a.platform]}</span>`;
      if (a.lastError) meta += `, <span class="err">${esc(a.lastError.message)}</span>`;
      else if (!a.lastSyncAt) meta += ', syncing for the first time…';
      else if (t.n && isToday()) meta += `, last game ${ago(a.games[a.games.length - 1].end)}`;
      else if (t.n) {
        const g = filtered(a.games);
        meta += `, ${timeFmt.format(g[0].end)} to ${timeFmt.format(g[g.length - 1].end)}`;
      }
      const who = `<div class="who"><span class="avatar" aria-hidden="true">${avatar}</span><div class="who-text">${name}<span class="who-meta">${meta}</span></div></div>`;

      if (!t.n) {
        return `<div class="row idle" style="${cols}">${who}<p class="idle-note">No games ${dayWord()}</p></div>`;
      }
      return `
        <div class="row" style="${cols}" aria-label="${esc(a.username)} on ${PLATFORM[a.platform]}">
          ${who}
          ${speeds.map((s) => cellHtml(s, t.by[s], dayRating(a, s), SPEED_NAME[s])).join('')}
          ${cellHtml('total', t, null, 'Total')}
        </div>`;
    }).join('');
  }

  function renderGames() {
    const list = [];
    for (const a of state.accounts) {
      for (const g of filtered(a.games)) {
        if (gamesFilter === 'loss' && g.result !== 'loss') continue;
        list.push({ g, a });
      }
    }
    list.sort((x, y) => y.g.end - x.g.end);
    const label = { win: 'Won', draw: 'Draw', loss: 'Lost' };
    $('#games-title').textContent = isToday() ? 'Games today' : isYesterday() ? 'Games yesterday' : `Games on ${shortDayFmt.format(day)}`;
    $('#games').innerHTML = list.map(({ g, a }) => `
      <li class="game">
        <span class="res ${g.result}">${label[g.result]}</span>
        <span class="opp">
          <span class="opp-name"><a href="${esc(g.url)}" target="_blank" rel="noopener">vs ${esc(g.opponent)}</a>${g.oppRating ? ` <small>${g.oppRating}</small>` : ''}</span>
          <span class="opp-meta"><i style="--c:var(--${g.speed})">${SPEED_NAME[g.speed]}</i> on ${esc(a.username)}, ${PLATFORM[a.platform]}${g.rated ? '' : ', casual'}</span>
        </span>
        <span class="when" title="${esc(new Date(g.end).toLocaleString())}">${isToday() ? ago(g.end) : timeFmt.format(g.end)}</span>
      </li>`).join('') || `<li class="empty">${gamesFilter === 'loss' ? `No losses ${dayWord()}.` : `No games ${dayWord()}.`}</li>`;
  }

  let boardDays = new Map();
  function renderBoard() {
    const now = Date.now();
    const start = startOfWeek(now) - (WEEKS - 1) * 7 * DAY;
    boardDays = new Map();
    for (const a of state.accounts) {
      for (const g of filtered(a.games, start, Infinity)) {
        const k = dayKey(g.end);
        const d = boardDays.get(k) || { total: 0, l: 0 };
        d.total++;
        if (g.result === 'loss') d.l++;
        boardDays.set(k, d);
      }
    }
    const max = Math.max(1, ...[...boardDays.values()].map((d) => d.total));

    const labels = [];
    for (let w = 0; w < WEEKS; w++) {
      const sunday = new Date(start); sunday.setDate(sunday.getDate() + w * 7 + 6);
      const prev = new Date(sunday); prev.setDate(prev.getDate() - 7);
      labels.push(w === 0 || sunday.getMonth() !== prev.getMonth() ? sunday : null);
    }
    if (labels[0] && (labels[1] || labels[2])) labels[0] = null;

    const cells = ['<span class="month"></span>'];
    ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].forEach((name, i) => cells.push(`<span class="dlabel" style="grid-row:${i + 2}">${name}</span>`));
    let played = 0;
    for (let w = 0; w < WEEKS; w++) {
      cells.push(`<span class="month">${labels[w] ? monthFmt.format(labels[w]) : ''}</span>`);
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(date.getDate() + w * 7 + d);
        const t = date.getTime();
        if (t > now) { cells.push('<span class="sq future"></span>'); continue; }
        const info = boardDays.get(dayKey(t));
        const cls = `sq${(w + d) % 2 ? ' dark' : ''}${t === day ? ' sel' : ''}`;
        if (!info) { cells.push(`<span class="${cls}" data-t="${t}"></span>`); continue; }
        played++;
        const l = Math.min(4, Math.max(1, Math.ceil((info.total / max) * 4)));
        cells.push(`<span class="${cls}" data-t="${t}" data-l="${l}"></span>`);
      }
    }
    const board = $('#board');
    board.innerHTML = cells.join('');
    board.parentElement.scrollLeft = board.parentElement.scrollWidth;
    board.setAttribute('role', 'img');
    board.setAttribute('aria-label', `You played on ${played} days in the last ${WEEKS} weeks.`);
    $('#board-hint').textContent = `You played on ${played} days in the last ${WEEKS} weeks. Click a day to open it.`;
  }

  function renderSheet() {
    $('#sheet-list').innerHTML = state.accounts.map((a) => `
      <li>
        <span class="name">${esc(a.username)}<small>${PLATFORM[a.platform]}, ${nf.format(a.games.length)} games synced</small></span>
        <button class="btn" type="button" data-remove="${esc(a.id)}">Remove</button>
      </li>`).join('') || '<li>No accounts yet.</li>';
  }

  function renderStatus() {
    const el = $('#status');
    const text = $('#status-text');
    const btn = $('#sync-now');
    if (connection === 'offline') {
      el.dataset.state = 'offline';
      text.textContent = 'Can’t reach the server. Retrying…';
      btn.disabled = true;
      return;
    }
    if (!state) { el.dataset.state = 'connecting'; text.textContent = 'Connecting'; return; }
    btn.disabled = state.syncing;
    if (state.syncing) { el.dataset.state = 'syncing'; text.textContent = 'Syncing…'; return; }
    el.dataset.state = 'live';
    if (!state.lastSyncAt) { text.textContent = 'Waiting for first sync'; return; }
    const s = Math.max(0, Math.round((Date.now() - state.lastSyncAt) / 1000));
    const next = Math.max(0, Math.round((state.nextSyncAt - Date.now()) / 1000));
    text.textContent = `Synced ${s < 5 ? 'just now' : s < 60 ? `${s}s ago` : ago(state.lastSyncAt)}, next in ${next}s`;
  }

  function syncControls() {
    for (const b of document.querySelectorAll('#games-filter button')) b.setAttribute('aria-pressed', String(b.dataset.r === gamesFilter));
    $('#rated-only').checked = ratedOnly;
  }

  const tip = $('#tip');
  function setDay(t) {
    day = Math.min(startOfDay(t), startOfDay(Date.now()));
    tip.hidden = true;
    render();
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // ---------- live connection ----------
  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('state', (e) => {
      connection = 'live';
      const data = JSON.parse(e.data);
      const added = data.added || [];
      state = data;
      render();
      if (added.length) {
        const parts = added.map((x) => {
          const a = state.accounts.find((acc) => acc.id === x.id);
          return a ? `${x.count} on ${a.username} (${PLATFORM[a.platform]})` : `${x.count}`;
        });
        const n = added.reduce((s, x) => s + x.count, 0);
        toast(`${n} new ${n === 1 ? 'game' : 'games'}: ${parts.join(', ')}`);
      }
    });
    es.addEventListener('status', (e) => {
      if (!state) return;
      Object.assign(state, JSON.parse(e.data));
      renderStatus();
    });
    es.onopen = () => { connection = 'live'; renderStatus(); };
    es.onerror = () => { connection = 'offline'; renderStatus(); };
  }

  // ---------- events ----------
  $('#day-prev').addEventListener('click', () => setDay(addDays(day, -1)));
  $('#day-next').addEventListener('click', () => setDay(addDays(day, 1)));
  $('#day-today').addEventListener('click', () => setDay(Date.now()));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (e.key === 'ArrowLeft') setDay(addDays(day, -1));
    if (e.key === 'ArrowRight') setDay(addDays(day, 1));
  });
  $('#rated-only').addEventListener('change', (e) => {
    ratedOnly = e.target.checked;
    store.set('shohmot-rated', ratedOnly);
    render();
  });
  $('#games-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    gamesFilter = b.dataset.r;
    syncControls();
    renderGames();
  });
  $('#sync-now').addEventListener('click', async () => {
    $('#sync-now').disabled = true;
    try { await fetch('/api/sync', { method: 'POST' }); } catch { /* status shows offline */ }
  });

  const dialog = $('#accounts-dialog');
  $('#open-accounts').addEventListener('click', () => { $('#add-error').textContent = ''; dialog.showModal(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
  $('#sheet-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const a = state.accounts.find((x) => x.id === btn.dataset.remove);
    if (!a || !confirm(`Remove ${a.username} (${PLATFORM[a.platform]})? Its synced games are deleted from this app, not from ${PLATFORM[a.platform]}.`)) return;
    btn.disabled = true;
    await fetch(`/api/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
  });
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = $('button[type="submit"]', form);
    const err = $('#add-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: form.platform.value, username: form.username.value.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { err.textContent = body.error || 'Could not add that account.'; return; }
      form.username.value = '';
      toast('Account added. Syncing its games now.');
    } catch {
      err.textContent = 'Can’t reach the server. Check that it’s running.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add account';
    }
  });

  $('#board').addEventListener('click', (e) => {
    const sq = e.target.closest('.sq[data-t]');
    if (sq) setDay(Number(sq.dataset.t));
  });
  $('#board').addEventListener('mouseover', (e) => {
    const sq = e.target.closest('.sq[data-t]');
    if (!sq) { tip.hidden = true; return; }
    const t = Number(sq.dataset.t);
    const info = boardDays.get(dayKey(t));
    tip.innerHTML = `<strong>${dayFmt.format(t)}</strong>${info ? `${plural(info.total, 'game', 'games')}, ${info.l} lost` : 'No games'}`;
    tip.hidden = false;
    const r = sq.getBoundingClientRect();
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 8}px`;
  });
  $('#board').addEventListener('mouseleave', () => { tip.hidden = true; });

  // Keep relative times fresh, and follow today across midnight.
  let lastDay = dayKey(Date.now());
  setInterval(() => {
    renderStatus();
    if (dayKey(Date.now()) !== lastDay) {
      const wasToday = day === startOfDay(Date.now() - DAY);
      lastDay = dayKey(Date.now());
      if (wasToday) day = startOfDay(Date.now());
      render();
    }
  }, 1000);
  setInterval(() => { if (state && isToday()) { renderRows(); renderGames(); } }, 30000);

  syncControls();
  render();
  connect();
})();
