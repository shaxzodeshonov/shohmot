// Light or dark. The choice ('dark', 'light' or 'system') is kept in this
// browser, and with none saved the page follows the device; Base.astro's inline script reads it before the first paint, and
// this keeps the page, the sun/moon buttons ([data-theme-toggle]) and the
// choice in Settings (radios named "theme") in step afterwards.
const KEY = 'shohmot-theme';
const COLORS = { dark: '#0d1712', light: '#f3f0df' }; // the browser's own bars (theme-color)
const device = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function getChoice() {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
const resolve = (choice) => (choice === 'system' ? (device && device.matches ? 'light' : 'dark') : choice);

export function apply(choice = getChoice()) {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = COLORS[theme];
  const other = theme === 'light' ? 'dark' : 'light';
  for (const b of document.querySelectorAll('[data-theme-toggle]')) { b.setAttribute('aria-label', `Switch to the ${other} theme`); b.title = `Switch to the ${other} theme`; }
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === choice;
}

export function setChoice(choice) {
  try { localStorage.setItem(KEY, choice); } catch { /* blocked storage: it lasts for this page */ }
  apply(choice);
}

document.addEventListener('click', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('[data-theme-toggle]')) return;
  setChoice(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
document.addEventListener('change', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.name === 'theme') setChoice(e.target.value);
});
// Following the device: switch when it does. Another tab changed it: follow that too.
if (device) device.addEventListener('change', () => { if (getChoice() === 'system') apply(); });
addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
apply();
