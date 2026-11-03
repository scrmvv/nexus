import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccessLine, sanitizePath, Metrics } from '../server/monitor.mjs';

test('parses standard nginx combined log and removes query tokens', () => {
  const event = parseAccessLine('203.0.113.12 - - [03/Nov/2026:20:21:43 +0500] "GET /portfolio?token=secret HTTP/1.1" 200 233 "-" "Mozilla/5.0"');
  assert.equal(event.method,'GET');
  assert.equal(event.path,'/portfolio');
  assert.equal(event.status,200);
  assert.equal(event.suspicious,false);
});
test('marks probing paths as suspicious', () => {
  const event = parseAccessLine('198.51.100.99 - - [03/Nov/2026:20:21:43 +0500] "GET /.env HTTP/1.1" 404 0 "-" "probe"');
  assert.equal(event.suspicious,true);
});
test('scrubs likely secret path segments',()=>{
  assert.equal(sanitizePath('/reset/abcdefghijklmnopqrstuvwxzy123456?key=mySecret'),'/reset/:token');
  assert.equal(sanitizePath('/thing/1234567890'),'/thing/:number');
});
test('excludes monitor self-check traffic',()=>{
  const line='127.0.0.1 - - [03/Nov/2026:20:21:43 +0500] \"GET / HTTP/1.1\" 200 34 \"-\" \"NEXUS-Monitor/1.0\"';
  assert.equal(parseAccessLine(line),null);
});
test('handles malformed logs without crashing',()=>{
  assert.equal(parseAccessLine('garbage'),null);
  assert.equal(parseAccessLine('notanip - - [x] "GET / HTTP/1.1" 200 1'),null);
});
test('samples local metrics',()=>{
  const metrics=new Metrics().sample();
  assert.ok(metrics.cpuPercent>=0&&metrics.cpuPercent<=100);
  assert.ok(metrics.memory.usedPercent>=0&&metrics.memory.usedPercent<=100);
  assert.ok(Number.isFinite(metrics.uptimeSec));
});
