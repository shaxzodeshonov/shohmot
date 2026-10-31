// The signed-in user, fast. The server sets a readable `shohmot_in=1` cookie
// next to the HttpOnly session cookie, so pages know at once whether someone is
// signed in (the inline script in Base.astro uses it to redirect before
// anything paints). The profile from the last visit is kept in localStorage,
// so the app can draw straight away while /api/me confirms it in the background.
const KEY = 'shohmot-me';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function remember(user) {
  try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* private mode */ }
}

export function forget() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export const signedIn = () => document.cookie.split('; ').includes('shohmot_in=1');

function toSignIn() {
  location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  return new Promise(() => {}); // never settles: the page is leaving
}

let fresh = null;
// What the server says now. Sends the visitor to sign in if the session is gone.
export function freshUser() {
  fresh ||= fetch('/api/me', { cache: 'no-store' })
    .then(async (res) => {
      if (res.status === 401) { forget(); return toSignIn(); }
      if (!res.ok) return null;
      const { user } = await res.json();
      remember(user);
      return user;
    })
    .catch(() => null);
  return fresh;
}

// The user as fast as possible: last visit's copy if there is one, else the server's.
export function currentUser() {
  const cached = read();
  freshUser();
  return cached ? Promise.resolve(cached) : fresh;
}

export async function signOut() {
  forget();
  try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* cookies expire anyway */ }
  location.href = '/';
}
