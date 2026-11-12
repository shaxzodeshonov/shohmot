// The admin page: the numbers from /api/admin (ADMIN_EMAILS only).
import { features } from './session.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat();
const NAMES = {
  page_view: 'Page views', signup: 'Sign-ups', login: 'Sign-ins', account_added: 'Chess accounts added', review_started: 'Reviews started',
  review_finished: 'Reviews finished', review_shared: 'Reviews shared', guest_review: 'Reviews without an account', puzzle_solved: 'Training positions solved',
  puzzle_failed: 'Training positions missed', opening_solved: 'Opening lines played clean', opening_failed: 'Opening lines with slips', insights_viewed: 'Insights viewed', tilt_alert: 'Tilt warnings shown', upgrade_clicked: 'Upgrade clicks',
  checkout_started: 'Checkouts started', subscribed: 'New subscriptions', churned: 'Cancelled subscriptions', coach_joined: 'Students joined a coach',
  install: 'App installs', client_error: 'Script errors', double_built: 'Doubles built', double_game: 'Games against a double', review_picker: 'Review pop-ups opened', fil_message: 'Questions to Fischer',
};
const FUNNEL = { signup: 'Signed up', account_added: 'Added a chess account', review_finished: 'Finished a review', checkout_started: 'Started checkout', subscribed: 'Subscribed' };
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

async function load() {
  const days = $('#ad-days').value;
  const res = await fetch(`/api/admin?days=${days}`, { cache: 'no-store' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    $('#banners').innerHTML = `<div class="banner" data-kind="warn"><p><b>${esc(out.error || 'Couldn’t load the numbers.')}</b> ${res.status === 403 ? 'Add your email to ADMIN_EMAILS in the server’s environment.' : ''}</p></div>`;
    return;
  }
  const billing = features().billing;
  const t = out.totals;
  const visitors = out.byDay.reduce((s, d) => s + d.visitors, 0);
  const cards = [
    ['Accounts', out.users.total, `${out.users.verified} confirmed`],
    [`Visitors, ${days} days`, visitors, `${nf.format(t.page_view)} page views`],
    [`Sign-ups, ${days} days`, t.signup, visitors ? `${((t.signup / visitors) * 100).toFixed(1)}% of visitors` : ''],
    ['Reviews', t.review_finished, `${nf.format(t.guest_review)} without an account`],
    ['Training', t.puzzle_solved + t.puzzle_failed, `${nf.format(t.puzzle_solved)} solved`],
  ];
  if (billing) cards.push(['Paying', out.users.pro + out.users.coach, `about ${nf.format(out.mrr)} a month`]);
  $('#ad-cards').innerHTML = cards.map(([k, v, sub]) => `<div><dt>${esc(k)}</dt><dd>${nf.format(v)}<small>${esc(sub)}</small></dd></div>`).join('');

  const steps = out.funnel.filter((f) => billing || !['checkout_started', 'subscribed'].includes(f.step));
  // Later steps can outnumber the first (reviews without an account, accounts made before the window), so scale to the biggest.
  const top = Math.max(1, ...steps.map((f) => f.count));
  $('#ad-funnel').innerHTML = steps.map((f) => `<p><span>${esc(FUNNEL[f.step] || f.step)}</span><i style="--w:${(f.count / top) * 100}%"></i><b>${nf.format(f.count)}</b></p>`).join('');

  const cols = ['visitors', 'page_view', 'signup', 'account_added', 'review_finished', 'guest_review', 'puzzle_solved', 'client_error'];
  const head = ['Day', 'Visitors', 'Views', 'Sign-ups', 'Accounts added', 'Reviews', 'Guest reviews', 'Solved', 'Errors'];
  const max = Math.max(1, ...out.byDay.map((d) => d.visitors));
  $('#ad-days-table').innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${out.byDay.slice().reverse().map((d) => `<tr><td>${esc(dayFmt.format(new Date(`${d.day}T12:00:00`)))}</td>${cols.map((c) => {
    const v = c === 'visitors' ? d.visitors : d.events[c];
    return c === 'visitors' ? `<td><span class="ad-bar" style="--w:${(v / max) * 100}%"></span>${nf.format(v)}</td>` : `<td>${v ? nf.format(v) : '<span class="muted">0</span>'}</td>`;
  }).join('')}</tr>`).join('')}</tbody>`;

  $('#ad-pages').innerHTML = `<tbody>${Object.entries(out.pages).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<tr><td>${esc(p)}</td><td>${nf.format(n)}</td></tr>`).join('') || '<tr><td class="muted">No page views yet.</td></tr>'}</tbody>`;
  $('#ad-events').innerHTML = `<tbody>${Object.entries(t).filter(([e, n]) => e !== 'page_view' && n && (billing || !['checkout_started', 'subscribed', 'churned', 'upgrade_clicked'].includes(e))).sort((a, b) => b[1] - a[1]).map(([e, n]) => `<tr><td>${esc(NAMES[e] || e)}</td><td>${nf.format(n)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</tbody>`;
}

$('#ad-days').addEventListener('change', load);
load();
