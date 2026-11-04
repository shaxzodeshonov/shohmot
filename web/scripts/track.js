// Counts page views and a few actions, and reports script errors, to
// Shohmot's own /api/event (see src/events.js). No cookies, no third parties.
const ENDPOINT = '/api/event';

export function track(name, extra = {}) {
  try {
    const body = JSON.stringify({ name, ...extra });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
    fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* analytics must never break a page */ }
}

// A prerendered page (Speculation Rules) counts when it's actually shown.
function pageView() { track('page_view', { path: location.pathname }); }
if (document.prerendering) document.addEventListener('prerenderingchange', pageView, { once: true });
else pageView();

let errors = 0;
function report(message, where) {
  if (errors++ >= 3) return;
  track('client_error', { message: String(message || 'unknown').slice(0, 300), where: `${location.pathname} ${where || ''}`.slice(0, 200) });
}
addEventListener('error', (e) => report(e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : ''));
addEventListener('unhandledrejection', (e) => report(e.reason && (e.reason.message || e.reason), 'promise'));
