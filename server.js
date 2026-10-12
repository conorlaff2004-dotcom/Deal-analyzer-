// Tiny zero-dependency server: serves the app and proxies the area-data APIs
// for browsers that block cross-origin requests. Run: npm start
const http = require('http');
const fs = require('fs');
const path = require('path');

const { fetchNews } = require('./scripts/news.js');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const ALLOWED_HOSTS = new Set(['api.postcodes.io', 'landregistry.data.gov.uk', 'api.propertydata.co.uk', 'ws.cso.ie']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function proxy(req, res, target) {
  let url;
  try { url = new URL(target); } catch { return send(res, 400, 'Bad url'); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return send(res, 403, 'Host not allowed');
  try {
    const upstream = await fetch(url, { headers: { Accept: req.headers.accept || 'application/json' } });
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    send(res, 502, 'Upstream error: ' + e.message);
  }
}

// Headlines change slowly; refetch at most once an hour.
let newsCache = null;
async function news(res) {
  if (!newsCache || Date.now() - newsCache.at > 3600e3) newsCache = { at: Date.now(), body: JSON.stringify(await fetchNews()) };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(newsCache.body);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/proxy') return proxy(req, res, u.searchParams.get('url'));
  if (u.pathname === '/news.json') return news(res).catch((e) => send(res, 502, e.message));
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.includes('node_modules')) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Deal analyzer running at http://localhost:${PORT}`));
