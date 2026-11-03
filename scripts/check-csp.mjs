// Runs after `astro build`: every inline <script> in dist/ must have its
// hash in the Content-Security-Policy that vercel.json sends, or the browser
// will refuse to run it. If a page's inline script changed, this fails the
// build and prints the hash to put in vercel.json.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const dist = join(root, 'dist');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const csp = vercel.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value;
const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '';

const pages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);

const missing = new Map();
for (const file of pages(dist)) {
  const html = readFileSync(file, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc=/.test(attrs) || !body.trim()) continue;
    const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
    if (!scriptSrc.includes(hash)) missing.set(hash, relative(dist, file));
  }
}

if (missing.size) {
  console.error('Inline scripts the Content-Security-Policy in vercel.json would block:');
  for (const [hash, page] of missing) console.error(`  ${hash}  (first seen in ${page})`);
  console.error('Add these to script-src in vercel.json (and drop hashes no page uses any more).');
  process.exit(1);
}
console.log('CSP: every inline script is allowed.');
