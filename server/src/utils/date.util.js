// Minutes elapsed since `date` (Date | string | null). Null => Infinity.
export function minutesSince(date) {
  if (!date) return Infinity;
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 60000;
}
