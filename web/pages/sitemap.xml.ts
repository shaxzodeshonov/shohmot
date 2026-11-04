// The public pages, for search engines. Account pages are left out (they
// also carry noindex).
import { SITE } from '../data/site';
import { FEATURES } from '../data/features';

const PAGES = ['/', '/demo.html', '/review.html', '/analysis.html', '/signup.html', '/privacy.html', '/terms.html', '/licenses.html', ...FEATURES.map((f) => `/features/${f.slug}.html`)];

export function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = PAGES.map((p) => `  <url><loc>${SITE.url}${p}</loc><lastmod>${today}</lastmod>${p === '/' ? '<priority>1.0</priority>' : ''}</url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { 'Content-Type': 'application/xml' } });
}
