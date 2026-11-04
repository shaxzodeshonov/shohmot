// Serves the built site (dist/, from `npm run build`) and the API, like Vercel
// does. `npm start` builds and runs it; open http://localhost:3001.
// For working on the site, `npm run dev` (Astro, with live reload) is faster.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { dispatch } = require('./src/routes');

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC = path.join(__dirname, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// The headers vercel.json sets on every response (security headers and the
// Content-Security-Policy), read from there so the two never drift apart.
const SECURITY_HEADERS = Object.fromEntries(
  require('./vercel.json').headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]),
);

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    // Stockfish files and Astro's bundles have a version or hash in their name, so they never change.
    const cache = rel.startsWith('vendor/stockfish-') || rel.startsWith('_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (pathname.startsWith('/api/')) return await dispatch(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
    }
  }
}).listen(PORT, () => console.log(`Shohmot running at http://localhost:${PORT}`));
