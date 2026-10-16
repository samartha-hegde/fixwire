import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinSchedule, msUntilNextStart, msUntilTime } from '../src/index.js';

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

// 2026-01-01 is a Thursday; 01-02 Fri, 01-03 Sat, 01-04 Sun, 01-05 Mon.
const utc = (d: number, h = 0) => new Date(Date.UTC(2026, 0, d, h));

test('isWithinSchedule respects allowed weekdays', () => {
  const weekdays = { startTime: '08:00:00', endTime: '17:00:00', days: [1, 2, 3, 4, 5] };
  assert.equal(isWithinSchedule(utc(1, 12), weekdays), true); // Thursday, in window
  assert.equal(isWithinSchedule(utc(3, 12), weekdays), false); // Saturday, closed
});

test('isWithinSchedule respects holidays', () => {
  const sched = { startTime: '08:00:00', endTime: '17:00:00', holidays: ['2026-01-01'] };
  assert.equal(isWithinSchedule(utc(1, 12), sched), false); // in window but a holiday
  assert.equal(isWithinSchedule(utc(2, 12), sched), true);
});

test('msUntilNextStart skips disabled weekdays', () => {
  // Fri 18:00 -> next Mon 08:00 (skip Sat + Sun) = 62h
  const ms = msUntilNextStart(utc(2, 18), {
    startTime: '08:00:00',
    endTime: '17:00:00',
    days: [1, 2, 3, 4, 5],
  });
  assert.equal(ms, 62 * 3600 * 1000);
});

test('msUntilNextStart skips holidays', () => {
  // Thu 18:00 -> skip Fri holiday -> Sat 08:00 = 38h
  const ms = msUntilNextStart(utc(1, 18), {
    startTime: '08:00:00',
    endTime: '17:00:00',
    holidays: ['2026-01-02'],
  });
  assert.equal(ms, 38 * 3600 * 1000);
});
