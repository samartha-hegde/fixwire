import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FileMessageStore,
  FileStore,
  MemoryMessageStore,
  type StoredMessage,
  WriteThroughMessageStore,
  WriteThroughSeqStore,
} from '../src/index.js';

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

test('FileMessageStore persists sent messages across instances', () => {
  const path = join(tmpdir(), `fixwire-msgs-${process.pid}-${Date.now()}.jsonl`);
  try {
    const a = new FileMessageStore(path);
    a.put({ seq: 2, msgType: 'D', body: [[11, 'o-1']], sendingTime: '20240101-00:00:00.000' });
    a.put({ seq: 3, msgType: 'D', body: [[11, 'o-2']], sendingTime: '20240101-00:00:01.000' });

    const b = new FileMessageStore(path);
    assert.equal(b.get(2)?.body[0]?.[1], 'o-1');
    assert.equal(b.get(3)?.msgType, 'D');

    b.reset();
    assert.equal(new FileMessageStore(path).get(2), undefined);
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

test('message stores expose retained entries ordered by sequence', () => {
  const store = new MemoryMessageStore();
  store.put({ seq: 3, msgType: 'D', body: [[11, 'o-3']], sendingTime: 't3' });
  store.put({ seq: 1, msgType: 'A', body: [], sendingTime: 't1' });
  store.put({ seq: 2, msgType: 'D', body: [[11, 'o-2']], sendingTime: 't2' });
  const seqs = store.entries().map((m) => m.seq);
  assert.deepEqual(seqs, [1, 2, 3]);
});

test('WriteThroughSeqStore serves from memory and persists every change', () => {
  const saved: Array<{ out: number; in: number }> = [];
  const store = new WriteThroughSeqStore({ out: 5, in: 3 }, (s) => saved.push(s));
  assert.equal(store.getNextOut(), 5); // seeded from the backend state
  assert.equal(store.incrOut(), 5);
  assert.equal(store.getNextOut(), 6);
  store.setIn(4);
  assert.deepEqual(saved, [
    { out: 6, in: 3 },
    { out: 6, in: 4 },
  ]);
});

test('WriteThroughMessageStore seeds from initial and persists puts', () => {
  const saved: StoredMessage[] = [];
  const store = new WriteThroughMessageStore(
    [{ seq: 1, msgType: 'A', body: [], sendingTime: 't1' }],
    (m) => saved.push(m),
  );
  assert.equal(store.get(1)?.msgType, 'A'); // seeded
  store.put({ seq: 2, msgType: 'D', body: [[11, 'o']], sendingTime: 't2' });
  assert.equal(store.get(2)?.msgType, 'D');
  assert.deepEqual(
    store.entries().map((m) => m.seq),
    [1, 2],
  );
  assert.equal(saved.length, 1);
});
