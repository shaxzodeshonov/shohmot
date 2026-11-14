// "What to work on" after a game: the card on the Training page for the newest
// checked game with mistakes, and the dot on Training in the sidebar that says
// there's a new one. The dot goes once you've opened Training; the card stays
// until you dismiss it (or a newer game takes its place).
import { latestUnseen } from './store.mjs';
import { LABELS } from '../review/analysis.mjs';

const ACK = 'shohmot-train-dot';
const DAY = 86400000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const since = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - DAY; }; // yesterday and today

export const latestNews = (accounts) => (accounts && accounts.length ? latestUnseen(accounts, since()) : null);

const acked = () => { try { return localStorage.getItem(ACK) || ''; } catch { return ''; } };
// Is there a game you haven't seen on the Training page yet?
export function hasNews(accounts) {
  const nw = latestNews(accounts);
  return !!nw && nw.key !== acked();
}
export function ackNews(accounts) {
  const nw = latestNews(accounts);
  if (!nw) return;
  try { localStorage.setItem(ACK, nw.key); } catch { /* private mode */ }
  document.dispatchEvent(new Event('shohmot:news'));
}

export function newsCardHtml(accounts) {
  const nw = latestNews(accounts);
  if (!nw || !nw.items.length) return '';
  const g = nw.g;
  const counts = {};
  for (const it of nw.items) counts[it.label] = (counts[it.label] || 0) + 1;
  const name = (l, n) => { const one = LABELS[l].name.toLowerCase(); return `${n} ${n === 1 ? one : `${one}${l === 'miss' ? 'es' : 's'}`}`; };
  const summary = ['blunder', 'mistake', 'miss'].filter((l) => counts[l]).map((l) => name(l, counts[l])).join(', ');
  const head = g.r === 'loss' ? `You lost to ${g.o}. Here’s what to work on.` : `Your game vs ${g.o}: room to improve.`;
  const list = nw.items.slice(0, 3).map((it) => {
    const no = `${Math.ceil(it.ply / 2)}${it.ply % 2 ? '.' : '…'}`;
    return `<li><b class="nw-move" data-l="${it.label}">${no} ${esc(it.san)}${LABELS[it.label].mark}</b> ${esc(it.why)} <span class="muted">Better was <b>${esc(it.bestSan)}</b>.</span></li>`;
  }).join('');
  const qs = new URLSearchParams({ p: nw.platform, u: g.u || '', id: nw.id, t: String(g.e), ply: String(nw.items[0].ply) });
  return `<div class="banner needs-work">
    <div class="nw-body"><p><b>${esc(head)}</b> ${esc(summary)}${g.acc != null ? ` · accuracy ${Math.round(g.acc)}` : ''}.</p><ol class="nw-list">${list}</ol></div>
    <div class="banner-actions">
      <a class="btn btn-solid" href="/train.html?game=${encodeURIComponent(nw.key)}" data-astro-prefetch="false">Train ${nw.items.length === 1 ? 'this position' : `these ${nw.items.length} positions`}</a>
      <a class="btn" href="/review.html?${esc(qs.toString())}" data-astro-prefetch="false">Full review</a>
      <button class="btn" type="button" data-seen="${esc(nw.key)}">Dismiss</button>
    </div></div>`;
}
