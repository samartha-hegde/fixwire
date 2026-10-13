import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { FileStore, MemoryMessageStore } from '../src/index.js';

test('FileStore persists sequence numbers across instances', () => {
  const path = join(tmpdir(), `fixwire-store-${process.pid}-${Date.now()}.json`);
  try {
    const a = new FileStore(path);
    assert.equal(a.incrOut(), 1);
    assert.equal(a.incrOut(), 2);
    a.setIn(5);

    // A fresh instance over the same file resumes where we left off.
    const b = new FileStore(path);
    assert.equal(b.getNextOut(), 3);
    assert.equal(b.getNextIn(), 5);

    b.reset();
    assert.equal(new FileStore(path).getNextOut(), 1);
  } finally {
    rmSync(path, { force: true });
  }
});

test('MemoryMessageStore stores and retrieves by sequence', () => {
  const store = new MemoryMessageStore();
  store.put({ seq: 2, msgType: 'D', body: [[11, 'o-1']], sendingTime: '20240101-00:00:00.000' });
  assert.equal(store.get(2)?.msgType, 'D');
  assert.equal(store.get(99), undefined);
  store.reset();
  assert.equal(store.get(2), undefined);
});
