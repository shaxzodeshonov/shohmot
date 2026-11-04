// The signed-in user, fast. The server sets a readable `shohmot_in=1` cookie
// next to the HttpOnly session cookie, so pages know at once whether someone is
// signed in (the inline script in Base.astro uses it to redirect before
// anything paints). The profile from the last visit is kept in localStorage,
// so the app can draw straight away while /api/me confirms it in the background.
const KEY = 'shohmot-me';
const FEATURES = 'shohmot-features';

function read(key = KEY) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function remember(user, features) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
    if (features) localStorage.setItem(FEATURES, JSON.stringify(features));
  } catch { /* private mode */ }
  for (const fn of listeners) fn(user);
}

export function forget() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// What the server can do: { mail, billing }. Last visit's answer until /api/me says.
export const features = () => read(FEATURES) || { mail: true, billing: false };

export const signedIn = () => document.cookie.split('; ').includes('shohmot_in=1');

// Pages that show the user (the app bar) hear about every change.
const listeners = new Set();
export function onUser(fn) { listeners.add(fn); }

function toSignIn() {
  location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  return new Promise(() => {}); // never settles: the page is leaving
}

let fresh = null;
// What the server says now. Sends the visitor to sign in if the session is gone
// (pass { optional: true } on pages that also work signed out).
export function freshUser({ optional = false } = {}) {
  fresh ||= fetch('/api/me', { cache: 'no-store' })
    .then(async (res) => {
      if (res.status === 401) { forget(); return optional ? null : toSignIn(); }
      if (!res.ok) return null;
      const { user, features: f } = await res.json();
      remember(user, f);
      return user;
    })
    .catch(() => null);
  return fresh;
}

// The user as fast as possible: last visit's copy if there is one, else the server's.
export function currentUser(opts) {
  const cached = read();
  freshUser(opts);
  return cached ? Promise.resolve(cached) : fresh;
}

export async function signOut() {
  forget();
  try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* cookies expire anyway */ }
  location.href = '/';
}

// POST JSON to the API; resolves to the parsed answer, throws Error(message) on failure.
export async function api(path, body) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch {
    throw new Error('Can’t reach Shohmot right now. Check your connection.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return out;
}
