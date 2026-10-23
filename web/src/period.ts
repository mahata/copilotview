const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const CUSTOM_PERIOD = "custom";

export const PERIODS: { value: string; label: string; days?: number }[] = [
  { value: "", label: "All time" },
  { value: "24h", label: "Past 24 hours", days: 1 },
  { value: "7d", label: "Past 7 days", days: 7 },
  { value: "30d", label: "Past 30 days", days: 30 },
  { value: "90d", label: "Past 90 days", days: 90 },
  { value: "1y", label: "Past year", days: 365 },
  { value: CUSTOM_PERIOD, label: "Custom range" },
];

/** The chosen period, plus the first and last days (YYYY-MM-DD) of a custom range, either of which may be empty. */
export interface PeriodSelection {
  period: string;
  periodFrom: string;
  periodTo: string;
}

export type PeriodRange = { from?: string; to?: string };

export function periodStart(period: string, now: number): string | undefined {
  const days = PERIODS.find((preset) => preset.value === period)?.days;
  return days === undefined ? undefined : new Date(now - days * MS_PER_DAY).toISOString();
}

/**
 * Local midnight at the start of a YYYY-MM-DD day, moved by whole days. `new Date("2026-10-01")` would parse
 * the day as UTC, and `new Date(year, ...)` would turn years below 100 into 19xx.
 */
function startOfLocalDay(day: string, addDays = 0): Date | undefined {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const date = new Date(0);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + addDays);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Bounds of the selected period as ISO timestamps, inclusive at both ends, or undefined where it is open. */
export function periodRange(selection: PeriodSelection, now: number): PeriodRange {
  if (selection.period !== CUSTOM_PERIOD) return { from: periodStart(selection.period, now) };
  const start = startOfLocalDay(selection.periodFrom);
  // The next midnight, not 24 hours later: days when daylight saving time changes last 23 or 25 hours.
  const nextDay = startOfLocalDay(selection.periodTo, 1);
  return {
    from: start?.toISOString(),
    to: nextDay ? new Date(nextDay.getTime() - 1).toISOString() : undefined,
  };
}

function formatDay(day: string): string | undefined {
  return startOfLocalDay(day)?.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Completes "Statistics …" for the selected period, for example "for the past 7 days". */
export function describePeriod(selection: PeriodSelection): string {
  if (selection.period === CUSTOM_PERIOD) {
    const first = formatDay(selection.periodFrom);
    const last = formatDay(selection.periodTo);
    if (first && last) {
      return selection.periodFrom === selection.periodTo ? `for ${first}` : `from ${first} through ${last}`;
    }
    if (first) return `since ${first}`;
    if (last) return `through ${last}`;
  }
  const preset = PERIODS.find((candidate) => candidate.value === selection.period);
  return preset?.days === undefined ? "for the complete index" : `for the ${preset.label.toLowerCase()}`;
}
