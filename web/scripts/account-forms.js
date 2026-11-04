// Forgot password, reset password and confirm email. Tokens come in the
// link's #hash, which never reaches a server log or another site's Referer.
import { api, remember } from './session.js';

const form = document.querySelector('#acct-form');
const status = document.querySelector('#auth-status');
const mode = form.dataset.mode;
const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
// Keep the token out of history and screenshots once it's read.
if (token) history.replaceState(null, '', location.pathname);

function say(msg, kind = 'bad') {
  status.textContent = msg;
  status.dataset.kind = kind;
}

for (const btn of document.querySelectorAll('[data-reveal]')) {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.reveal);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-pressed', String(show));
  });
}

if (mode === 'verify') {
  const title = document.querySelector('#verify-title');
  if (!token) {
    title.textContent = 'That link is incomplete';
    say('Open the link from the email again, or send a new one from Settings.');
  } else {
    api('/api/account', { action: 'verify', token })
      .then(({ email }) => {
        title.textContent = 'Email confirmed';
        say(`${email} is confirmed. Thanks!`, 'ok');
        document.querySelector('#verify-next').hidden = false;
      })
      .catch((err) => { title.textContent = 'That link didn’t work'; say(err.message); });
  }
} else {
  const submit = form.querySelector('button[type="submit"]');
  if (mode === 'reset' && !token) {
    say('This page needs the link from your email. Ask for a new one if it expired.');
    submit.disabled = true;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    say(mode === 'forgot' ? 'Sending…' : 'Saving…', 'busy');
    try {
      if (mode === 'forgot') {
        const out = await api('/api/account', { action: 'forgot', email: data.email });
        say(out.message, 'ok');
        return; // leave the button off: one email is enough
      }
      const out = await api('/api/account', { action: 'reset', token, password: data.password });
      remember(out.user);
      say('Password changed. Signing you in…', 'ok');
      location.replace('/app.html');
    } catch (err) {
      say(err.message);
      submit.disabled = false;
    }
  });
}
