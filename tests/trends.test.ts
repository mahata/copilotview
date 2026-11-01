import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStats } from "../src/db/query";
import { openIndex } from "../src/db/schema";
import type { Database } from "../src/db/sqlite";
import { getTrends, type Trends } from "../src/db/trends";
import { indexSessions } from "../src/indexer/scan";
import { createApp } from "../src/server/app";

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function prompt(timestamp: string | null, content = "prompt"): unknown {
  return timestamp === null ? { type: "user.message", data: { content } } : { type: "user.message", timestamp, data: { content } };
}

function usageRecord(timestamp: string, model: string, credits: number): unknown {
  return {
    type: "session.usage_record",
    timestamp,
    data: { usage: { model, inputTokens: 100, outputTokens: 10, copilotUsage: { totalNanoAiu: credits * 1e9 } } },
  };
}

const TOKYO = "Asia/Tokyo";
/** October 1 through 3, 2026, in Tokyo. */
const firstThreeDaysOfOctober = { from: "2026-09-30T15:00:00.000Z", to: "2026-10-03T14:59:59.999Z" };
const afterOctober = Date.parse("2026-11-01T00:00:00.000Z");

describe("trends", () => {
  let root: string;
  let db: Database;

  function writeSession(id: string, updatedAt: string, events: unknown[]): void {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "workspace.yaml"), `id: ${id}\nupdated_at: ${updatedAt}\n`);
    fs.writeFileSync(path.join(dir, "events.jsonl"), jsonl(...events));
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "copilotview-trends-test-"));
    writeSession("alpha", "2026-10-20T00:00:00.000Z", [
      { type: "session.start", timestamp: "2026-10-01T00:00:00.000Z", data: { sessionId: "alpha" } },
      prompt("2026-10-01T00:00:00.000Z"),
      {
        type: "user.message",
        timestamp: "2026-10-01T00:00:01.000Z",
        data: { content: "injected skill preamble", source: "skill-workiq" },
      },
      { type: "assistant.turn_start", data: {} },
      usageRecord("2026-10-01T00:01:00.000Z", "claude-opus-5.5", 2),
      { type: "assistant.message", timestamp: "2026-10-01T00:02:00.000Z", data: { content: "Done." } },
      {
        type: "tool.execution_start",
        timestamp: "2026-10-01T00:03:00.000Z",
        data: { toolCallId: "t1", toolName: "bash", arguments: { command: "ls" } },
      },
      prompt("2026-10-02T14:59:00.000Z"),
      usageRecord("2026-10-02T14:59:30.000Z", "gpt-5.5", 1),
      prompt("2026-10-02T15:00:00.000Z"),
      { type: "session.resume", timestamp: "2026-10-03T01:00:00.000Z", data: {} },
      { type: "assistant.turn_start", data: {} },
      { type: "assistant.turn_start", data: {} },
      {
        type: "session.shutdown",
        timestamp: "2026-10-03T02:00:00.000Z",
        data: { modelMetrics: { "gpt-5.5": { requests: { count: 2 }, usage: { inputTokens: 40 } } } },
      },
    ]);
    writeSession("beta", "2026-10-02T12:00:00.000Z", [
      { type: "session.start", timestamp: "2026-10-02T03:00:00.000Z", data: { sessionId: "beta" } },
      prompt("2026-10-02T03:00:00.000Z"),
      { type: "assistant.turn_start", data: {} },
      usageRecord("2026-10-02T03:00:30.000Z", "claude-opus-5.5", 5),
      prompt(null, "undated"),
    ]);
    db = openIndex(":memory:");
    await indexSessions(db, root);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const october1 = {
    start: "2026-09-30T15:00:00.000Z",
    end: "2026-10-01T15:00:00.000Z",
    sessions: 1,
    userMessages: 1,
    assistantMessages: 1,
    requests: 1,
    aiCredits: 2,
    requestsWithoutAiCredits: 0,
    models: [{ model: "claude-opus-5.5", requests: 1, aiCredits: 2, requestsWithoutAiCredits: 0 }],
  };
  const october2 = {
    start: "2026-10-01T15:00:00.000Z",
    end: "2026-10-02T15:00:00.000Z",
    sessions: 2,
    userMessages: 3,
    assistantMessages: 0,
    requests: 2,
    aiCredits: 6,
    requestsWithoutAiCredits: 0,
    models: [
      { model: "claude-opus-5.5", requests: 1, aiCredits: 5, requestsWithoutAiCredits: 0 },
      { model: "gpt-5.5", requests: 1, aiCredits: 1, requestsWithoutAiCredits: 0 },
    ],
  };
  const october3 = {
    start: "2026-10-02T15:00:00.000Z",
    end: "2026-10-03T15:00:00.000Z",
    sessions: 1,
    userMessages: 1,
    assistantMessages: 0,
    requests: 2,
    aiCredits: null,
    requestsWithoutAiCredits: 2,
    models: [{ model: "gpt-5.5", requests: 2, aiCredits: null, requestsWithoutAiCredits: 2 }],
  };

  it("totals each local day's active sessions, messages, and AI credits by model", () => {
    expect(
      getTrends(db, { ...firstThreeDaysOfOctober, interval: "day", timeZone: TOKYO, now: afterOctober }),
    ).toEqual({
      interval: "day",
      timeZone: TOKYO,
      buckets: [october1, october2, october3],
      totals: {
        sessions: 2,
        userMessages: 5,
        assistantMessages: 1,
        requests: 5,
        aiCredits: 8,
        requestsWithoutAiCredits: 2,
      },
    });
  });

  it("agrees with the statistics for a period of whole days", () => {
    const { totals } = getTrends(db, { ...firstThreeDaysOfOctober, interval: "day", timeZone: TOKYO, now: afterOctober });
    const stats = getStats(db, firstThreeDaysOfOctober);

    expect(totals.userMessages + totals.assistantMessages).toBe(stats.messageCount);
    expect(totals).toMatchObject({
      requests: stats.usage.requests,
      aiCredits: stats.usage.aiCredits,
      requestsWithoutAiCredits: stats.usage.requestsWithoutAiCredits,
    });
  });

  it("counts whole buckets at both ends of a period that starts and ends partway through them", () => {
    const trends = getTrends(db, {
      from: "2026-10-01T06:00:00.000Z",
      to: "2026-10-02T06:00:00.000Z",
      interval: "day",
      timeZone: TOKYO,
      now: afterOctober,
    });

    expect(trends.buckets).toEqual([october1, october2]);
  });

  it("splits days in the requested time zone", () => {
    const trends = getTrends(db, { ...firstThreeDaysOfOctober, interval: "day", timeZone: "UTC", now: afterOctober });

    expect(trends.buckets.map((bucket) => [bucket.start, bucket.userMessages])).toEqual([
      ["2026-09-30T00:00:00.000Z", 0],
      ["2026-10-01T00:00:00.000Z", 1],
      ["2026-10-02T00:00:00.000Z", 4],
      ["2026-10-03T00:00:00.000Z", 0],
    ]);
  });

  it("starts at the first activity and ends now when the period has no start", () => {
    const trends = getTrends(db, { interval: "day", timeZone: TOKYO, now: Date.parse("2026-10-04T16:00:00.000Z") });

    expect(trends.buckets.map((bucket) => bucket.start)).toEqual([
      "2026-09-30T15:00:00.000Z",
      "2026-10-01T15:00:00.000Z",
      "2026-10-02T15:00:00.000Z",
      "2026-10-03T15:00:00.000Z",
      "2026-10-04T15:00:00.000Z",
    ]);
  });

  it("picks an interval from the length of the period and reports a coarser one it had to use", () => {
    const now = Date.parse("2026-10-03T00:00:00.000Z");
    const daysBefore = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

    expect(getTrends(db, { from: daysBefore(1), timeZone: TOKYO, now }).interval).toBe("hour");
    expect(getTrends(db, { from: daysBefore(2), interval: "auto", timeZone: TOKYO, now }).buckets).toHaveLength(49);
    expect(getTrends(db, { from: daysBefore(7), interval: "auto", timeZone: TOKYO, now }).interval).toBe("day");
    expect(getTrends(db, { from: daysBefore(30), interval: "hour", timeZone: TOKYO, now }).interval).toBe("day");
  });

  it("counts nothing in buckets without activity", () => {
    const weekOf = (start: string, end: string) => ({
      start,
      end,
      sessions: 0,
      userMessages: 0,
      assistantMessages: 0,
      requests: 0,
      aiCredits: 0,
      requestsWithoutAiCredits: 0,
      models: [],
    });

    expect(
      getTrends(db, {
        from: "2025-12-28T15:00:00.000Z",
        to: "2026-01-11T14:59:59.999Z",
        interval: "week",
        timeZone: TOKYO,
        now: afterOctober,
      }),
    ).toEqual({
      interval: "week",
      timeZone: TOKYO,
      buckets: [
        weekOf("2025-12-28T15:00:00.000Z", "2026-01-04T15:00:00.000Z"),
        weekOf("2026-01-04T15:00:00.000Z", "2026-01-11T15:00:00.000Z"),
      ],
      totals: { sessions: 0, userMessages: 0, assistantMessages: 0, requests: 0, aiCredits: 0, requestsWithoutAiCredits: 0 },
    });
  });

  it("starts at the first activity when even months would be too many to chart", () => {
    const trends = getTrends(db, { from: "1900-01-01T00:00:00.000Z", timeZone: TOKYO, now: afterOctober });

    expect(trends.interval).toBe("day");
    expect(trends.buckets[0]?.start).toBe("2026-09-30T15:00:00.000Z");
  });

  it("returns no buckets for a period that starts after it ends or in the future", () => {
    expect(getTrends(db, { from: "2026-12-01T00:00:00.000Z", timeZone: TOKYO, now: afterOctober }).buckets).toEqual([]);
    expect(
      getTrends(db, { from: "2026-10-02T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", timeZone: TOKYO }).buckets,
    ).toEqual([]);
  });

  it("serves trends for the requested period, interval, and time zone", async () => {
    const app = createApp(db);
    const query = `from=${firstThreeDaysOfOctober.from}&to=${firstThreeDaysOfOctober.to}`;

    const trends = (await (await app.request(`/api/trends?${query}&interval=day&tz=${TOKYO}`)).json()) as Trends;
    expect(trends).toMatchObject({ interval: "day", timeZone: TOKYO, buckets: [october1, october2, october3] });

    const fallback = (await (await app.request(`/api/trends?${query}&interval=fortnight&tz=Mars/Olympus_Mons`)).json()) as Trends;
    expect(fallback).toMatchObject({ interval: "hour", timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone });
  });
});

describe("trends of an empty index", () => {
  it("returns no buckets", () => {
    const db = openIndex(":memory:");
    try {
      expect(getTrends(db, { timeZone: TOKYO })).toMatchObject({ interval: "day", buckets: [] });
    } finally {
      db.close();
    }
  });
});
