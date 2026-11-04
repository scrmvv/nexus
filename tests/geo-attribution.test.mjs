import test from 'node:test';
import assert from 'node:assert/strict';
import { geoAttribution } from '../server/geo.mjs';

test('DB-IP Lite GeoIP usage includes public attribution without exposing the DB path', () => {
  const credit = geoAttribution('/home/anyuser/private/dbip-city-lite-2026-11.mmdb');
  assert.deepEqual(credit, { text: 'IP Geolocation by DB-IP', url: 'https://db-ip.com' });
  assert.ok(!JSON.stringify(credit).includes('/home/'));
  assert.equal(geoAttribution('/opt/nexus/data/GeoLite2-City.mmdb'), null);
  assert.equal(geoAttribution(''), null);
});
