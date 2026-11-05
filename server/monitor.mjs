import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_EVENTS = 90;
const HISTORY_POINTS = 48;
const ONE_MIN = 60_000;

export function sanitizePath(path) {
  if (typeof path !== 'string') return '/';
  let clean = path.split('?')[0].split('#')[0].slice(0, 180);
  clean = clean.replace(/[\r\n\t<>"']/g, '');
  clean = clean.replace(/[0-9a-f]{20,}/gi, ':id');
  clean = clean.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':uuid');
  clean = clean.replace(/\b\d{8,}\b/g, ':number');
  clean = clean.replace(/\/([A-Za-z0-9_-]{28,})(?=\/|$)/g, '/:token');
  return clean || '/';
}

export function maskIP(ip) {
  if (isIP(ip) === 4) return ip.replace(/\.\d+$/, '.xxx');
  if (isIP(ip) === 6) return ip.split(':').slice(0, 3).join(':') + ':…';
  return 'unknown';
}
export function classifyUserAgent(raw) {
  const ua = String(raw || '').slice(0, 300);
  if (/curl\//i.test(ua)) return 'curl';
  if (/python-requests|python-urllib|aiohttp/i.test(ua)) return 'Python client';
  if (/wget\//i.test(ua)) return 'wget';
  if (/bot|spider|crawler|censys|zgrab|masscan|nmap|httpx|gobuster|nikto|sqlmap/i.test(ua)) return 'Bot / scanner';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Other / unknown';
}
function referralHost(raw) {
  if (!raw || raw === '-') return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.slice(0, 80) : null;
  } catch { return null; }
}
// Recognize common probes even when path segments are URL-encoded.
// Decode only for classification; the public event keeps the sanitized path.
// Limit decoding rounds so malformed or adversarial input is cheap to process.
const PROBE_PATH = /(\/\.env(?:\b|$)|\/wp-admin\b|\/wp-login\b|\/\.git\b|\/phpmyadmin\b|\/cgi-bin\b|\/vendor\/phpunit\b|\/actuator\b|\/\.aws\b|\/\.svn\b|\/server-status\b)/i;
export function isProbingPath(path) {
  let candidate = String(path || '/').slice(0, 180);
  for (let round = 0; round < 4; round++) {
    if (PROBE_PATH.test(candidate)) return true;
    if (!candidate.includes('%')) break;
    let decoded;
    try { decoded = decodeURIComponent(candidate); }
    catch { break; }
    if (decoded === candidate) break;
    candidate = decoded;
  }
  return false;
}

export function parseAccessLine(line) {
  if (line.includes('"NEXUS-Monitor/1.0"')) return null;
  // nginx combined, optionally followed by rt=<request_time>.
  const m = line.match(/^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+rt=(\d+(?:\.\d+)?))?/);
  if (!m || !isIP(m[1])) return null;
  const [method = '-', rawPath = '/'] = m[3].split(/\s+/, 3);
  const status = Number(m[4]);
  const path = sanitizePath(rawPath);
  const suspicious = isProbingPath(path);
  const reason = suspicious ? 'known probing path' : null;
  const bytes = /^\d+$/.test(m[5]) ? Math.min(Number(m[5]), 1e12) : 0;
  const durationMs = m[8] != null ? Math.min(Math.round(Number(m[8]) * 1000), 3_600_000) : null;
  return {
    ip: m[1], source: maskIP(m[1]),
    method: method.slice(0, 12).replace(/[^A-Z]/g, '') || '-',
    path, status, suspicious, reason, bytes,
    agent: classifyUserAgent(m[7]), referrer: referralHost(m[6]), durationMs,
    at: Date.now(),
  };
}

function readMem() {
  try {
    const mem = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').map(l => {
      const m = l.match(/^([^:]+):\s+(\d+)\s+kB/);
      return m ? [m[1], Number(m[2]) * 1024] : [];
    }).filter(x => x.length));
    const total = mem.MemTotal || os.totalmem();
    const available = mem.MemAvailable ?? os.freemem();
    return { usedPercent: Math.round(100 * (total - available) / total), usedBytes: total - available, totalBytes: total };
  } catch {
    const total = os.totalmem();
    return { usedPercent: Math.round(100 * (total - os.freemem()) / total), usedBytes: total - os.freemem(), totalBytes: total };
  }
}
function readDisk() {
  try {
    const info = fs.statfsSync('/');
    const total = info.blocks * info.bsize;
    const free = info.bavail * info.bsize;
    return { usedPercent: Math.round((total - free) * 100 / Math.max(total, 1)), totalBytes: total, usedBytes: total - free };
  } catch { return { usedPercent: null, totalBytes: null, usedBytes: null }; }
}
function getCpuTimes() {
  return os.cpus().reduce((acc, cpu) => {
    for (const [name, value] of Object.entries(cpu.times)) {
      acc.total += value;
      if (name === 'idle') acc.idle += value;
    }
    return acc;
  }, { total: 0, idle: 0 });
}
function defaultNetInterface() {
  try {
    const routes = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1);
    const route = routes.map(line => line.trim().split(/\s+/)).find(parts => parts[1] === '00000000' && parts[0] !== 'lo');
    return route?.[0] || null;
  } catch { return null; }
}
function readNet(iface) {
  try {
    const rows = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    const found = rows.map(row => row.trim().split(/[:\s]+/)).find(parts => parts[0] === iface);
    return found ? { rx: Number(found[1]), tx: Number(found[9]) } : null;
  } catch { return null; }
}

export class Metrics {
  constructor() {
    this.cpuPrev = getCpuTimes();
    this.netInterface = defaultNetInterface();
    this.netPrev = this.netInterface ? readNet(this.netInterface) : null;
    this.netAt = Date.now();
    this.history = [];
  }
  sample() {
    const cpuNow = getCpuTimes();
    const total = cpuNow.total - this.cpuPrev.total;
    const idle = cpuNow.idle - this.cpuPrev.idle;
    const cpuPercent = total > 0 ? Math.min(100, Math.max(0, Math.round((1 - idle / total) * 100))) : 0;
    this.cpuPrev = cpuNow;
    const netNow = this.netInterface ? readNet(this.netInterface) : null;
    const now = Date.now();
    const seconds = Math.max((now - this.netAt) / 1000, .1);
    const rxBps = netNow && this.netPrev ? Math.max(0, (netNow.rx - this.netPrev.rx) / seconds) : 0;
    const txBps = netNow && this.netPrev ? Math.max(0, (netNow.tx - this.netPrev.tx) / seconds) : 0;
    this.netPrev = netNow;
    this.netAt = now;
    const result = {
      at: now,
      cpuPercent,
      memory: readMem(),
      disk: readDisk(),
      network: { rxBps: Math.round(rxBps), txBps: Math.round(txBps), interface: this.netInterface || '—' },
      uptimeSec: Math.round(os.uptime()),
      load: os.loadavg()[0],
    };
    this.history.push({ time: now, cpu: cpuPercent, ram: result.memory.usedPercent, rx: result.network.rxBps });
    if (this.history.length > HISTORY_POINTS) this.history.shift();
    return result;
  }
}

export async function serviceStatus(name) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', name], { timeout: 2500 });
    return stdout.trim() === 'active' ? 'up' : 'down';
  } catch (e) {
    if (e?.stdout) return e.stdout.toString().trim() === 'inactive' ? 'down' : 'unknown';
    return 'unknown';
  }
}

export async function siteStatus(url) {
  if (!url) return { status: 'unknown', code: null, latencyMs: null };
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(5500), headers: { 'User-Agent': 'NEXUS-Monitor/1.0' } });
    // Drain and release the connection without downloading the full page.
    await res.body?.cancel();
    return { status: res.status < 400 ? 'up' : 'down', code: res.status, latencyMs: Date.now() - start };
  } catch { return { status: 'down', code: null, latencyMs: null }; }
}

export class AccessLogTail {
  constructor(path, onLine, onState) {
    this.path = path;
    this.onLine = onLine;
    this.onState = onState;
    this.position = 0;
    this.inode = null;
    this.identity = null;
    this.handle = null;
    this.initialized = false;
    this.partial = '';
    this.timer = null;
    this.running = false;
    this.readable = false;
  }
  setReadable(value) {
    if (this.readable === value) return;
    this.readable = value;
    this.onState(value);
  }
  async readAvailable(handle) {
    const stat = await handle.stat();
    if (stat.size < this.position) {
      // copytruncate keeps the inode but resets the contents.
      this.position = 0;
      this.partial = '';
    }
    const MAX_BYTES = 1024 * 1024;
    let unread = stat.size - this.position;
    if (unread <= 0) return;
    // Preserve the newest log lines after a large burst rather than dropping
    // the entire batch. Skip the first (potentially incomplete) line.
    const skipPartialStart = unread > MAX_BYTES;
    if (skipPartialStart) {
      this.position = stat.size - MAX_BYTES;
      this.partial = '';
      unread = MAX_BYTES;
    }
    const buf = Buffer.allocUnsafe(unread);
    const { bytesRead } = await handle.read(buf, 0, unread, this.position);
    if (bytesRead <= 0) return;
    this.position += bytesRead;
    const parts = (this.partial + buf.subarray(0, bytesRead).toString('utf8')).split('\n');
    this.partial = (parts.pop() || '').slice(-1024);
    if (skipPartialStart) parts.shift();
    for (const line of parts.slice(-400)) this.onLine(line);
  }
  async poll() {
    if (this.running) return;
    this.running = true;
    let candidate = null;
    try {
      // Open first, then stat the descriptor. A rotation between stat(path)
      // and open(path) must not make us read a different inode at an old offset.
      candidate = await fs.promises.open(this.path, 'r');
      const stat = await candidate.stat();
      if (!stat.isFile()) throw new Error('Access log is not a regular file');
      const identity = `${stat.dev}:${stat.ino}`;
      if (identity !== this.identity) {
        if (this.handle) {
          // Drain anything written just before/while the old log was renamed.
          await this.readAvailable(this.handle);
          await this.handle.close();
        }
        this.handle = candidate;
        candidate = null;
        this.identity = identity;
        this.inode = stat.ino;
        this.position = this.initialized ? 0 : stat.size;
        this.initialized = true;
        this.partial = '';
      }
      this.setReadable(true);
      await this.readAvailable(this.handle);
    } catch {
      this.setReadable(false);
    } finally {
      if (candidate) await candidate.close().catch(() => {});
      this.running = false;
    }
  }
  start() {
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, 900);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.handle) {
      void this.handle.close().catch(() => {});
      this.handle = null;
    }
  }
}

export class Traffic {
  constructor(geoLookup, emit, analytics = null, alerts = null) {
    this.geoLookup = geoLookup;
    this.emit = emit;
    this.analytics = analytics;
    this.alerts = alerts;
    this.events = [];
    this.hits = [];
    this.allRequests = 0;
  }
  async record(line) {
    const item = parseAccessLine(line);
    if (!item) return;
    this.allRequests++;
    this.hits.push({ at: item.at, status: item.status });
    this.clean();
    const safe = {
      id: `${item.at}-${this.allRequests}`, at: item.at, method: item.method,
      path: item.path, status: item.status, suspicious: item.suspicious,
      source: item.source, agent: item.agent, referrer: item.referrer,
      bytes: item.bytes, durationMs: item.durationMs, geo: null,
    };
    this.analytics?.record(item);
    this.alerts?.onRequest(item);
    this.events.unshift(safe);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    this.emit({ type: 'access', data: safe });
    const geo = await this.geoLookup(item.ip);
    if (geo) {
      safe.geo = geo;
      if (geo.country) this.analytics?.addCountry(item.at, geo.country);
      this.emit({ type: 'geo', data: { id: safe.id, geo } });
    }
  }
  clean() {
    const cutoff = Date.now() - ONE_MIN;
    while (this.hits.length && this.hits[0].at < cutoff) this.hits.shift();
    if (this.hits.length > 30000) this.hits.splice(0, this.hits.length - 30000);
  }
  counters() {
    this.clean();
    return {
      rpm: this.hits.length,
      errors: this.hits.filter(x => x.status >= 400).length,
      totalSinceStart: this.allRequests,
    };
  }
}
