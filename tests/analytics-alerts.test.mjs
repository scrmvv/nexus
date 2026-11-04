import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Analytics } from '../server/analytics.mjs';
import { Alerts } from '../server/alerts.mjs';
import { parseAccessLine, maskIP } from '../server/monitor.mjs';

const LOG = '203.0.113.64 - - [04/Nov/2026:09:10:02 +0000] "GET /.env?token=do-not-persist HTTP/1.1" 403 150 "https://referrer.test/private" "curl/8.5.0" rt=0.014';

test('extended log offers safe request metadata and masks full IP', () => {
  const item = parseAccessLine(LOG);
  assert.equal(item.suspicious, true);
  assert.equal(item.path, '/.env');
  assert.equal(item.source, '203.0.113.xxx');
  assert.equal(item.agent, 'curl');
  assert.equal(item.referrer, 'referrer.test');
  assert.equal(item.bytes, 150);
  assert.equal(item.durationMs, 14);
  assert.equal(maskIP('2001:db8:22:42::1'), '2001:db8:22:…');
});

test('statistics survive restart without storing original IP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-stats-'));
  try {
    const dest = path.join(dir, 'stats.json');
    let clock = Date.parse('2026-11-04T12:00:00Z');
    const store = new Analytics(dest, { now: () => clock });
    const item = { ...parseAccessLine(LOG), at: clock };
    store.record(item);
    store.record(item);
    store.addCountry(clock, 'DE');
    assert.equal(store.overview().today.requests, 2);
    assert.equal(store.overview().today.uniqueSources, 1);
    store.flush();
    const stored = fs.readFileSync(dest, 'utf8');
    assert.equal(stored.includes('203.0.113.64'), false);
    assert.equal(stored.includes('do-not-persist'), false);
    assert.equal(stored.includes('token='), false);
    const reloaded = new Analytics(dest, { now: () => clock });
    assert.equal(reloaded.overview().today.requests, 2);
    assert.equal(reloaded.overview().topCountries[0].name, 'DE');
    assert.equal(reloaded.overview().today.uniqueSources, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Telegram alerts group scan bursts, apply cooldown, and detect downtime/recovery', async () => {
  let now = Date.parse('2026-11-04T10:00:00Z');
  const delivered = [], incidents = [];
  const alerts = new Alerts({
    token: 'dummy', chatIds: '123', threshold: 3, now: () => now,
    send: async text => { delivered.push(text); }, onIncident: event => incidents.push(event),
  });
  const sample = parseAccessLine(LOG);
  alerts.onRequest(sample);alerts.onRequest(sample);
  assert.equal(delivered.length, 0);
  alerts.onRequest(sample);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].includes('203.0.113.64'), false);
  assert.equal(incidents[0].type, 'scan');
  alerts.onRequest(sample);
  assert.equal(delivered.length, 1);
  now += 20_000;
  alerts.onHealth('down', 'test-site');
  assert.equal(incidents.length, 1);
  alerts.onHealth('down', 'test-site');
  alerts.onHealth('up', 'test-site');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(incidents.length, 3);
  assert.equal(delivered.length, 3);
});
