export const TREND_INTERVALS = ["hour", "day", "week", "month"] as const;

export type TrendInterval = (typeof TREND_INTERVALS)[number];

/** Auto picks the finest interval that charts the range in at most this many buckets. */
export const AUTO_MAX_BUCKETS = 100;

/** A requested interval that needs more buckets than this gives way to the next coarser one. */
export const MAX_BUCKETS = 400;

const MINUTE_MS = 60 * 1000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const TYPICAL_LENGTH_MS: Record<TrendInterval, number> = {
  hour: HOUR_MS,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: (365.2425 / 12) * DAY_MS,
};

function estimatedBucketCount(first: number, last: number, interval: TrendInterval): number {
  return Math.floor((last - first) / TYPICAL_LENGTH_MS[interval]) + 1;
}

export function fitsInChart(first: number, last: number, interval: TrendInterval): boolean {
  return estimatedBucketCount(first, last, interval) <= MAX_BUCKETS;
}

export function chooseInterval(first: number, last: number, requested: TrendInterval | "auto"): TrendInterval {
  if (requested !== "auto") {
    const candidates = TREND_INTERVALS.slice(TREND_INTERVALS.indexOf(requested));
    return candidates.find((interval) => fitsInChart(first, last, interval)) ?? "month";
  }
  return TREND_INTERVALS.find((interval) => estimatedBucketCount(first, last, interval) <= AUTO_MAX_BUCKETS) ?? "month";
}

/** The requested IANA time zone in its canonical form, or the local one when the name is missing or unknown. */
export function resolveTimeZone(requested: string | undefined): string {
  if (requested) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: requested }).resolvedOptions().timeZone;
    } catch {
      // Intl throws a RangeError for names it doesn't know.
    }
  }
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

interface WallClock extends CalendarDay {
  hour: number;
  minute: number;
}

const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

function wallClock(time: number, timeZone: string): WallClock {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    wallClockFormats.set(timeZone, format);
  }
  const fields = new Map(format.formatToParts(time).map((part) => [part.type, Number(part.value)]));
  const field = (type: Intl.DateTimeFormatPartTypes) => fields.get(type) ?? Number.NaN;
  return { year: field("year"), month: field("month"), day: field("day"), hour: field("hour"), minute: field("minute") };
}

/** `Date.UTC` would read years 0 to 99 as 1900 to 1999. */
function utcMidnight(day: CalendarDay): number {
  const date = new Date(0);
  date.setUTCFullYear(day.year, day.month - 1, day.day);
  return date.getTime();
}

function addDays(day: CalendarDay, days: number): CalendarDay {
  const date = new Date(utcMidnight(day) + days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dayNumber(day: CalendarDay): number {
  return day.year * 10_000 + day.month * 100 + day.day;
}

/** How far the wall clock in `timeZone` is ahead of UTC at `time`. */
function utcOffsetMs(time: number, timeZone: string): number {
  const clock = wallClock(time, timeZone);
  const wallClockAsUtc = utcMidnight(clock) + clock.hour * HOUR_MS + clock.minute * MINUTE_MS;
  return wallClockAsUtc - Math.floor(time / MINUTE_MS) * MINUTE_MS;
}

/**
 * The first moment of a local day: midnight, or the first moment after it on
 * days when a clock change skips midnight. Every UTC offset in use is a whole
 * number of quarter hours, so each day starts on a UTC quarter hour.
 */
function startOfDay(day: CalendarDay, timeZone: string): number {
  const target = dayNumber(day);
  const hasBegun = (time: number) => dayNumber(wallClock(time, timeZone)) >= target;
  const midnightAsUtc = utcMidnight(day);
  const midnight = midnightAsUtc - utcOffsetMs(midnightAsUtc - utcOffsetMs(midnightAsUtc, timeZone), timeZone);
  if (hasBegun(midnight) && !hasBegun(midnight - QUARTER_HOUR_MS)) return midnight;

  // UTC offsets range from -12:00 to +14:00, so the day starts between these.
  let before = midnightAsUtc - 15 * HOUR_MS;
  let after = midnightAsUtc + 13 * HOUR_MS;
  while (after - before > QUARTER_HOUR_MS) {
    const middle = before + Math.floor((after - before) / (2 * QUARTER_HOUR_MS)) * QUARTER_HOUR_MS;
    if (hasBegun(middle)) after = middle;
    else before = middle;
  }
  return after;
}

function startOfHour(time: number, timeZone: string): number {
  return Math.floor(time / MINUTE_MS) * MINUTE_MS - wallClock(time, timeZone).minute * MINUTE_MS;
}

function firstDayOfBucket(day: CalendarDay, interval: Exclude<TrendInterval, "hour">): CalendarDay {
  switch (interval) {
    case "day":
      return day;
    case "week": {
      const daysSinceMonday = (new Date(utcMidnight(day)).getUTCDay() + 6) % 7;
      return addDays(day, -daysSinceMonday);
    }
    case "month":
      return { year: day.year, month: day.month, day: 1 };
  }
}

function firstDayOfNextBucket(day: CalendarDay, interval: Exclude<TrendInterval, "hour">): CalendarDay {
  switch (interval) {
    case "day":
      return addDays(day, 1);
    case "week":
      return addDays(day, 7);
    case "month":
      return day.month === 12 ? { year: day.year + 1, month: 1, day: 1 } : { year: day.year, month: day.month + 1, day: 1 };
  }
}

/**
 * The starts of consecutive buckets in `timeZone`, from the one containing
 * `first` through the one containing `last`, followed by the end of the last.
 * Weeks start on Monday. Hours are an hour long even when the clocks change,
 * while days, weeks, and months follow the wall clock.
 */
export function bucketBoundaries(first: number, last: number, interval: TrendInterval, timeZone: string): number[] {
  if (interval === "hour") {
    let end = startOfHour(first, timeZone);
    const boundaries = [end];
    while (end <= last) {
      end += HOUR_MS;
      boundaries.push(end);
    }
    return boundaries;
  }

  let day = firstDayOfBucket(wallClock(first, timeZone), interval);
  let end = startOfDay(day, timeZone);
  const boundaries = [end];
  while (end <= last) {
    day = firstDayOfNextBucket(day, interval);
    end = startOfDay(day, timeZone);
    boundaries.push(end);
  }
  return boundaries;
}
