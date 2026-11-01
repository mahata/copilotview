import type { Database } from "./sqlite";
import { NO_MODEL } from "./activity";
import { bucketBoundaries, chooseInterval, fitsInChart, resolveTimeZone, type TrendInterval } from "./buckets";

export type { TrendInterval };

export interface TrendCounts {
  /** Sessions with a prompt, response, tool call, or model call in the bucket. */
  sessions: number;
  userMessages: number;
  assistantMessages: number;
  requests: number;
  /** Null when there is usage but none of it recorded AI credits. */
  aiCredits: number | null;
  requestsWithoutAiCredits: number;
}

export interface ModelTrend {
  model: string;
  requests: number;
  aiCredits: number | null;
  requestsWithoutAiCredits: number;
}

export interface TrendBucket extends TrendCounts {
  start: string;
  end: string;
  /** Ordered by AI credits, then requests. */
  models: ModelTrend[];
}

export interface Trends {
  interval: TrendInterval;
  timeZone: string;
  buckets: TrendBucket[];
  /** Counts each session once, however many buckets it was active in. */
  totals: TrendCounts;
}

export interface TrendOptions {
  from?: string;
  to?: string;
  interval?: TrendInterval | "auto";
  /** An IANA time zone name; the local time zone stands in for a missing or unknown one. */
  timeZone?: string;
  now?: number;
}

type Row = Record<string, unknown>;

const NO_COUNTS: TrendCounts = {
  sessions: 0,
  userMessages: 0,
  assistantMessages: 0,
  requests: 0,
  aiCredits: 0,
  requestsWithoutAiCredits: 0,
};

const COUNT_SUMS = `
  COUNT(DISTINCT a.session_id) AS sessions,
  COALESCE(SUM(a.user_messages), 0) AS user_messages,
  COALESCE(SUM(a.assistant_messages), 0) AS assistant_messages,
  COALESCE(SUM(a.requests), 0) AS requests,
  SUM(a.ai_credits) AS ai_credits,
  COALESCE(SUM(a.requests_without_ai_credits), 0) AS requests_without_ai_credits
`;

const IN_BUCKET = "a.slot_start >= bucket.value ->> 0 AND a.slot_start < bucket.value ->> 1";

function aiCreditsOf(row: Row): number | null {
  if (row.ai_credits !== null && row.ai_credits !== undefined) return Number(row.ai_credits);
  return Number(row.requests_without_ai_credits ?? 0) > 0 ? null : 0;
}

function toCounts(row: Row): TrendCounts {
  return {
    sessions: Number(row.sessions ?? 0),
    userMessages: Number(row.user_messages ?? 0),
    assistantMessages: Number(row.assistant_messages ?? 0),
    requests: Number(row.requests ?? 0),
    aiCredits: aiCreditsOf(row),
    requestsWithoutAiCredits: Number(row.requests_without_ai_credits ?? 0),
  };
}

function toModelTrend(row: Row): ModelTrend {
  return {
    model: String(row.model),
    requests: Number(row.requests ?? 0),
    aiCredits: aiCreditsOf(row),
    requestsWithoutAiCredits: Number(row.requests_without_ai_credits ?? 0),
  };
}

function parseTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

interface ChartRange {
  first: number;
  last: number;
  interval: TrendInterval;
}

/**
 * Charts the period up to now, from the first activity when it has no start.
 * A period too long to chart even by month starts at the first activity too.
 */
function chartRange(db: Database, options: TrendOptions, requested: TrendInterval | "auto"): ChartRange | null {
  const row = db.prepare("SELECT MIN(slot_start) AS first FROM activity_slots").get() as Row;
  const firstActivity = row.first === null || row.first === undefined ? undefined : Number(row.first);
  const now = options.now ?? Date.now();
  const last = Math.min(parseTime(options.to) ?? now, now);
  let first = parseTime(options.from) ?? firstActivity;
  if (first === undefined) return null;

  let interval = chooseInterval(first, last, requested);
  if (!fitsInChart(first, last, interval) && firstActivity !== undefined && firstActivity > first) {
    first = firstActivity;
    interval = chooseInterval(first, last, requested);
  }
  return first <= last ? { first, last, interval } : null;
}

/**
 * Totals activity by hour, day, week, or month in `timeZone`. The first and
 * last buckets are whole, so they can include activity from just outside the
 * period.
 */
export function getTrends(db: Database, options: TrendOptions = {}): Trends {
  const timeZone = resolveTimeZone(options.timeZone);
  const requested = options.interval ?? "auto";
  const range = chartRange(db, options, requested);
  if (!range) {
    return { interval: requested === "auto" ? "day" : requested, timeZone, buckets: [], totals: NO_COUNTS };
  }

  const boundaries = bucketBoundaries(range.first, range.last, range.interval, timeZone);
  const bucketRanges = JSON.stringify(boundaries.slice(0, -1).map((start, index) => [start, boundaries[index + 1]]));

  const countsByBucket = new Map(
    (
      db
        .prepare(
          `SELECT bucket.key AS bucket, ${COUNT_SUMS}
           FROM json_each(?) AS bucket JOIN activity_slots a ON ${IN_BUCKET}
           GROUP BY bucket.key`,
        )
        .all(bucketRanges) as Row[]
    ).map((row) => [Number(row.bucket), toCounts(row)]),
  );

  const modelsByBucket = new Map<number, ModelTrend[]>();
  const modelRows = db
    .prepare(
      `SELECT bucket.key AS bucket, a.model AS model, SUM(a.requests) AS requests, SUM(a.ai_credits) AS ai_credits,
         SUM(a.requests_without_ai_credits) AS requests_without_ai_credits
       FROM json_each(?) AS bucket JOIN activity_slots a ON ${IN_BUCKET}
       WHERE a.model <> ?
       GROUP BY bucket.key, a.model
       ORDER BY bucket.key, ai_credits DESC, requests DESC, a.model`,
    )
    .all(bucketRanges, NO_MODEL) as Row[];
  for (const row of modelRows) {
    const bucket = Number(row.bucket);
    const models = modelsByBucket.get(bucket) ?? [];
    models.push(toModelTrend(row));
    modelsByBucket.set(bucket, models);
  }

  const totals = toCounts(
    db
      .prepare(`SELECT ${COUNT_SUMS} FROM activity_slots a WHERE a.slot_start >= ? AND a.slot_start < ?`)
      .get(boundaries[0]!, boundaries[boundaries.length - 1]!) as Row,
  );

  return {
    interval: range.interval,
    timeZone,
    buckets: boundaries.slice(0, -1).map((start, index) => ({
      start: new Date(start).toISOString(),
      end: new Date(boundaries[index + 1]!).toISOString(),
      ...(countsByBucket.get(index) ?? NO_COUNTS),
      models: modelsByBucket.get(index) ?? [],
    })),
    totals,
  };
}
