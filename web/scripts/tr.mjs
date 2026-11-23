// t() for modules that also run outside a page (the tests import them): the
// Uzbek line when the page has scripts/i18n.js and Uzbek is on, otherwise the
// English, with its {name}s filled in from params either way.
export function tr(s, params) {
  if (globalThis.shohmotT) return globalThis.shohmotT(s, params);
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}
