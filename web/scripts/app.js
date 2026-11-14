import { currentUser, freshUser, remember, features, onUser, api, unlocked } from './session.js';
import { track } from './track.js';
import { tiltAlerts } from './tilt.mjs';
import { foundIn } from './brilliants/store.mjs';
import { gameInfo } from './training/store.mjs';
import { note } from './notes.mjs';
import { PLATFORM, BASE_SPEEDS, ALL_SPEEDS, SPEED_NAME, esc, cellLabel, gridHeadHtml, loadingRowsHtml } from './counter-markup.js';

(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
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

  const SYNC_MS = 60000;
  const MAX_ACCOUNTS = 4;
  // The no-sign-up demo (demo.html): these accounts, nothing saved to a
  // Shohmot account, no mistake checks (they'd fill this browser's training
  // with someone else's games), and a shorter history so it loads quickly.
  const DEMO_LIST = (document.querySelector('#main').dataset.demo || '').split(',').filter(Boolean)
    .map((p) => { const [platform, username] = p.split(':'); return { platform, username }; });
  const DEMO = DEMO_LIST.length > 0;
  const DEMO_KEY = 'shohmot-demo-accounts';
  const DEMO_DAYS = 30;
  // The chess accounts live on the signed-in Shohmot account (see startup at the bottom).
  let myAccounts = [];
  let accountsKnown = false; // false until the profile (or the demo list) is in
  // A link like /app.html?accounts=chesscom:name,lichess:name opens straight onto those accounts.
  const linked = new URLSearchParams(location.search).get('accounts');
  let fromLink = [];
  if (linked) {
    fromLink = linked.split(',').map((p) => p.split(':')).filter(([pf, u]) => PLATFORM[pf] && /^[A-Za-z0-9_-]{2,30}$/.test(u || ''))
      .slice(0, MAX_ACCOUNTS).map(([platform, username]) => ({ platform, username }));
    history.replaceState(null, '', location.pathname);
  }
  // state: { accounts, coverFrom, base }
  //   accounts[].games  every game we have, oldest first
  //   coverFrom         games are complete from this time on (0: the whole calendar)
  //   base              for the days before coverFrom, last visit's totals:
  //                     { days: { dayKey: [games, lost, rated games, rated lost] }, speeds }
  let state = null;
  let lastFetchedAt = 0; // the server's time of the newest answer: games are known up to here
  let fullAt = 0; // when the whole 26 weeks were last fetched
  let connection = 'connecting';
  let syncing = false;
  let lastSyncAt = null;
  let nextSyncAt = Date.now();
  let syncTimer = null;
  let day = startOfDay(Date.now()); // the day being shown
  let ratedOnly = store.get('shohmot-rated', false);
  let gamesFilter = 'all';

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
    if (!state) return BASE_SPEEDS;
    const seen = new Set(state.base ? state.base.speeds : []);
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
  // Each part is only rewritten when its markup changed, so a sync that
  // brings nothing new doesn't touch the page.
  const drawn = new WeakMap();
  function setHTML(el, html) {
    if (drawn.get(el) === html) return false;
    drawn.set(el, html);
    el.innerHTML = html;
    if (el.id === 'rows') tickCounts(el);
    return true;
  }
  // A count that changed runs up (or down) to its new value, so a game that
  // has just landed is seen arriving.
  const lastCounts = [];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tickCounts(root) {
    root.querySelectorAll('.played').forEach((el, i) => {
      const text = el.textContent;
      const to = Number(text.replace(/\D/g, ''));
      const from = lastCounts[i] || 0;
      lastCounts[i] = to;
      if (calm || from === to || !/\d/.test(text)) return;
      const t0 = performance.now();
      const step = (now) => {
        if (!el.isConnected) return;
        const k = Math.min(1, (now - t0) / 500);
        el.textContent = k < 1 ? nf.format(Math.round(from + (to - from) * (1 - (1 - k) ** 3))) : text;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  // The shown day is older than the games we have (last visit's copy covers
  // only today and yesterday): it waits for the full history.
  const dayKnown = () => !state || !state.coverFrom || day >= state.coverFrom;

  function render() {
    renderDay();
    $('#main').classList.toggle('is-loading', !state || !dayKnown());
    if (state && !dayKnown()) {
      $('#headline').textContent = `Loading ${shortDayFmt.format(day)}…`;
      setHTML($('#hero-sub'), '');
      setHTML($('#split'), '');
      $('#split').hidden = false;
      renderGridHead(speedColumns());
      setHTML($('#rows'), loadingRowsHtml(state.accounts, speedColumns()));
      setHTML($('#games'), '<li class="empty">Loading…</li>');
      renderBanners();
      renderBoard();
      renderStatus();
      wantFull();
      return;
    }
    if (!state) {
      // Waiting for the first answer from the server, or for the first account.
      // Until the account list is known the page keeps its "Counting…" headline,
      // and each account gets a placeholder row, so nothing jumps when the games come.
      if (accountsKnown) {
        $('#headline').textContent = myAccounts.length ? `Finding ${DEMO ? 'their' : 'your'} games…` : 'Add an account to see today’s games.';
        $('#hero-sub').textContent = myAccounts.length ? 'The first look can take a few seconds.' : '';
      }
      setHTML($('#split'), '');
      $('#split').hidden = false;
      if (myAccounts.length) {
        renderGridHead(BASE_SPEEDS);
        setHTML($('#rows'), loadingRowsHtml(myAccounts));
      } else if (accountsKnown) {
        setHTML($('#grid-head'), '');
        setHTML($('#rows'), '');
      }
      setHTML($('#games'), '');
      return;
    }
    renderHero();
    renderBanners();
    renderRows();
    renderGames();
    renderBoard();
    renderStatus();
  }

  // Phones get the short date, so the label stays on one line.
  const narrow = matchMedia('(max-width: 30em)');
  narrow.addEventListener('change', () => renderDay());
  function renderDay() {
    const today = isToday();
    const date = esc((narrow.matches ? shortDayFmt : longDayFmt).format(day));
    $('#day-label').innerHTML = today ? `<b>Today</b>, ${date}` : isYesterday() ? `<b>Yesterday</b>, ${date}` : `<b>${date}</b>`;
    $('#day-next').disabled = today;
    $('#day-today').hidden = today;
    document.title = today ? 'Shohmot' : `Shohmot, ${shortDayFmt.format(day)}`;
  }

  function renderHero() {
    const accts = state.accounts;
    const t = tally(accts.flatMap((a) => filtered(a.games)));
    const syncedOnce = accts.some((a) => a.lastSyncAt);
    const h = $('#headline');
    const who = DEMO ? 'they' : 'you';
    const lead = isToday() ? `Today ${who}` : isYesterday() ? `Yesterday ${who}` : `On ${shortDayFmt.format(day)} ${who}`;
    if (!accts.length) h.textContent = 'Add an account to start counting.';
    else if (!syncedOnce) h.textContent = `Counting ${DEMO ? 'their' : 'your'} games…`;
    else if (!t.n) h.textContent = isToday() ? 'No games yet today.' : `No games ${dayWord()}.`;
    else h.innerHTML = `${lead} played ${plural(t.n, 'game', 'games')} and lost <span class="n-lost">${nf.format(t.l)}</span>.`;

    setHTML($('#split'), t.n
      ? `<i class="w" style="width:${pct(t.w, t.n)}%"></i><i class="d" style="width:${pct(t.d, t.n)}%"></i><i class="l" style="width:${pct(t.l, t.n)}%"></i>`
      : '');
    $('#split').hidden = !t.n;
    const shown = accts.flatMap((a) => filtered(a.games).map((g) => foundIn(a.platform, g.id).length));
    const bril = shown.reduce((s, n) => s + n, 0);
    setHTML($('#hero-sub'), t.n
      ? `<span><i class="k" style="background:var(--win)"></i><b>${t.w}</b> won</span>
         <span><i class="k" style="background:var(--draw)"></i><b>${t.d}</b> drawn</span>
         <span><i class="k" style="background:var(--loss)"></i><b>${t.l}</b> lost, ${Math.round(pct(t.l, t.n))}%</span>
         ${bril ? `<a class="bril-chip" href="/brilliants.html" data-astro-prefetch="false"><i>!!</i><b>${bril}</b> brilliant</a>` : ''}`
      : '');
  }

  function cellHtml(speed, s, rt, label) {
    const head = cellLabel(speed, label);
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

  function renderGridHead(speeds) {
    $('#grid-head').setAttribute('style', `--cols:${speeds.length}`);
    setHTML($('#grid-head'), gridHeadHtml(speeds));
  }

  function renderRows() {
    const speeds = speedColumns();
    const cols = `--cols:${speeds.length}`;
    renderGridHead(speeds);

    if (!state.accounts.length) {
      setHTML($('#rows'), '<p class="empty">No accounts yet. Add one with the Accounts button at the top.</p>');
      return;
    }
    setHTML($('#rows'), state.accounts.map((a) => {
      const t = tally(filtered(a.games));
      const p = a.profile || {};
      const avatar = p.avatar && !brokenAvatars.has(p.avatar) ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">` : esc(a.username[0].toUpperCase());
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
    }).join(''));
  }
  // A picture that won't load (gone, or blocked) shows the first letter instead.
  const brokenAvatars = new Set();
  $('#rows').addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    brokenAvatars.add(e.target.getAttribute('src'));
    renderRows();
  }, true);

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
    setHTML($('#games'), list.map(({ g, a }) => `
      <li class="game">
        <span class="res ${g.result}">${label[g.result]}</span>
        <span class="opp">
          <span class="opp-name"><a href="${esc(g.url)}" target="_blank" rel="noopener">vs ${esc(g.opponent)}</a>${g.oppRating ? ` <small>${g.oppRating}</small>` : ''}${brilBadge(g, a)}${mistakeBadge(g, a)}</span>
          <span class="opp-meta"><i style="--c:var(--${g.speed})">${SPEED_NAME[g.speed]}</i> on ${esc(a.username)}, ${PLATFORM[a.platform]}${g.rated ? '' : ', casual'}</span>
        </span>
        <span class="when" title="${esc(new Date(g.end).toLocaleString())}">${isToday() ? ago(g.end) : timeFmt.format(g.end)}</span>
        ${reviewLink(g, a)}
      </li>`).join('') || `<li class="empty">${gamesFilter === 'loss' ? `No losses ${dayWord()}.` : `No games ${dayWord()}.`}</li>`);
  }

  // How many mistakes a checked game had; it opens Training on that game.
  function mistakeBadge(g, a) {
    if (checking && checking.platform === a.platform && checking.id === g.id) {
      return ' <span class="checking-badge" title="Stockfish is looking for your mistakes in this game"><span class="spin" aria-hidden="true"></span>Checking…</span>';
    }
    const info = gameInfo(a.platform, g.id);
    if (!info || !info.n) return '';
    return ` <a class="mist-badge" href="/train.html?game=${encodeURIComponent(`${a.platform}:${g.id}`)}" data-astro-prefetch="false" title="${info.n} position${info.n === 1 ? '' : 's'} to train from this game">${info.n} to train</a>`;
  }

  // "!!" on games with a brilliant move; it opens the review at the first one.
  function brilBadge(g, a) {
    const found = foundIn(a.platform, g.id);
    if (!found.length) return '';
    const qs = new URLSearchParams({ p: a.platform, u: a.username, id: g.id, t: String(g.end), ply: String(found[0].ply) });
    return ` <a class="bril-badge" href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false" title="${found.length} brilliant move${found.length === 1 ? '' : 's'}: ${esc(found.map((b) => b.san).join(', '))}">!!${found.length > 1 ? ` ${found.length}` : ''}</a>`;
  }

  // Every new game today gets a quick check by Stockfish, in this tab: your
  // mistakes become training positions (and a "what to work on" card here),
  // and brilliant moves are counted. Losses go first. It's background work:
  // it waits until the page has settled and is on screen, and uses one or
  // two engines, so the page and the computer stay quick while it runs.
  let checkJob = null;
  let checking = null; // { platform, id } of the game being checked
  let checkTimer = null;
  function analyzeSoon() {
    if (DEMO || checkJob) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      if (document.prerendering || document.visibilityState !== 'visible') return; // tried again when it's shown
      if ('requestIdleCallback' in window) requestIdleCallback(analyzeToday, { timeout: 4000 }); else analyzeToday();
    }, 1500);
  }
  if (document.prerendering) document.addEventListener('prerenderingchange', analyzeSoon, { once: true });
  async function analyzeToday() {
    if (checkJob || !state || DEMO) return;
    const from = startOfDay(Date.now());
    const todo = state.accounts.filter((a) => a.games.some((g) => g.end >= from && (g.variant === 'chess' || g.variant === 'standard') && !gameInfo(a.platform, g.id)));
    if (!todo.length) return;
    checkJob = true; // taken while the checker loads
    let analyzeMany;
    try { ({ analyzeMany } = await import('./training/analyze.mjs')); } catch { checkJob = null; return; }
    checkJob = analyzeMany({
      accounts: todo.map((a) => ({ platform: a.platform, username: a.username })),
      since: from,
      workers: (navigator.hardwareConcurrency || 2) >= 8 ? 2 : 1,
      onProgress: (p) => {
        const now = p.current || null;
        if (JSON.stringify(now) === JSON.stringify(checking)) return;
        checking = now;
        if (state && dayKnown()) renderGames();
      },
      onGame: (platform, g, out) => {
        if (out.brilliants.length) noteBrilliant(platform, g, out.brilliants);
        // New mistakes light the dot on Training in the sidebar (appbar.js).
        if (out.items.length) document.dispatchEvent(new Event('shohmot:news'));
        render();
      },
      onDone: () => { checkJob = null; checking = null; render(); },
    });
  }

  // Brilliant moves found by the check: one notification, top right, that
  // gathers them all and stays until you close it. Closed, the next find
  // starts a fresh one.
  let brils = [];
  function noteBrilliant(platform, g, found) {
    const a = state && state.accounts.find((x) => x.platform === platform && x.games.some((y) => y.id === g.id));
    brils.push({ platform, g, found, u: a ? a.username : '' });
    const n = brils.reduce((s, b) => s + b.found.length, 0);
    const rows = brils.map(({ platform: p, g: x, found: f, u }) => {
      const qs = new URLSearchParams({ p, u, id: x.id, t: String(x.end), ply: String(f[0].ply) });
      return `<li><a href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false"><b>${esc(f.map((b) => b.san).join(', '))}</b> vs ${esc(x.opponent)}</a></li>`;
    }).join('');
    note('brilliants', `<p class="note-head"><i class="note-bril" aria-hidden="true">!!</i><b>${n === 1 ? 'A brilliant move' : `${n} brilliant moves`}</b></p>
      <ul class="note-list">${rows}</ul>
      <a class="note-more" href="/brilliants.html" data-astro-prefetch="false">See all brilliants</a>`, { onClose: () => { brils = []; } });
  }

  // Stockfish review, for standard chess only.
  function reviewLink(g, a) {
    if (g.variant !== 'chess' && g.variant !== 'standard') return '<span></span>';
    const qs = new URLSearchParams({ p: a.platform, u: a.username, id: g.id, t: String(g.end) });
    if (DEMO) qs.set('guest', '1'); // keeps a demo player's game out of this browser's training
    return `<a class="review-link" href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false">Review</a>`;
  }

  let boardDays = new Map();
  let boardScrolled = false;
  function renderBoard() {
    const now = Date.now();
    const start = startOfWeek(now) - (WEEKS - 1) * 7 * DAY;
    // The days we have games for are counted from them; older days come from
    // last visit's totals. Without those (a first visit), they're still loading.
    const from = state.coverFrom || 0;
    const complete = !from || !!state.base;
    boardDays = new Map();
    for (const a of state.accounts) {
      for (const g of filtered(a.games, Math.max(start, from), Infinity)) {
        const k = dayKey(g.end);
        const d = boardDays.get(k) || { total: 0, l: 0 };
        d.total++;
        if (g.result === 'loss') d.l++;
        boardDays.set(k, d);
      }
    }
    if (from && state.base) {
      for (const [k, [n, l, rn, rl]] of Object.entries(state.base.days)) {
        const total = ratedOnly ? rn : n;
        if (total) boardDays.set(k, { total, l: ratedOnly ? rl : l });
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
    setHTML(board, cells.join(''));
    // Start at this week, once; after that, leave it where you scrolled it.
    if (!boardScrolled) { board.parentElement.scrollLeft = board.parentElement.scrollWidth; boardScrolled = true; }
    board.setAttribute('role', 'img');
    const who = DEMO ? 'They' : 'You';
    const summary = complete ? `${who} played on ${played} days in the last ${WEEKS} weeks.` : `Loading the last ${WEEKS} weeks…`;
    board.setAttribute('aria-label', summary);
    $('#board-hint').textContent = complete ? `${summary} Click a day to open it.` : summary;
  }



  // Syncing happens on its own every minute; the clock and "Sync now" are
  // for admins only.
  function syncNowShown() { $('#sync-now').hidden = !myAccounts.length || !(me && me.admin); }
  function renderStatus() {
    const el = $('#status');
    const text = $('#status-text');
    $('#sync-now').disabled = syncing;
    el.hidden = !(me && me.admin);
    if (syncing) { el.dataset.state = 'syncing'; text.textContent = 'Syncing…'; return; }
    const next = Math.max(0, Math.round((nextSyncAt - Date.now()) / 1000));
    if (connection === 'offline') {
      el.dataset.state = 'offline';
      text.textContent = `Can’t reach the server. Retrying in ${next}s`;
      return;
    }
    if (!lastSyncAt) { el.dataset.state = 'connecting'; text.textContent = 'Connecting'; return; }
    el.dataset.state = 'live';
    const s = Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000));
    text.textContent = `Synced ${s < 5 ? 'just now' : s < 60 ? `${s}s ago` : ago(lastSyncAt)}, next in ${next}s`;
  }

  // Saving a new account list: load its games right away (behind the pop-up).
  let accountsEdited = false; // changed here since the page opened
  function useAccounts(list) {
    if (list.length > myAccounts.length && !DEMO) track('account_added');
    accountsEdited = true;
    myAccounts = list.map(({ platform, username }) => ({ platform, username }));
    if (DEMO) store.set(DEMO_KEY, myAccounts); else saveAccounts();
    state = null;
    lastSyncAt = null;
    lastFetchedAt = 0;
    fullAt = 0;
    connection = 'connecting';
    syncNowShown();
    render();
    if (myAccounts.length) sync(true);
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

  // ---------- sync: ask the server for fresh data every minute ----------
  async function saveAccounts() {
    try {
      const res = await fetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: myAccounts }) });
      if (res.status === 401) location.replace('/login.html?next=/app.html');
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else { const out = await res.json(); remember(out.user, out.features); }
    } catch {
      toast('Couldn’t save your accounts to Shohmot. They’ll be lost on reload.');
    }
  }
  // ---------- last visit's copy ----------
  // After each sync the counter keeps a small copy of what it shows: today's
  // and yesterday's games, the last game of each type before them (for the
  // rating change), and a total per day for the calendar. The next visit draws
  // the whole page from it straight away, then asks only for what's new.
  const SNAP = 'shohmot-counter:v1';
  const SNAP_READY = 'shohmot-counter:ready'; // read by Base.astro's head script, which can't afford to read the copy itself
  const SNAP_MAX = 400 * 1024; // characters; a copy that would be bigger isn't kept
  const accountsKey = (list) => list.map((a) => `${a.platform}:${a.username}`).join(',');
  function dayStart(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m, d).getTime(); }
  const standard = (g) => g.variant === 'chess' || g.variant === 'standard';

  function saveSnapshot() {
    if (DEMO || !state || !lastFetchedAt || (state.coverFrom && !state.base)) return;
    const now = Date.now();
    const windowStart = addDays(startOfDay(now), -1);
    const boardStart = startOfWeek(now) - (WEEKS - 1) * 7 * DAY;
    const from = state.coverFrom || 0;
    const days = { ...(state.base ? state.base.days : {}) };
    const speeds = new Set(state.base ? state.base.speeds : []);
    const accounts = state.accounts.map((a) => {
      const recent = [];
      const anchor = {};
      for (const g of a.games) {
        speeds.add(g.speed);
        if (g.end >= windowStart) { recent.push(g); continue; }
        if (g.rated && g.rating != null && standard(g)) anchor[g.speed] = g;
        if (g.end >= from && g.end >= boardStart) {
          const d = days[dayKey(g.end)] || (days[dayKey(g.end)] = [0, 0, 0, 0]);
          d[0]++;
          if (g.result === 'loss') d[1]++;
          if (g.rated) { d[2]++; if (g.result === 'loss') d[3]++; }
        }
      }
      return { id: a.id, platform: a.platform, username: a.username, profile: a.profile, lastError: a.lastError,
        games: Object.values(anchor).concat(recent).sort((x, y) => x.end - y.end) };
    });
    for (const k of Object.keys(days)) if (dayStart(k) < boardStart) delete days[k];
    const json = JSON.stringify({ v: 1, key: accountsKey(myAccounts), at: lastFetchedAt, fullAt, windowStart, days, speeds: [...speeds], accounts });
    try {
      if (json.length > SNAP_MAX) throw new Error('too big');
      localStorage.setItem(SNAP, json);
      localStorage.setItem(SNAP_READY, '1');
    } catch {
      // Too big, full or blocked: the next visit just loads the usual way.
      try { localStorage.removeItem(SNAP); localStorage.removeItem(SNAP_READY); } catch { /* blocked */ }
    }
  }

  function loadSnapshot() {
    const s = store.get(SNAP, null);
    if (!s || s.v !== 1 || s.key !== accountsKey(myAccounts) || Date.now() - s.at > 60 * DAY) return false;
    state = { accounts: s.accounts.map((a) => ({ ...a, lastSyncAt: s.at })), coverFrom: s.windowStart, base: { days: s.days, speeds: s.speeds } };
    lastFetchedAt = s.at;
    fullAt = s.fullAt || 0;
    lastSyncAt = s.at;
    return true;
  }

  // An answer covers [from, serverTime]. A short one replaces just that
  // stretch of the games we have; a full one replaces them all. An account
  // that couldn't be fetched keeps what it had.
  function merge(answer, { full, from, serverTime, now }) {
    return answer.map((a) => {
      const prev = state && state.accounts.find((x) => x.id === a.id);
      if (a.error && prev) return { ...prev, profile: a.profile || prev.profile, lastSyncAt: now, lastError: { message: a.error } };
      let games = a.games;
      if (!full && prev) {
        const ids = new Set(games.map((g) => g.id));
        // An hour's overlap at the start allows for the two clocks differing.
        const keep = prev.games.filter((g) => !ids.has(g.id) && (g.end < from + 3600000 || g.end > serverTime));
        if (keep.length) games = keep.concat(games).sort((x, y) => x.end - y.end);
      }
      return { ...a, games, lastSyncAt: now, lastError: a.error ? { message: a.error } : null };
    });
  }

  // ---------- sync ----------
  // The first visit asks for two days (quick), then everything. After that,
  // each sync asks only for what's new since the last one; everything again
  // at most twice a day, or when an older day is opened.
  const RECENT_DAYS = 2;
  const FULL_EVERY = 12 * 3600000;
  const SERVER_DAYS = 26 * 7 + 14; // what the server sends when no days are given
  let syncAgain = false;
  let fullWanted = false;
  let demoMoved = false;
  let firstAnswer = true;
  function wantFull() {
    if (!state || !state.coverFrom || fullWanted) return;
    fullWanted = true;
    if (!syncing) sync();
  }
  const needsFull = () => !!state && !!state.coverFrom && (fullWanted || !state.base || Date.now() - fullAt > FULL_EVERY);

  async function sync(fresh = false) {
    // If the account list changed mid-sync, run again right after.
    if (syncing) { syncAgain = true; return; }
    const kind = !state ? 'quick' : needsFull() ? 'full' : 'recent';
    let days = kind === 'quick' ? RECENT_DAYS : kind === 'full' ? (DEMO ? DEMO_DAYS : SERVER_DAYS)
      : Math.max(RECENT_DAYS, Math.ceil((Date.now() - lastFetchedAt) / DAY + 0.25));
    days = Math.min(days, SERVER_DAYS);
    syncing = true;
    clearTimeout(syncTimer);
    renderStatus();
    let ok = false;
    try {
      const wanted = JSON.stringify(myAccounts);
      let answer = [];
      let serverTime = Date.now();
      if (myAccounts.length) {
        const q = myAccounts.map((a) => `${a.platform}:${a.username}`).join(',');
        const res = await fetch(`/api/state?accounts=${encodeURIComponent(q)}&days=${days}${fresh ? `&fresh=${Date.now()}` : ''}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const out = await res.json();
        answer = out.accounts;
        if (out.serverTime) serverTime = out.serverTime;
      }
      // The account list changed while we were waiting; drop this answer.
      if (wanted !== JSON.stringify(myAccounts)) { syncAgain = true; return; }
      const now = Date.now();
      const from = serverTime - days * DAY;
      const next = merge(answer, { full: kind === 'full', from, serverTime, now });
      // Tell the user about games that weren't there on the last sync.
      const added = [];
      if (state && !firstAnswer) {
        for (const a of next) {
          const prev = state.accounts.find((x) => x.id === a.id);
          if (!prev || !prev.games.length) continue;
          const seen = new Set(prev.games.map((g) => g.id));
          const latest = prev.games[prev.games.length - 1].end;
          const n = a.games.filter((g) => !seen.has(g.id) && g.end > latest).length;
          if (n) added.push(`${n} on ${a.username} (${PLATFORM[a.platform]})`);
        }
      }
      if (kind === 'full') {
        // The demo's "everything" is its last 30 days; that's all it shows.
        state = { accounts: next, coverFrom: 0, base: null };
        fullAt = now;
        fullWanted = false;
      } else if (kind === 'quick') {
        state = { accounts: next, coverFrom: from, base: null };
      } else {
        state = { accounts: next, coverFrom: state.coverFrom, base: state.base };
      }
      lastFetchedAt = Math.max(lastFetchedAt, serverTime);
      connection = 'live';
      lastSyncAt = now;
      firstAnswer = false;
      ok = true;
      render();
      if (added.length) toast(`New games: ${added.join(', ')}`);
      saveSnapshot();
      analyzeSoon();
      // In the demo, if nobody has played yet today, show their latest day.
      if (kind === 'full' && DEMO && !demoMoved) {
        demoMoved = true;
        const latest = Math.max(0, ...state.accounts.flatMap((a) => a.games.map((g) => g.end)));
        if (latest && latest < startOfDay(Date.now())) setDay(latest);
      }
    } catch {
      connection = 'offline';
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; setTimeout(() => sync(true)); } else if (ok && needsFull()) setTimeout(() => sync());
      nextSyncAt = Date.now() + SYNC_MS;
      syncTimer = setTimeout(() => sync(), SYNC_MS);
      renderStatus();
    }
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
  $('#sync-now').addEventListener('click', () => sync(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!lastSyncAt || Date.now() - lastSyncAt > SYNC_MS) sync(); else analyzeSoon();
  });

  const popup = window.createAccountPopup({ getAccounts: () => myAccounts, onChange: useAccounts, max: MAX_ACCOUNTS });
  $('#open-accounts').addEventListener('click', () => {
    if (state) for (const a of state.accounts) popup.remember(a.platform, a.username, a.profile && a.profile.avatar);
    popup.open();
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

  // ---------- banners: confirm your email, and the tilt guard ----------
  let me = null;
  const SEEN = 'shohmot-tilt-seen';
  const seen = () => store.get(SEEN, []);
  function dismiss(key) { store.set(SEEN, [key, ...seen().filter((k) => k !== key)].slice(0, 40)); renderBanners(); }

  function renderBanners() {
    const box = $('#banners');
    const out = [];
    if (DEMO) {
      // The banner is in the page's HTML (Counter.astro); only its wording changes.
      const famous = JSON.stringify(myAccounts) === JSON.stringify(DEMO_LIST);
      $('[data-famous]', box).hidden = !famous;
      $('[data-picked]', box).hidden = famous;
      $('[data-act="demo-reset"]', box).hidden = famous;
      return;
    }
    if (me && !me.verified && features().mail) {
      out.push(`<div class="banner" data-kind="info"><p><b>Confirm your email.</b> We sent a link to ${esc(me.email)}. It lets you reset your password and get your weekly recap.</p>
        <div class="banner-actions"><button class="btn" type="button" data-act="resend">Send it again</button></div></div>`);
    }
    if (me && state) {
      const games = state.accounts.flatMap((a) => a.games);
      for (const alert of tiltAlerts(games, me.prefs || {}, { pro: unlocked(me), now: Date.now() })) {
        if (seen().includes(alert.key)) continue;
        notifyOnce(alert);
        const extra = alert.upsell && features().billing ? '<a class="btn" href="/pricing.html">See Pro</a>' : '';
        out.push(`<div class="banner" data-kind="${alert.kind}"><p><b>${esc(alert.title)}</b> ${esc(alert.text)}</p>
          <div class="banner-actions">${extra}<a class="btn" href="/settings.html#tilt">Settings</a><button class="btn btn-solid" type="button" data-dismiss="${esc(alert.key)}">${alert.upsell ? 'Not now' : 'OK, taking a break'}</button></div></div>`);
      }
    }
    setHTML(box, out.join(''));
  }

  // A desktop notification when an alert first shows up, if it's on (Pro) and allowed.
  function notifyOnce(alert) {
    const key = `n:${alert.key}`;
    if (seen().includes(key)) return;
    store.set(SEEN, [key, ...seen()].slice(0, 40));
    if (!alert.upsell) track('tilt_alert');
    if (!me.prefs || !me.prefs.notify || alert.upsell || !('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: alert.text, icon: '/icons/icon-192.png', tag: 'shohmot-tilt', data: { url: '/app.html' } };
    navigator.serviceWorker && navigator.serviceWorker.ready
      ? navigator.serviceWorker.ready.then((r) => r.showNotification(alert.title, opts)).catch(() => {})
      : new Notification(alert.title, opts);
  }

  $('#banners').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-dismiss]');
    if (d) return dismiss(d.dataset.dismiss);
    if (e.target.closest('[data-act="demo-reset"]')) { try { localStorage.removeItem(DEMO_KEY); } catch { /* */ } useAccounts(DEMO_LIST); return; }
    const r = e.target.closest('[data-act="resend"]');
    if (r) {
      r.disabled = true;
      try { toast((await api('/api/account', { action: 'resend-verify' })).message); } catch (err) { toast(err.message); }
      r.disabled = false;
    }
  });

  function showUser(user) {
    me = user;
    renderStatus();
    syncNowShown();
    if (state) renderBanners();
  }
  onUser(showUser);

  syncControls();
  if (DEMO) {
    myAccounts = store.get(DEMO_KEY, null) || DEMO_LIST;
    accountsKnown = true;
    render();
    renderBanners();
    sync();
    return;
  }
  render();
  // Starts from last visit's copy of the profile (instant), then follows what
  // the server says if the accounts changed on another device.
  currentUser().then((user) => {
    accountsKnown = true;
    if (user) {
      showUser(user);
      myAccounts = user.accounts;
      freshUser().then((now) => {
        if (!now) return;
        showUser(now);
        if (!accountsEdited && JSON.stringify(now.accounts) !== JSON.stringify(myAccounts)) {
          myAccounts = now.accounts.slice();
          state = null;
          lastFetchedAt = 0;
          fullAt = 0;
          syncNowShown();
          render();
          if (myAccounts.length) sync(true); else popup.open();
        }
      });
    }
    // Accounts saved in this browser before sign-in existed move onto the Shohmot account once.
    const legacy = store.get('shohmot-accounts', null);
    if (legacy) {
      try { localStorage.removeItem('shohmot-accounts'); } catch { /* private mode */ }
      if (!myAccounts.length && Array.isArray(legacy) && legacy.length) fromLink = legacy.slice(0, MAX_ACCOUNTS);
    }
    if (fromLink.length) { delete document.documentElement.dataset.snap; useAccounts(fromLink); return; }
    syncNowShown();
    // Last visit's copy, if it's for these accounts: the whole page at once.
    if (!myAccounts.length || !loadSnapshot()) delete document.documentElement.dataset.snap;
    render();
    // First visit: nothing saved yet, so ask for an account straight away.
    if (myAccounts.length) sync(); else popup.open();
  });
})();
