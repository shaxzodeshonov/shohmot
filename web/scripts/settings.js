// Settings: name, email confirmation, plan and billing, tilt guard, emails,
// coach, signing out and the account's data.
import { currentUser, freshUser, remember, features, api, signOut, forget, unlocked } from './session.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
let me = null;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

function banner(kind, html) {
  $('#banners').insertAdjacentHTML('beforeend', `<div class="banner" data-kind="${kind}"><p>${html}</p></div>`);
}

const isPro = (u) => !!u && !!u.plan && u.plan !== 'free';

function render(user) {
  me = user;
  $('#name').value = user.name;
  $('#email-line').innerHTML = `${esc(user.email)} · ${user.verified ? '<span class="ok">confirmed</span>' : '<span class="warn">not confirmed yet</span>'}`;
  $('#resend').hidden = user.verified || !features().mail;

  const names = { free: 'Free', pro: 'Pro', coach: 'Coach' };
  $('#plan-name').textContent = names[user.plan] || 'Free';
  let line = 'Counter, reviews, the analysis board, loss-streak warnings and the weekly email.';
  if (isPro(user)) {
    line = user.planRenews
      ? `${user.planCancels ? 'Ends' : 'Renews'} on ${dateFmt.format(user.planRenews)}.`
      : user.admin ? 'Included because you’re an admin.' : 'Included with your account.';
  }
  $('#plan-line').textContent = line;
  $('#plan-upgrade').hidden = isPro(user) || !features().billing;
  $('#plan-upgrade').textContent = user.plan === 'pro' ? 'Switch to Coach' : 'See plans';
  $('#plan-manage').hidden = !(isPro(user) && user.planRenews && features().billing);

  const p = user.prefs || {};
  $('#lossStreak').value = String(p.lossStreak ?? 3);
  $('#dailyLimit').value = p.dailyLimit ? String(p.dailyLimit) : '';
  $('#notify').checked = !!p.notify;
  $('#weeklyEmail').checked = p.weeklyEmail !== false;
  for (const el of [$('#dailyLimit'), $('#notify')]) el.disabled = !unlocked(user);
  $('#tilt-pro-note').hidden = unlocked(user) || !features().billing;
  // No plans to show until billing is switched on: everything is free.
  $('#plan').hidden = !features().billing;
  for (const t of document.querySelectorAll('.pro-tag')) t.hidden = !features().billing;
}

async function savePrefs(patch) {
  try {
    const out = await api('/api/me', { prefs: patch });
    remember(out.user, out.features);
    render(out.user);
    toast('Saved.');
  } catch (err) { toast(err.message); }
}

// ---------- coach ----------
async function renderCoach() {
  const box = $('#coach-body');
  try {
    const res = await fetch('/api/coach', { cache: 'no-store' });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    const parts = [];
    if (out.coach) {
      parts.push(`<div class="set-row"><p class="grow"><b>${esc(out.coach.name)}</b> is your coach and can see your chess accounts and games.</p><button class="btn" type="button" id="coach-leave">Leave</button></div>`);
    } else {
      parts.push('<p class="muted">You don’t have a coach on Shohmot. If yours sends you an invite link, open it while signed in to join.</p>');
    }
    if (out.canCoach) {
      parts.push(out.students && out.students.length
        ? `<div class="set-row"><p class="grow">You coach ${out.students.length} of up to ${out.seats} students.</p><a class="btn btn-solid" href="/coach.html">Open your students</a></div>`
        : '<div class="set-row"><p class="grow"><b>Do you coach?</b> Send your students an invite link and see every student’s games, losses and mistakes in one place.</p><a class="btn btn-solid" href="/coach.html">Start coaching</a></div>');
    }
    box.innerHTML = parts.join('');
    const leave = $('#coach-leave');
    if (leave) leave.addEventListener('click', async () => {
      if (!confirm(`Leave ${out.coach.name}? They won’t see your games any more.`)) return;
      try { await api('/api/coach', { action: 'leave' }); toast('You left your coach.'); renderCoach(); freshUser(); } catch (err) { toast(err.message); }
    });
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message || 'Couldn’t load this.')}</p>`;
  }
}

// ---------- events ----------
$('#name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const out = await api('/api/me', { name: $('#name').value });
    remember(out.user, out.features);
    render(out.user);
    toast('Name saved.');
  } catch (err) { toast(err.message); }
});

$('#resend').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { toast((await api('/api/account', { action: 'resend-verify' })).message); } catch (err) { toast(err.message); }
  e.target.disabled = false;
});

$('#plan-manage').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try { location.href = (await api('/api/billing', { action: 'portal' })).url; } catch (err) { toast(err.message); e.target.disabled = false; }
});

$('#lossStreak').addEventListener('change', (e) => savePrefs({ lossStreak: Number(e.target.value) }));
$('#dailyLimit').addEventListener('change', (e) => savePrefs({ dailyLimit: Number(e.target.value) || 0 }));
$('#notify').addEventListener('change', async (e) => {
  if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') {
      e.target.checked = false;
      toast('Your browser blocked notifications for Shohmot. Allow them in the site settings to turn this on.');
      return;
    }
  }
  savePrefs({ notify: e.target.checked });
});
$('#weeklyEmail').addEventListener('change', (e) => savePrefs({ weeklyEmail: e.target.checked }));

$('#sign-out').addEventListener('click', signOut);
$('#sign-out-all').addEventListener('click', async () => {
  if (!confirm('Sign out on every device, this one too?')) return;
  try { await api('/api/account', { action: 'signout-all' }); } catch { /* cookie is cleared anyway */ }
  forget();
  location.href = '/login.html';
});

$('#delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = new FormData(e.target).get('password');
  if (!confirm('Delete your Shohmot account for good?')) return;
  try {
    await api('/api/account', { action: 'delete', password });
    forget();
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('shohmot-')) localStorage.removeItem(k); } catch { /* private mode */ }
    location.href = '/?deleted=1';
  } catch (err) { toast(err.message); }
});

// ---------- start ----------
const qs = new URLSearchParams(location.search);
currentUser().then(async (user) => {
  if (user) render(user);
  const now = await freshUser();
  if (now) render(now);
  renderCoach();
  // Back from Stripe Checkout: the webhook may land a moment after, so check again a few times.
  const upgraded = qs.get('upgraded');
  if (upgraded) {
    history.replaceState(null, '', location.pathname);
    banner('info', `<b>Thanks for upgrading!</b> <span id="up-wait">Setting up ${esc(upgraded === 'coach' ? 'Coach' : 'Pro')}…</span>`);
    for (let i = 0; i < 10 && !isPro(me); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (res.ok) { const out = await res.json(); remember(out.user, out.features); render(out.user); }
    }
    $('#up-wait').textContent = isPro(me) ? 'It’s on: the daily limit, notifications, unlimited training and 26 weeks of brilliant moves are yours.' : 'Payment received; your plan will switch on within a few minutes. Reload this page in a bit.';
  }
});
