/** A daily session window, in UTC `HH:MM:SS`. */
export interface Schedule {
  /** Start of the daily session window, UTC `HH:MM:SS` (e.g. "08:00:00"). */
  startTime: string;
  /** End of the daily session window, UTC `HH:MM:SS` (e.g. "17:00:00"). */
  endTime: string;
}

function toSeconds(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function secondsOfDay(d: Date): number {
  return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
}

/**
 * Whether `now` falls inside a daily window. Start is inclusive, end exclusive.
 * Handles same-day windows (08:00-17:00) and overnight windows that cross
 * midnight (22:00-06:00). A window where start equals end means always-on.
 */
export function isWithinSchedule(now: Date, startTime: string, endTime: string): boolean {
  const start = toSeconds(startTime);
  const end = toSeconds(endTime);
  const t = secondsOfDay(now);
  if (start === end) return true;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end; // crosses midnight
}

/** Milliseconds from `now` until the next daily occurrence of `time` (UTC `HH:MM:SS`). */
export function msUntilTime(now: Date, time: string): number {
  const target = toSeconds(time);
  const t = secondsOfDay(now) + now.getUTCMilliseconds() / 1000;
  let delta = target - t;
  if (delta <= 0) delta += 86400;
  return Math.ceil(delta * 1000);
}
