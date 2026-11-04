// The sign-up and sign-in forms. Both post JSON to the server, which sets an
// HttpOnly session cookie, then go on to the page the visitor came for.
import { remember, signedIn } from './session.js';
import { track } from './track.js';

(() => {
  'use strict';
  const form = document.querySelector('#auth-form');
  const status = document.querySelector('#auth-status');
  const submit = form.querySelector('button[type="submit"]');
  const mode = form.dataset.mode; // "register" or "login"

  // Only follow ?next= to a page on this site.
  function nextPage() {
    const next = new URLSearchParams(location.search).get('next') || '';
    return /^\/(?![/\\])/.test(next) ? next : '/app.html';
  }

  // Keep ?next= when switching between sign-up and sign-in.
  for (const a of document.querySelectorAll('[data-keep-next]')) a.search = location.search;

  // Already signed in: skip the form.
  if (signedIn()) fetch('/api/me', { cache: 'no-store' }).then((res) => { if (res.ok) location.replace(nextPage()); }).catch(() => {});

  for (const btn of document.querySelectorAll('[data-reveal]')) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.reveal);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  }

  function say(msg, kind = 'bad') {
    status.textContent = msg;
    status.dataset.kind = kind;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    say(mode === 'register' ? 'Creating your account…' : 'Signing you in…', 'busy');
    try {
      const res = await fetch(`/api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        say(body.error || 'Something went wrong. Try again.');
        submit.disabled = false;
        return;
      }
      remember(body.user, body.features);
      if (mode === 'login') track('login');
      say(mode === 'register' ? `Welcome, ${body.user.name}!` : 'Signed in.', 'ok');
      location.replace(nextPage());
    } catch {
      say('Can’t reach Shohmot right now. Check your connection.');
      submit.disabled = false;
    }
  });
})();
