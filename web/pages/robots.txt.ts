import { SITE } from '../data/site';

// Account pages and the API are of no use to search engines.
export function GET() {
  const off = ['/api/', '/app.html', '/settings.html', '/train.html', '/brilliants.html', '/coach.html', '/join.html', '/admin.html', '/reset.html', '/verify.html', '/forgot.html'];
  return new Response(`User-agent: *\n${off.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${SITE.url}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
}
