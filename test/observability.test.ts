import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachLogger, attachMetrics, FixMessage, Session } from '../src/index.js';

const newSession = () =>
  new Session({ senderCompId: 'C', targetCompId: 'S', host: '127.0.0.1', port: 1 });

test('attachLogger bridges events to a structured logger', () => {
  const calls: Array<{ level: string; obj: Record<string, unknown> }> = [];
  const logger = {
    info: (obj: object) => calls.push({ level: 'info', obj: obj as Record<string, unknown> }),
    warn: (obj: object) => calls.push({ level: 'warn', obj: obj as Record<string, unknown> }),
    error: (obj: object) => calls.push({ level: 'error', obj: obj as Record<string, unknown> }),
  };
  const session = newSession();
  const detach = attachLogger(session, logger);

  session.emit('logon', new FixMessage([[35, 'A']]));
  session.emit('reject', new FixMessage([[58, 'bad field']]));
  session.emit('reconnecting', 2, 500);
  session.emit('error', new Error('boom'));

  assert.ok(calls.some((c) => c.level === 'info' && c.obj.event === 'logon'));
  assert.ok(
    calls.some((c) => c.level === 'warn' && c.obj.event === 'reject' && c.obj.text === 'bad field'),
  );
  assert.ok(
    calls.some((c) => c.level === 'warn' && c.obj.event === 'reconnecting' && c.obj.attempt === 2),
  );
  assert.ok(calls.some((c) => c.level === 'error' && c.obj.error === 'boom'));

  // detach stops further logging
  detach();
  const before = calls.length;
  session.emit('logon', new FixMessage([[35, 'A']]));
  assert.equal(calls.length, before);
});

test('attachMetrics records metric names from events', () => {
  const names: string[] = [];
  const session = newSession();
  const detach = attachMetrics(session, (m) => names.push(m));

  session.emit('sent', 'wire');
  session.emit('message', new FixMessage([[35, '8']]));
  session.emit('reject', new FixMessage([[58, 'x']]));
  session.emit('reconnecting', 1, 100);

  assert.deepEqual(names, ['messages_sent', 'messages_received', 'rejects', 'reconnects']);

  detach();
  session.emit('sent', 'wire');
  assert.equal(names.length, 4);
});
