// Shohmot in English or Uzbek. The pages and scripts are written in English;
// in Uzbek this swaps every piece of English the visitor can see for its
// Uzbek line from web/i18n/uz.mjs: the page as it arrives, then anything a
// script draws later (a MutationObserver), plus titles, tooltips, labels,
// placeholders and confirm()/alert()/prompt() messages.
//
// The dictionary is keyed by the English exactly as it shows, whitespace
// collapsed. Numbers in a line are matched by %n (so "3 losses" finds
// "%n losses"; %1, %2… place them in another order). A run of text with
// links or bold bits inside is one line, the inner elements written {0}, {1}…
// in order (their own text is looked up on its own), so a sentence keeps its
// words together and can be reordered.
//
// The choice ('en' or 'uz') is kept in this browser; with none saved, a device
// set to Uzbek gets Uzbek. Base.astro's inline script reads the same key before
// the first paint and hides the page (at most 2.5 s) until the Uzbek is in.
// Scripts that build sentences around dates or names import t() from here:
// importing this module waits for the dictionary.

const KEY = 'shohmot-lang';
export const LANGS = { en: 'English', uz: 'O‘zbekcha' };

export function getLang() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'uz') return v;
  } catch { /* blocked storage: follow the device */ }
  return /^uz\b/i.test(navigator.language || '') ? 'uz' : 'en';
}

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* blocked storage */ }
  location.reload();
}

export const lang = getLang();
const root = document.documentElement;
root.lang = lang;

let dict = null;

// ---------- lookup ----------
const NUM = /(?<![\d{])\d+(?:[.,:]\d+)*(?![\d}])/g; // not the {0}s of a mixed line
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const debug = (() => { try { return !!localStorage.getItem('shohmot-i18n-debug'); } catch { return false; } })();
const missing = new Set();
// Translators: localStorage['shohmot-i18n-debug'] = 1 collects every line with
// no Uzbek yet, across pages, in localStorage['shohmot-i18n-missing'].
if (debug) {
  const MISS = 'shohmot-i18n-missing';
  const save = () => {
    try { localStorage.setItem(MISS, JSON.stringify([...new Set([...JSON.parse(localStorage.getItem(MISS) || '[]'), ...missing])].sort())); } catch { /* full */ }
  };
  setInterval(save, 1500);
  addEventListener('pagehide', save);
  window.__i18n = { missing, dump: () => JSON.parse(localStorage.getItem(MISS) || '[]').join('\n') };
}

// Moves and squares in a line (Nxe4, O-O, f7) are matched by %s, like numbers.
const SAN = /(?<![\w-])(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8])(?:=[QRBN])?[+#]?(?![\w-])/g;
const general = (s) => s.replace(SAN, '%s').replace(NUM, '%n');

function lookup(s) {
  if (!dict) return null;
  const hit = dict[s];
  if (hit !== undefined) return hit;
  const g = general(s);
  if (g === s) return null;
  const line = dict[g];
  if (line === undefined) return null;
  const moves = s.match(SAN) || [];
  const nums = s.replace(SAN, '').match(NUM) || [];
  let i = 0;
  let j = 0;
  return line.replace(/%(n|s|[1-9])/g, (m, k) => (k === 'n' ? nums[i++] : k === 's' ? moves[j++] : nums[k - 1]) ?? m);
}

// Worth translating: has words, not just moves (Nf3, e4, O-O-O) and numbers.
const worth = (s) => /[A-Za-z]{2}/.test(general(s).replace(/%[ns]/g, ' '));

function miss(s) {
  if (debug) missing.add(general(s));
}

/** The Uzbek for an English line (or the line itself), with {name}s filled from params. */
export function t(s, params) {
  let out = s;
  if (dict) {
    const hit = lookup(s);
    if (hit != null) out = hit; else if (worth(s)) miss(s);
  }
  return params ? out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : out;
}

// ---------- the page ----------
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'TEMPLATE']);
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip'];
const written = new WeakMap(); // node -> what we last wrote (text, or the line of a mixed element)
const writtenAttr = new WeakMap(); // element -> Map(attribute -> value we wrote)

const skipped = (el) => SKIP.has(el.nodeName) || el.closest('[translate="no"], [contenteditable=""], [contenteditable="true"]');

function translateAttrs(el, only) {
  for (const a of only ? [only] : ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const mine = writtenAttr.get(el);
    if (mine && mine.get(a) === v) continue;
    const s = norm(v);
    if (!worth(s)) continue;
    const out = lookup(s);
    if (out == null) { miss(s); continue; }
    if (!mine) writtenAttr.set(el, new Map([[a, out]])); else mine.set(a, out);
    el.setAttribute(a, out);
  }
  if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && (!only || only === 'value')) {
    const v = el.value;
    const out = worth(v) && written.get(el) !== v ? lookup(norm(v)) : null;
    if (out != null) { written.set(el, out); el.value = out; }
  }
}

function translateText(node) {
  const raw = node.nodeValue;
  if (written.get(node) === raw) return;
  const s = norm(raw);
  if (!worth(s)) return;
  const out = lookup(s);
  if (out == null) { miss(s); return; }
  const next = raw.match(/^\s*/)[0] + out + raw.match(/\s*$/)[0];
  written.set(node, next);
  if (next !== raw) node.nodeValue = next;
}

// Icons and other wordless bits at either end of an element stay where they
// are, outside its line.
const decor = (n) => n.nodeType === 8
  || (n.nodeType === 3 && !n.nodeValue.trim())
  || (n.nodeType === 1 && (n.nodeName === 'svg' || n.nodeName === 'IMG' || n.nodeName === 'BR' || n.hasAttribute('hidden') || !n.textContent.trim()));

// An element with words of its own and elements among them: one line.
function translateMixed(el) {
  const kids = [...el.childNodes];
  let a = 0;
  let b = kids.length - 1;
  while (a <= b && decor(kids[a])) a++;
  while (b >= a && decor(kids[b])) b--;
  const part = kids.slice(a, b + 1).filter((n) => n.nodeType !== 8);
  const els = part.filter((n) => n.nodeType === 1);
  if (!els.length || !part.some((n) => n.nodeType === 3 && /[A-Za-z]{2}/.test(n.nodeValue))) return false;
  const line = norm(part.map((n) => (n.nodeType === 3 ? n.nodeValue : `{${els.indexOf(n)}}`)).join(''));
  if (written.get(el) === line) return true;
  const out = lookup(line);
  if (out == null) { miss(line); return false; }
  const first = part[0];
  const last = part[part.length - 1];
  const lead = first.nodeType === 3 ? first.nodeValue.match(/^\s*/)[0] : '';
  const trail = last.nodeType === 3 ? last.nodeValue.match(/\s*$/)[0] : '';
  const frag = document.createDocumentFragment();
  out.split(/(\{\d+\})/).forEach((bit, i, all) => {
    const m = bit.match(/^\{(\d+)\}$/);
    if (m && els[m[1]]) { frag.append(els[m[1]]); return; }
    const text = (i === 0 ? lead : '') + bit + (i === all.length - 1 ? trail : '');
    if (text) frag.append(text);
  });
  const anchor = kids[b + 1] || null;
  for (const n of part) if (n.parentNode === el) n.remove();
  el.insertBefore(frag, anchor && anchor.parentNode === el ? anchor : null);
  written.set(el, norm(out));
  return true;
}

function translateTree(node) {
  if (node.nodeType === 3) {
    if (node.parentElement && !skipped(node.parentElement)) translateText(node);
    return;
  }
  if (node.nodeType !== 1 || skipped(node)) return;
  const walk = (el) => {
    if (SKIP.has(el.nodeName) || el.getAttribute('translate') === 'no' || el.isContentEditable) return;
    translateAttrs(el);
    const mixed = translateMixed(el);
    for (const c of [...el.childNodes]) {
      if (c.nodeType === 1) walk(c);
      else if (c.nodeType === 3 && !mixed) translateText(c);
    }
  };
  walk(node);
}

function onMutations(list) {
  const again = new Set();
  for (const m of list) {
    if (m.type === 'attributes') {
      if (m.target.isConnected && !skipped(m.target)) translateAttrs(m.target, m.attributeName);
    } else if (m.type === 'characterData') {
      const p = m.target.parentElement;
      if (p && m.target.isConnected) again.add(p);
    } else {
      // New children: the element may now be one mixed line, so look at it whole
      // (its other children are skipped quickly: they're marked as done).
      if (m.target.isConnected) again.add(m.target);
    }
  }
  for (const el of again) if (!skipped(el)) translateTree(el);
}

// ---------- dates in Uzbek ----------
// Browsers carry little or no Uzbek date data (Chromium writes "M11 23, Mon"),
// so dates the scripts format with the visitor's default locale are written
// here: "23-noyabr", "Dush, 23-noy 2026", "14:05", "5 daqiqa oldin".
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const DAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
const DAYS_SHORT = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const DATE_KEYS = ['weekday', 'year', 'month', 'day', 'hour', 'minute', 'second'];

class UzDateFormat {
  constructor(opts = {}, fallback = { year: 'numeric', month: 'numeric', day: 'numeric' }) {
    this.o = DATE_KEYS.some((k) => k in opts) ? opts : { ...fallback, timeZone: opts.timeZone };
    this.parts = new Intl.DateTimeFormat('en-US', {
      timeZone: opts.timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    });
  }

  format(date = Date.now()) {
    const o = this.o;
    const p = {};
    for (const { type, value } of this.parts.formatToParts(date)) p[type] = value;
    const m = Number(p.month) - 1;
    let day = '';
    if (o.month === 'numeric' || o.month === '2-digit') day = [o.day && pad(p.day), pad(p.month), o.year && p.year].filter(Boolean).join('.');
    else if (o.month) {
      const name = (o.month === 'long' ? MONTHS : MONTHS_SHORT)[m];
      day = o.day ? `${Number(p.day)}-${name}` : cap(name);
      if (o.year) day += ` ${p.year}`;
    } else if (o.day) day = String(Number(p.day));
    else if (o.year) day = p.year;
    const w = WD.indexOf(p.weekday);
    const wd = o.weekday ? (o.weekday === 'long' ? DAYS : DAYS_SHORT)[w] : '';
    let out = wd && day ? `${wd}, ${day}` : wd || day;
    if (o.hour || o.minute) {
      const time = [pad(Number(p.hour) % 24), o.minute && pad(p.minute), o.second && pad(p.second)].filter(Boolean).join(':');
      out = out ? `${out}, ${time}` : time;
    }
    return out;
  }

  formatToParts(date) { return [{ type: 'literal', value: this.format(date) }]; }
  resolvedOptions() { return { ...this.parts.resolvedOptions(), ...this.o, locale: 'uz' }; }
}

const UNITS = { second: 'soniya', minute: 'daqiqa', hour: 'soat', day: 'kun', week: 'hafta', month: 'oy', quarter: 'chorak', year: 'yil' };
const NEAR = {
  second: { 0: 'hozir' }, day: { '-1': 'kecha', 0: 'bugun', 1: 'ertaga' },
  week: { '-1': 'o‘tgan hafta', 0: 'shu hafta', 1: 'keyingi hafta' },
  month: { '-1': 'o‘tgan oy', 0: 'shu oy', 1: 'keyingi oy' },
  year: { '-1': 'o‘tgan yil', 0: 'shu yil', 1: 'keyingi yil' },
};
class UzRelativeFormat {
  constructor(opts = {}) { this.o = opts; }
  format(v, unit) {
    const u = String(unit).replace(/s$/, '');
    if (this.o.numeric === 'auto' && NEAR[u] && NEAR[u][v] !== undefined) return NEAR[u][v];
    const n = Math.abs(v);
    return v < 0 || Object.is(v, -0) ? `${n} ${UNITS[u]} oldin` : `${n} ${UNITS[u]}dan keyin`;
  }
  formatToParts(v, unit) { return [{ type: 'literal', value: this.format(v, unit) }]; }
  resolvedOptions() { return { locale: 'uz', ...this.o }; }
}

// Installed before the dictionary loads (no await above this point), so
// scripts that run meanwhile get Uzbek dates and the same t() too.
globalThis.shohmotT = t;
if (lang === 'uz') {
  // Scripts that don't name a locale get the Uzbek dates above. Numbers keep
  // their English grouping, which some scripts read back.
  const DTF = Intl.DateTimeFormat;
  const RTF = Intl.RelativeTimeFormat;
  Intl.DateTimeFormat = new Proxy(DTF, {
    construct: (T, [loc, opts]) => (loc == null ? new UzDateFormat(opts) : new T(loc, opts)),
    apply: (T, self, [loc, opts]) => (loc == null ? new UzDateFormat(opts) : T(loc, opts)),
  });
  Intl.RelativeTimeFormat = new Proxy(RTF, {
    construct: (T, [loc, opts]) => (loc == null ? new UzRelativeFormat(opts) : new T(loc, opts)),
  });
  const FALLBACK = {
    toLocaleString: { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' },
    toLocaleDateString: { year: 'numeric', month: 'numeric', day: 'numeric' },
    toLocaleTimeString: { hour: 'numeric', minute: 'numeric' },
  };
  for (const m of Object.keys(FALLBACK)) {
    const orig = Date.prototype[m];
    Date.prototype[m] = function (loc, opts) { return loc == null ? new UzDateFormat(opts, FALLBACK[m]).format(this) : orig.call(this, loc, opts); };
  }
  const { alert: al, confirm: co, prompt: pr } = window;
  window.alert = (msg) => al.call(window, t(String(msg ?? '')));
  window.confirm = (msg) => co.call(window, t(String(msg ?? '')));
  window.prompt = (msg, def) => pr.call(window, t(String(msg ?? '')), def);
  try { dict = (await import('../i18n/uz.mjs')).default; } catch { dict = null; }
}

if (dict) {
  translateTree(root);
  new MutationObserver(onMutations).observe(root, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value'],
  });
}
delete root.dataset.i18n;

// Pickers ([name="lang"] radios or selects) switch the language.
document.addEventListener('change', (e) => {
  const el = e.target;
  if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name === 'lang' && el.value !== lang) setLang(el.value);
});
const showChoice = () => {
  for (const el of document.querySelectorAll('input[name="lang"]')) el.checked = el.value === lang;
  for (const el of document.querySelectorAll('select[name="lang"]')) el.value = lang;
};
showChoice();
document.addEventListener('DOMContentLoaded', showChoice);
