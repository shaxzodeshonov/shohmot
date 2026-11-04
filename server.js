// Serves the built site (dist/, from `npm run build`) and the API, like Vercel
// does. `npm start` builds and runs it; open http://localhost:3001.
// For working on the site, `npm run dev` (Astro, with live reload) is faster.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

// Text files are sent compressed, as Vercel does: brotli when the browser takes
// it, else gzip. Each file is compressed once and kept until it changes.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.xml', '.txt', '.wasm']);
const packed = new Map(); // `${file}:${encoding}` -> { mtimeMs, body }
function compressed(file, st, encoding) {
  const key = `${file}:${encoding}`;
  const hit = packed.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.body;
  const raw = fs.readFileSync(file);
  const body = encoding === 'br'
    ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    : zlib.gzipSync(raw, { level: 9 });
  packed.set(key, { mtimeMs: st.mtimeMs, body });
  return body;
}
function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '');
  return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
}

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
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache };
    const encoding = COMPRESSIBLE.has(path.extname(file)) && st.size > 1024 ? pickEncoding(req) : null;
    if (encoding) {
      const body = compressed(file, st, encoding);
      res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length, Vary: 'Accept-Encoding' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
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
