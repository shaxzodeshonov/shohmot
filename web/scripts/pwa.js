// Lets Shohmot be installed like an app (manifest in Base.astro) and gives it
// a service worker, which shows tilt notifications and opens the app when one
// is tapped. The worker caches nothing but an offline page.
import { track } from './track.js';

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
addEventListener('appinstalled', () => track('install'));
