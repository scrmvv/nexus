import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGeoLookup, geoAttribution } from '../server/geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('published version matches the package and dashboard footer', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.ok(html.includes(`V ${packageJson.version}`), 'footer version must match package.json');
});

test('GeoIP module exports both functions required by the server', () => {
  assert.equal(typeof createGeoLookup, 'function');
  assert.equal(typeof geoAttribution, 'function');
  const result = geoAttribution('/var/lib/nexus/dbip-city-lite.mmdb');
  assert.deepEqual(result, { text: 'IP Geolocation by DB-IP', url: 'https://db-ip.com' });
});

test('logrotate example reloads nginx and does not hide postrotate errors', () => {
  const template = fs.readFileSync(path.join(ROOT, 'deploy', 'nexus-logrotate.conf'), 'utf8');
  assert.match(template, /postrotate[\s\S]*?systemctl reload nginx[\s\S]*?endscript/);
  assert.doesNotMatch(template, /\|\|\s*true/);
  assert.doesNotMatch(template, />\/dev\/null\s+2>&1/);
});
