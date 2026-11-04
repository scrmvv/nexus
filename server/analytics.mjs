import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_DAYS = 14;
const MAX_SOURCES_PER_DAY = 5000;
const MAX_PATHS_PER_DAY = 100;
const MAX_INCIDENTS = 80;
const DAY_MS = 86_400_000;
const dayKey = at => new Date(at).toISOString().slice(0, 10);
const hourKey = at => new Date(at).toISOString().slice(0, 13);
function top(map, n = 8) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}
function bump(map, key, amount = 1, limit = 500) {
  if (!key || typeof key !== 'string') return;
  if (!(key in map) && Object.keys(map).length >= limit) key = 'other';
  map[key] = (map[key] || 0) + amount;
}
function blank() { return { total: 0, suspicious: 0, bytes: 0, status: {}, paths: {}, countries: {}, hours: {}, agents: {}, clients: [] }; }
function unique(array) { return new Set(Array.isArray(array) ? array : []); }
export class Analytics {
  constructor(filename, { now = () => Date.now() } = {}) {
    this.filename = filename;
    this.now = now;
    this.days = {};
    this.incidents = [];
    this.dirty = false;
    this.timer = null;
    const folder = path.dirname(filename);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const keyPath = path.join(folder, '.analytics-key');
    if (!fs.existsSync(keyPath)) {
      try { fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    this.key = fs.readFileSync(keyPath);
    try {
      if (fs.statSync(filename).size <= 3_000_000) {
        const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (parsed?.version === 1 && parsed.days && typeof parsed.days === 'object') this.days = parsed.days;
        if (Array.isArray(parsed?.incidents)) this.incidents = parsed.incidents.slice(-MAX_INCIDENTS);
      }
    } catch (e) { if (e.code !== 'ENOENT') console.warn('[NEXUS] Could not load historical statistics:', e.message); }
    this.prune();
  }
  prune() {
    const cutoff = dayKey(this.now() - (MAX_DAYS - 1) * DAY_MS);
    for (const key of Object.keys(this.days)) if (!/^\d{4}-\d\d-\d\d$/.test(key) || key < cutoff) delete this.days[key];
  }
  fingerprint(ip, day) {
    return crypto.createHmac('sha256', this.key).update(`${day}|${ip}`).digest('hex').slice(0, 20);
  }
  record(item) {
    const day = dayKey(item.at);
    const b = this.days[day] ||= blank();
    b.total++;
    if (item.suspicious) b.suspicious++;
    b.bytes += item.bytes || 0;
    bump(b.status, String(item.status).slice(0, 1) + 'xx');
    bump(b.paths, item.path, 1, MAX_PATHS_PER_DAY);
    bump(b.agents, item.agent || 'Other', 1, 25);
    bump(b.hours, hourKey(item.at));
    const fp = this.fingerprint(item.ip, day);
    const sources = unique(b.clients);
    if (sources.size < MAX_SOURCES_PER_DAY) sources.add(fp);
    b.clients = [...sources];
    this.dirty = true;
  }
  addCountry(at, country) {
    const b = this.days[dayKey(at)];
    if (b && /^[A-Z]{2}$/.test(country || '')) { bump(b.countries, country, 1, 250); this.dirty = true; }
  }
  addIncident(event) {
    this.incidents.push({ ...event });
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.shift();
    this.dirty = true;
  }
  overview() {
    const now = this.now(), current = dayKey(now);
    const today = this.days[current] || blank();
    const recent = Array.from({ length: 24 }, (_, i) => {
      const at = now - (23 - i) * 3_600_000;
      const stamp = hourKey(at);
      return { hour: stamp, count: this.days[dayKey(at)]?.hours?.[stamp] || 0 };
    });
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = dayKey(now - (6 - i) * DAY_MS);
      return { date, count: this.days[date]?.total || 0, suspicious: this.days[date]?.suspicious || 0 };
    });
    return {
      today: { requests: today.total, uniqueSources: today.clients?.length || 0, suspicious: today.suspicious, bytes: today.bytes, status: today.status || {} },
      last24Hours: recent,
      last7Days: days,
      topPaths: top(today.paths), topCountries: top(today.countries), agents: top(today.agents),
      incidents: this.incidents.slice(-15).reverse(),
      retentionDays: MAX_DAYS,
    };
  }
  flush() {
    if (!this.dirty) return;
    this.prune();
    const tmp = this.filename + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, days: this.days, incidents: this.incidents }), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.filename);
      this.dirty = false;
    } catch (e) { console.warn('[NEXUS] Could not persist statistics:', e.message); }
  }
  start() { this.timer = setInterval(() => this.flush(), 20_000); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.flush(); }
}
