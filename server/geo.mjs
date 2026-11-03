import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);

function isPublicIp(ip) {
  if (!isIP(ip)) return false;
  if (ip.includes(':')) return !(/^(::1|fc|fd|fe80|ff|::ffff:127\.)/i.test(ip));
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
}

function readNumber(output) {
  const m = output.match(/(-?\d+(?:\.\d+)?)\s*<(?:double|float|uint\d+|int\d+)>/i);
  return m ? Number(m[1]) : null;
}

export function createGeoLookup(database) {
  const enabled = Boolean(database && fs.existsSync(database));
  const cache = new Map();
  let active = 0;
  const queue = [];
  const runQueue = () => {
    if (!queue.length || active >= 3) return;
    active++;
    const task = queue.shift();
    task().finally(() => { active--; runQueue(); });
  };
  async function lookup(ip) {
    if (!enabled || !isPublicIp(ip)) return null;
    if (cache.has(ip)) return cache.get(ip);
    if (queue.length > 120) return null;
    // Promise is cached immediately to deduplicate concurrent lookups.
    const promise = new Promise(resolve => {
      queue.push(async () => {
        try {
          const opts = { timeout: 2800, maxBuffer: 4000 };
          const [latResult, lonResult] = await Promise.all([
            execAsync('mmdblookup', ['--file', database, '--ip', ip, 'location', 'latitude'], opts),
            execAsync('mmdblookup', ['--file', database, '--ip', ip, 'location', 'longitude'], opts),
          ]);
          const lat = readNumber(latResult.stdout);
          const lon = readNumber(lonResult.stdout);
          resolve(lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);
        } catch { resolve(null); }
      });
      runQueue();
    });
    cache.set(ip, promise);
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
    return promise;
  }
  return { enabled, lookup };
}
