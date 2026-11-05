import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccessLogTail } from '../server/monitor.mjs';

async function withLog(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-tail-'));
  const file = path.join(dir, 'site.access.log');
  const events = [];
  const states = [];
  const tail = new AccessLogTail(file, line => events.push(line), state => states.push(state));
  t.after(async () => {
    tail.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { file, events, states, tail };
}

test('first open skips history but subsequently reads appended lines exactly once', async t => {
  const { file, events, states, tail } = await withLog(t);
  await fs.writeFile(file, 'historical\n');
  await tail.poll();
  assert.deepEqual(events, []);
  await fs.appendFile(file, 'first\nsecond\n');
  await tail.poll();
  await tail.poll();
  assert.deepEqual(events, ['first', 'second']);
  assert.deepEqual(states, [true]);
});

test('rename/create rotation drains late writes to old inode and reads new log', async t => {
  const { file, events, tail } = await withLog(t);
  await fs.writeFile(file, 'historical\n');
  await tail.poll();
  await fs.appendFile(file, 'before-rotate\n');
  await tail.poll();

  const rotated = `${file}.1`;
  await fs.rename(file, rotated);
  await fs.appendFile(rotated, 'late-old-file\n');
  await fs.writeFile(file, 'first-new-file\n');
  await tail.poll();
  await fs.appendFile(file, 'second-new-file\n');
  await tail.poll();
  await tail.poll();
  assert.deepEqual(events, [
    'before-rotate', 'late-old-file', 'first-new-file', 'second-new-file',
  ]);
});

test('copytruncate rotation restarts at byte zero on the same inode', async t => {
  const { file, events, tail } = await withLog(t);
  await fs.writeFile(file, 'initial\n');
  await tail.poll();
  await fs.appendFile(file, 'long-entry-before-truncation\n');
  await tail.poll();
  await fs.writeFile(file, 'after\n');
  await tail.poll();
  assert.deepEqual(events, ['long-entry-before-truncation', 'after']);
});

test('temporary missing log reports unreadable and recovers without skipping new file', async t => {
  const { file, events, states, tail } = await withLog(t);
  await fs.writeFile(file, 'historical\n');
  await tail.poll();
  await fs.rename(file, `${file}.1`);
  await tail.poll();
  await fs.writeFile(file, 'written-while-recreated\n');
  await tail.poll();
  assert.deepEqual(events, ['written-while-recreated']);
  assert.deepEqual(states, [true, false, true]);
});

test('oversized batch retains recent complete lines instead of dropping everything', async t => {
  const { file, events, tail } = await withLog(t);
  await fs.writeFile(file, 'historical\n');
  await tail.poll();
  await fs.appendFile(file, 'z'.repeat(1024 * 1024 + 20) + '\nlatest\n');
  await tail.poll();
  assert.deepEqual(events, ['latest']);
});
