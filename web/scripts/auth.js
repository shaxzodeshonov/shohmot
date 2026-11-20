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
  const params = new URLSearchParams(location.search);
  const keep = new URLSearchParams(params.has('next') ? { next: params.get('next') } : {}).toString();
  for (const a of document.querySelectorAll('[data-keep-next]')) a.search = keep;

  // "Continue with Google" (src/google.js) leaves for Google, then comes back
  // signed in, or here with ?google=<why it didn't work>.
  const google = document.querySelector('#google-btn');
  if (google) {
    google.search = new URLSearchParams({ next: nextPage() }).toString();
    google.addEventListener('click', () => {
      google.setAttribute('aria-disabled', 'true');
      say('Taking you to Google…', 'busy');
    });
    // Back from Google with the browser's back button: the button works again.
    addEventListener('pageshow', (e) => { if (e.persisted) { google.removeAttribute('aria-disabled'); say('', 'busy'); } });
  }
  const GOOGLE_ERRORS = {
    cancelled: 'Google sign-in was cancelled. Try again, or use your email.',
    expired: 'That Google sign-in took too long or was started in another tab. Try again.',
    failed: 'Google didn’t confirm who you are. Try again in a moment.',
    unverified: 'Your Google account’s email isn’t verified, so Shohmot can’t use it. Sign up with your email instead.',
    off: 'Signing in with Google isn’t set up on this server yet. Use your email for now.',
  };

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

  if (params.has('google')) {
    say(GOOGLE_ERRORS[params.get('google')] || GOOGLE_ERRORS.failed);
    params.delete('google');
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
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
        // No database yet: point people at what works without an account.
        if (res.status === 503) status.insertAdjacentHTML('beforeend', ' Meanwhile, try the <a href="/demo.html">live demo</a> or the <a href="/review.html">free game review</a>.');
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
