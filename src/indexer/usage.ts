import type { ParsedUsage, UsageCounts } from "../types";

type Totals = Omit<ParsedUsage, "model" | "timestamp">;

type ModelTotals = Map<string, Totals>;

const COUNTS = [
  "requests",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const satisfies readonly (keyof UsageCounts)[];

/** The CLI records AI credits as `totalNanoAiu`, in billionths of an AI credit. */
const NANO_AIU_PER_AI_CREDIT = 1e9;

function emptyTotals(): Totals {
  return { requests: 0, aiCredits: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aiCredits(totalNanoAiu: unknown): number | null {
  const nanoAiu = optionalNumber(totalNanoAiu);
  return nanoAiu === null ? null : nanoAiu / NANO_AIU_PER_AI_CREDIT;
}

/** Reads the per-model counters of a `session.shutdown` event, or null when it has none. */
function readModelMetrics(value: unknown): ModelTotals | null {
  if (value === null || typeof value !== "object") return null;
  const totals: ModelTotals = new Map();
  for (const [model, raw] of Object.entries(value)) {
    const metrics = asRecord(raw);
    const requests = asRecord(metrics.requests);
    const usage = asRecord(metrics.usage);
    totals.set(model, {
      requests: asNumber(requests.count),
      aiCredits: aiCredits(metrics.totalNanoAiu),
      inputTokens: asNumber(usage.inputTokens),
      outputTokens: asNumber(usage.outputTokens),
      cacheReadTokens: asNumber(usage.cacheReadTokens),
      cacheWriteTokens: asNumber(usage.cacheWriteTokens),
    });
  }
  return totals;
}

function totalRequests(totals: ModelTotals): number {
  let requests = 0;
  for (const t of totals.values()) requests += t.requests;
  return requests;
}

function subtract(current: ModelTotals, previous: ModelTotals): ModelTotals {
  const result: ModelTotals = new Map();
  for (const [model, after] of current) {
    const before = previous.get(model) ?? emptyTotals();
    const delta = emptyTotals();
    for (const field of COUNTS) delta[field] = Math.max(0, after[field] - before[field]);
    delta.aiCredits = after.aiCredits === null ? null : Math.max(0, after.aiCredits - (before.aiCredits ?? 0));
    result.set(model, delta);
  }
  return result;
}

interface Shutdown {
  totals: ModelTotals;
  apiDurationMs: number;
}

/**
 * CLI 1.0.65 and earlier reset these counters when a session was resumed, so a
 * shutdown reported only its own run; later versions carry the previous
 * shutdown's totals over. Nothing records which CLI wrote an event, so a run
 * counts as reporting only itself when a counter went down, or when its model
 * turns match the reported requests better than they match the growth since
 * the previous shutdown.
 */
function reportsOwnRunOnly(current: Shutdown, previous: Shutdown, turns: number): boolean {
  if (current.apiDurationMs < previous.apiDurationMs) return true;
  for (const [model, before] of previous.totals) {
    const after = current.totals.get(model) ?? emptyTotals();
    if (COUNTS.some((field) => after[field] < before[field])) return true;
    if (after.aiCredits !== null && before.aiCredits !== null && after.aiCredits < before.aiCredits) return true;
  }
  const requests = totalRequests(current.totals);
  return Math.abs(requests - turns) < Math.abs(requests - totalRequests(previous.totals) - turns);
}

function toUsage(totals: ModelTotals, timestamp: string | null): ParsedUsage[] {
  const usage: ParsedUsage[] = [];
  for (const [model, t] of totals) {
    if (COUNTS.some((field) => t[field] !== 0) || (t.aiCredits ?? 0) !== 0) usage.push({ model, timestamp, ...t });
  }
  return usage;
}

export interface UsageSummary {
  usage: ParsedUsage[];
  unrecordedRuns: number;
  linesAdded: number | null;
  linesRemoved: number | null;
}

export interface UsageTracker {
  /** Called on `session.start` and `session.resume`, where a new CLI process takes over. */
  startRun(): void;
  turnStarted(): void;
  usageRecord(data: Record<string, unknown>, timestamp: string | null): void;
  compaction(data: Record<string, unknown>, timestamp: string | null): void;
  shutdown(data: Record<string, unknown>, timestamp: string | null): void;
  finish(): UsageSummary;
}

/**
 * Splits the log into CLI runs and takes each run's usage from its per-call
 * `session.usage_record` events when the CLI wrote them, and otherwise from
 * its `session.shutdown` event.
 */
export function createUsageTracker(): UsageTracker {
  const usage: ParsedUsage[] = [];
  let unrecordedRuns = 0;
  let linesAdded: number | null = null;
  let linesRemoved: number | null = null;
  let previous: Shutdown | null = null;
  let turns = 0;
  let calls: ParsedUsage[] = [];
  let hasUsageRecords = false;

  function endRun(fromShutdown: ParsedUsage[] | null): void {
    // Compactions write no usage record, but shutdown totals include their AI
    // credits, so they count only alongside usage records.
    if (hasUsageRecords) usage.push(...calls);
    else if (fromShutdown) usage.push(...fromShutdown);
    else if (turns > 0) unrecordedRuns += 1;
    turns = 0;
    calls = [];
    hasUsageRecords = false;
  }

  return {
    startRun() {
      endRun(null);
    },

    turnStarted() {
      turns += 1;
    },

    usageRecord(data, timestamp) {
      const call = asRecord(data.usage);
      if (typeof call.model !== "string" || call.model.length === 0) return;
      hasUsageRecords = true;
      calls.push({
        model: call.model,
        timestamp,
        requests: 1,
        aiCredits: aiCredits(asRecord(call.copilotUsage).totalNanoAiu),
        inputTokens: asNumber(call.inputTokens),
        outputTokens: asNumber(call.outputTokens),
        cacheReadTokens: asNumber(call.cacheReadTokens),
        cacheWriteTokens: asNumber(call.cacheWriteTokens),
      });
    },

    compaction(data, timestamp) {
      const call = asRecord(data.compactionTokensUsed);
      const credits = aiCredits(asRecord(call.copilotUsage).totalNanoAiu);
      if (typeof call.model !== "string" || call.model.length === 0 || credits === null) return;
      // The CLI's model call and token counts leave compactions out, so they
      // add only AI credits.
      calls.push({
        model: call.model,
        timestamp,
        requests: 0,
        aiCredits: credits,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    },

    shutdown(data, timestamp) {
      // Code changes are cumulative in every CLI version.
      const changes = asRecord(data.codeChanges);
      linesAdded = optionalNumber(changes.linesAdded) ?? linesAdded;
      linesRemoved = optionalNumber(changes.linesRemoved) ?? linesRemoved;

      const totals = readModelMetrics(data.modelMetrics);
      if (!totals) {
        endRun(null);
        return;
      }
      const current: Shutdown = { totals, apiDurationMs: asNumber(data.totalApiDurationMs) };
      const own =
        previous && !reportsOwnRunOnly(current, previous, turns) ? subtract(current.totals, previous.totals) : totals;
      endRun(toUsage(own, timestamp));
      previous = current;
    },

    finish() {
      endRun(null);
      return { usage, unrecordedRuns, linesAdded, linesRemoved };
    },
  };
}
