import type { ModelTrend, TrendBucket, TrendInterval } from "./api";

const AXIS_STEPS = [1, 2, 2.5, 5, 10];

/** The top of a chart's value axis: the largest value rounded up to 1, 2, 2.5, or 5 times a power of ten. */
export function niceAxisMax(value: number): number {
  if (!(value > 0)) return 1;
  const powerOfTen = 10 ** Math.floor(Math.log10(value));
  const step = AXIS_STEPS.find((candidate) => candidate * powerOfTen >= value) ?? 10;
  return Number((step * powerOfTen).toPrecision(12));
}

/** Indexes of evenly spaced buckets to label, starting with the first. */
export function tickIndexes(count: number, maxTicks: number): number[] {
  const step = Math.max(1, Math.ceil(count / maxTicks));
  const indexes: number[] = [];
  for (let index = 0; index < count; index += step) indexes.push(index);
  return indexes;
}

/** The bucket under a point `offset` pixels from the left of a chart `width` pixels wide. */
export function bucketIndexAt(offset: number, width: number, count: number): number {
  const index = Math.floor((offset / width) * count);
  return Math.min(Math.max(index, 0), count - 1);
}

const AXIS_LABEL_FORMATS: Record<TrendInterval, Intl.DateTimeFormatOptions> = {
  hour: { month: "short", day: "numeric", hour: "numeric" },
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
};

export function bucketAxisLabel(start: string, interval: TrendInterval, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { ...AXIS_LABEL_FORMATS[interval], timeZone }).format(new Date(start));
}

/** Names the time from the start of one bucket to the end of the same or a later one. */
export function describeSpan(start: string, end: string, interval: TrendInterval, timeZone: string): string {
  const startDate = new Date(start);
  if (interval === "hour") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).formatRange(startDate, new Date(end));
  }

  // Buckets end where the next begins, so the last day they cover is the one before.
  const lastDate = new Date(Date.parse(end) - 1);
  if (interval === "month") {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", year: "numeric" }).formatRange(
      startDate,
      lastDate,
    );
  }
  const days = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
  if (days.format(startDate) === days.format(lastDate)) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(startDate);
  }
  return days.formatRange(startDate, lastDate);
}

function addAiCredits(total: number | null, more: number | null): number | null {
  return total === null && more === null ? null : (total ?? 0) + (more ?? 0);
}

/** Each model's usage across all the buckets, ordered by AI credits, then requests. */
export function totalByModel(buckets: TrendBucket[]): ModelTrend[] {
  const totals = new Map<string, ModelTrend>();
  for (const bucket of buckets) {
    for (const usage of bucket.models) {
      const total = totals.get(usage.model);
      totals.set(
        usage.model,
        total
          ? {
              model: usage.model,
              requests: total.requests + usage.requests,
              aiCredits: addAiCredits(total.aiCredits, usage.aiCredits),
              requestsWithoutAiCredits: total.requestsWithoutAiCredits + usage.requestsWithoutAiCredits,
            }
          : { ...usage },
      );
    }
  }
  return [...totals.values()].sort(
    (a, b) =>
      (b.aiCredits ?? -1) - (a.aiCredits ?? -1) ||
      b.requests - a.requests ||
      (a.model < b.model ? -1 : a.model > b.model ? 1 : 0),
  );
}
