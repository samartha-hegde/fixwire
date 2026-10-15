import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinSchedule, msUntilTime } from '../src/index.js';

const at = (h: number, m = 0, s = 0, ms = 0) => new Date(Date.UTC(2026, 0, 1, h, m, s, ms));

test('isWithinSchedule handles a same-day window (start inclusive, end exclusive)', () => {
  assert.equal(isWithinSchedule(at(12), '08:00:00', '17:00:00'), true);
  assert.equal(isWithinSchedule(at(8), '08:00:00', '17:00:00'), true); // start inclusive
  assert.equal(isWithinSchedule(at(17), '08:00:00', '17:00:00'), false); // end exclusive
  assert.equal(isWithinSchedule(at(7, 59, 59), '08:00:00', '17:00:00'), false);
  assert.equal(isWithinSchedule(at(20), '08:00:00', '17:00:00'), false);
});

test('isWithinSchedule handles an overnight window that crosses midnight', () => {
  assert.equal(isWithinSchedule(at(23), '22:00:00', '06:00:00'), true);
  assert.equal(isWithinSchedule(at(3), '22:00:00', '06:00:00'), true);
  assert.equal(isWithinSchedule(at(5, 59, 59), '22:00:00', '06:00:00'), true);
  assert.equal(isWithinSchedule(at(6), '22:00:00', '06:00:00'), false);
  assert.equal(isWithinSchedule(at(12), '22:00:00', '06:00:00'), false);
});

test('isWithinSchedule treats start === end as always-on', () => {
  assert.equal(isWithinSchedule(at(13, 37), '00:00:00', '00:00:00'), true);
});

test('msUntilTime returns ms to the next daily occurrence', () => {
  assert.equal(msUntilTime(at(12), '12:00:30'), 30_000);
  assert.equal(msUntilTime(at(12), '11:00:00'), 82_800_000); // wraps to next day (23h)
  assert.equal(msUntilTime(at(12, 0, 0, 500), '12:00:01'), 500);
});
