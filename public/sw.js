// Shohmot's service worker. It lets the site be installed, shows the tilt
// guard's notifications (and opens the app when one is tapped), and shows a
// small offline page when there's no connection. It caches nothing else, so
// a deploy is never hidden behind an old copy.
const OFFLINE = 'shohmot-offline-v2';
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Shohmot</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1b140f;color:#efe1c6;font-family:system-ui,sans-serif;padding:1rem">
<div style="max-width:26rem"><h1 style="font-size:1.75rem;margin:0 0 .5rem">You’re offline</h1>
<p style="color:#b8a385;margin:0 0 1rem">Shohmot needs the internet to fetch your games. It will pick up where you left off once you’re back.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;background:#c6ceb2;color:#1d2417;border:0;border-radius:999px;padding:.6rem 1.1rem">Try again</button></div></body>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(OFFLINE).then((c) => c.put('/__offline', new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shohmot-offline') && k !== OFFLINE).map((k) => caches.delete(k)))),
    // Navigation preload: the browser asks for the page while this worker is
    // still starting up, so having a worker never slows a page down.
    self.registration.navigationPreload && self.registration.navigationPreload.enable(),
  ]).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      return (await e.preloadResponse) || (await fetch(e.request));
    } catch {
      return caches.match('/__offline');
    }
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname === url);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
