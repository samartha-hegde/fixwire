/** A session window, in UTC. */
export interface Schedule {
  /** Start of the daily session window, UTC `HH:MM:SS` (e.g. "08:00:00"). */
  startTime: string;
  /** End of the daily session window, UTC `HH:MM:SS` (e.g. "17:00:00"). */
  endTime: string;
  /** Weekdays the session is open (0=Sun .. 6=Sat). Default: every day. */
  days?: number[];
  /** Dates the session is closed, UTC `YYYY-MM-DD` (holidays). */
  holidays?: string[];
}

function toSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function secondsOfDay(d: Date): number {
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * The weekday/date that "owns" the instant `now`. For an overnight window
 * (crosses midnight) the morning portion belongs to the previous calendar day,
 * so a "Mon 22:00 - 06:00" session on Tuesday 03:00 is still owned by Monday.
 */
function owningDay(
  now: Date,
  startTime: string,
  endTime: string,
): { weekday: number; key: string } {
  const overnight = toSeconds(startTime) > toSeconds(endTime);
  if (overnight && secondsOfDay(now) < toSeconds(endTime)) {
    const prev = new Date(now.getTime() - 86_400_000);
    return { weekday: prev.getUTCDay(), key: dateKey(prev) };
  }
  return { weekday: now.getUTCDay(), key: dateKey(now) };
}

function withinDailyWindow(now: Date, startTime: string, endTime: string): boolean {
  const start = toSeconds(startTime);
  const end = toSeconds(endTime);
  const t = secondsOfDay(now);
  if (start === end) return true;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end; // crosses midnight
}

/**
 * Whether `now` falls inside a session window: inside the daily time window, on an
 * allowed weekday, and not on a holiday. Start is inclusive, end exclusive; same-day
 * and overnight windows are both handled.
 */
export function isWithinSchedule(now: Date, schedule: Schedule): boolean;
export function isWithinSchedule(now: Date, startTime: string, endTime: string): boolean;
export function isWithinSchedule(now: Date, a: Schedule | string, b?: string): boolean {
  const schedule: Schedule = typeof a === 'string' ? { startTime: a, endTime: b ?? a } : a;
  if (!withinDailyWindow(now, schedule.startTime, schedule.endTime)) return false;
  const own = owningDay(now, schedule.startTime, schedule.endTime);
  if (schedule.days && !schedule.days.includes(own.weekday)) return false;
  if (schedule.holidays?.includes(own.key)) return false;
  return true;
}

/** Milliseconds from `now` until the next daily occurrence of `time` (UTC `HH:MM:SS`). */
export function msUntilTime(now: Date, time: string): number {
  const target = toSeconds(time);
  const t = secondsOfDay(now) + now.getUTCMilliseconds() / 1000;
  let delta = target - t;
  if (delta <= 0) delta += 86_400;
  return Math.ceil(delta * 1000);
}

/**
 * Milliseconds from `now` until the next session start that falls on an allowed,
 * non-holiday day. Skips disabled weekdays and holidays (searches up to 8 days).
 */
export function msUntilNextStart(now: Date, schedule: Schedule): number {
  const startSec = toSeconds(schedule.startTime);
  for (let i = 0; i <= 8; i++) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i);
    const candidate = new Date(midnight + startSec * 1000);
    if (candidate.getTime() <= now.getTime()) continue;
    if (schedule.days && !schedule.days.includes(candidate.getUTCDay())) continue;
    if (schedule.holidays?.includes(dateKey(candidate))) continue;
    return candidate.getTime() - now.getTime();
  }
  return msUntilTime(now, schedule.startTime);
}
