// Local server for Shohmot. On Vercel, public/ is served statically and the
// files in api/ run as functions; this does the same thing on your machine.
// Run with `npm start` and open http://localhost:3001
const http = require('http');
const fs = require('fs');
const path = require('path');
const handlers = require('./src/handlers');

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }
    if (pathname === '/api/state') return await handlers.state(req, res);
    if (pathname === '/api/check') return await handlers.check(req, res);
    serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
    }
  }
}).listen(PORT, () => console.log(`Shohmot running at http://localhost:${PORT}`));
