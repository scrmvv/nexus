import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Metrics, AccessLogTail, Traffic, siteStatus, serviceStatus } from './monitor.mjs';
import { createGeoLookup } from './geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let v = match[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[match[1]] = v;
  }
}
loadDotEnv();
const PORT = Math.min(65535, Math.max(1025, Number(process.env.PORT || 4317)));
const SITE_URL = process.env.SITE_URL || 'https://scrmvv.space/';
const SITE_LABEL = (process.env.SITE_LABEL || 'scrmvv.space').slice(0, 64);
const VPS_LABEL = (process.env.VPS_LABEL || 'My VPS').slice(0, 64);
const LOG_PATH = process.env.NGINX_ACCESS_LOG || '/var/log/nexus/scrmvv.access.log';
const GEOIP_MMDB = process.env.GEOIP_MMDB || '';
const latitude = process.env.SERVER_LAT === undefined || process.env.SERVER_LAT === '' ? null : Number(process.env.SERVER_LAT);
const longitude = process.env.SERVER_LON === undefined || process.env.SERVER_LON === '' ? null : Number(process.env.SERVER_LON);
const serverGeo = latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { lat: latitude, lon: longitude } : null;
const geo = createGeoLookup(GEOIP_MMDB);
const metrics = new Metrics();
const subscribers = new Set();
let logReadable = false;
let currentMetrics = metrics.sample();
let services = { nginx: 'unknown', site: { status: 'unknown', code: null, latencyMs: null } };
let lastHealthCheck = null;

function writeSse(res, event) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
function broadcast(event) {
  for (const res of subscribers) {
    if (res.writableLength > 1024 * 1024) { subscribers.delete(res); res.destroy(); continue; }
    writeSse(res, event);
  }
}
const traffic = new Traffic(geo.lookup, broadcast);
const tail = new AccessLogTail(LOG_PATH, line => { void traffic.record(line); }, state => {
  logReadable = state;
  broadcast({ type: 'health', data: { logReadable } });
});

function snapshot() {
  return {
    metrics: currentMetrics,
    history: metrics.history,
    events: traffic.events,
    traffic: traffic.counters(),
    health: { ...services, logReadable, geoEnabled: geo.enabled, serverGeo, lastHealthCheck },
    config: { vpsLabel: VPS_LABEL, siteLabel: SITE_LABEL, siteUrl: SITE_URL },
    now: Date.now(),
  };
}
function sendJson(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'");
  const route = new URL(req.url || '/', 'http://localhost/').pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, { error: 'Method not allowed' }, 405);
  if (route === '/api/state') return sendJson(res, snapshot());
  if (route === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    writeSse(res, { type: 'snapshot', data: snapshot() });
    subscribers.add(res);
    const ping = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 20000);
    req.on('close', () => { clearInterval(ping); subscribers.delete(res); });
    return;
  }
  if (route.startsWith('/api/')) return sendJson(res, { error: 'Not found' }, 404);
  // Only serve known assets from client/; no raw server/config files.
  const safe = route === '/' ? '/index.html' : route;
  let absolute;
  try { absolute = path.resolve(CLIENT, '.' + decodeURIComponent(safe)); }
  catch { res.writeHead(400); res.end(); return; }
  if (!absolute.startsWith(CLIENT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(absolute, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(absolute)] || 'application/octet-stream',
      'Cache-Control': /\.html$/.test(absolute) ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(absolute).pipe(res);
  });
});

const metricTimer = setInterval(() => {
  currentMetrics = metrics.sample();
  broadcast({ type: 'metrics', data: { metrics: currentMetrics, traffic: traffic.counters(), history: metrics.history } });
}, 2000);
const serviceTimer = setInterval(checkHealth, 15000);
async function checkHealth() {
  const [nginx, site] = await Promise.all([serviceStatus('nginx'), siteStatus(SITE_URL)]);
  services = { nginx, site };
  lastHealthCheck = Date.now();
  broadcast({ type: 'health', data: { ...services, logReadable, geoEnabled: geo.enabled, serverGeo, lastHealthCheck } });
}
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[NEXUS] http://127.0.0.1:${PORT}`);
  console.log(`[NEXUS] Site: ${SITE_LABEL} | Log: ${LOG_PATH} | Local GeoIP: ${geo.enabled ? 'on' : 'off'}`);
  tail.start();
  void checkHealth();
});
function shutdown() {
  clearInterval(metricTimer); clearInterval(serviceTimer);
  tail.stop();
  for (const client of subscribers) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
