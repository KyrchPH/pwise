// Timezone helpers for the posting window. We compute wall-clock time in the
// user's IANA timezone using Intl (no dependency on MySQL's tz tables).

// 'HH:MM' wall-clock time in `timeZone` for the instant `date`.
export function localHourMinute(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // Some engines emit "24:00" at midnight — normalize to "00:00".
  return fmt.format(date).replace(/^24/, '00');
}

// allowed_start/allowed_end are 'HH:MM:SS' strings from a MySQL TIME column.
export function isWithinWindow(date, startTime, endTime, timeZone) {
  const now = localHourMinute(date, timeZone); // 'HH:MM'
  const start = String(startTime || '00:00:00').slice(0, 5);
  const end = String(endTime || '23:59:59').slice(0, 5);
  if (start <= end) return now >= start && now <= end; // same-day window
  return now >= start || now <= end; // window crosses midnight
}

// Minutes elapsed since `date` (Date | string | null). Null => Infinity (treat as due).
export function minutesSince(date) {
  if (!date) return Infinity;
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 60000;
}
