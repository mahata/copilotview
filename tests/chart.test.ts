import { describe, expect, it } from "vitest";
import type { TrendBucket } from "../web/src/api";
import { bucketAxisLabel, bucketIndexAt, describeSpan, formatAxisMax, niceAxisMax, tickIndexes, totalByModel } from "../web/src/chart";

const TOKYO = "Asia/Tokyo";

/** ICU versions differ in the spaces around range dashes and before AM or PM, and in how they join a date and a time. */
function normalizeSpaces(text: string): string {
  return text.replace(/[\u2009\u202f\u00a0]/g, " ").replace(/ at /g, ", ");
}

function bucket(models: TrendBucket["models"]): TrendBucket {
  return {
    start: "2026-10-31T15:00:00.000Z",
    end: "2026-11-01T15:00:00.000Z",
    sessions: 1,
    userMessages: 0,
    assistantMessages: 0,
    requests: 0,
    aiCredits: 0,
    requestsWithoutAiCredits: 0,
    models,
  };
}

describe("niceAxisMax", () => {
  it("rounds the largest value up to 1, 2, 2.5, or 5 times a power of ten", () => {
    expect([0.3, 1, 3, 7, 12, 180, 210, 1234].map(niceAxisMax)).toEqual([0.5, 1, 5, 10, 20, 200, 250, 2000]);
  });

  it("gives charts without values an axis up to 1", () => {
    expect(niceAxisMax(0)).toBe(1);
  });
});

describe("formatAxisMax", () => {
  it("labels the top of an axis exactly, however small, and abbreviates large values", () => {
    expect([0.02, 0.05, 0.25, 2.5, 250, 2500, 10000].map(formatAxisMax)).toEqual([
      "0.02",
      "0.05",
      "0.25",
      "2.5",
      "250",
      "2.5K",
      "10K",
    ]);
  });
});

describe("tickIndexes", () => {
  it("labels evenly spaced buckets, starting with the first", () => {
    expect(tickIndexes(31, 6)).toEqual([0, 6, 12, 18, 24, 30]);
    expect(tickIndexes(100, 5)).toEqual([0, 20, 40, 60, 80]);
  });

  it("labels every bucket when there are few", () => {
    expect(tickIndexes(4, 6)).toEqual([0, 1, 2, 3]);
    expect(tickIndexes(0, 6)).toEqual([]);
  });
});

describe("bucketIndexAt", () => {
  it("finds the bucket under a point across the chart's width", () => {
    expect(bucketIndexAt(0, 300, 3)).toBe(0);
    expect(bucketIndexAt(150, 300, 3)).toBe(1);
    expect(bucketIndexAt(299.9, 300, 3)).toBe(2);
  });

  it("keeps points just outside the chart on its first or last bucket", () => {
    expect(bucketIndexAt(-4, 300, 3)).toBe(0);
    expect(bucketIndexAt(300, 300, 3)).toBe(2);
  });
});

describe("bucketAxisLabel", () => {
  it("names a bucket briefly in the time zone of the buckets", () => {
    const midnight = "2026-10-31T15:00:00.000Z";
    expect(normalizeSpaces(bucketAxisLabel(midnight, "hour", TOKYO))).toBe("Nov 1, 12 AM");
    expect(bucketAxisLabel(midnight, "day", TOKYO)).toBe("Nov 1");
    expect(bucketAxisLabel(midnight, "week", TOKYO)).toBe("Nov 1");
    expect(bucketAxisLabel(midnight, "month", TOKYO)).toBe("Nov 2026");
  });
});

describe("describeSpan", () => {
  it("names a single bucket in full", () => {
    expect(normalizeSpaces(describeSpan("2026-10-31T15:00:00.000Z", "2026-10-31T16:00:00.000Z", "hour", TOKYO))).toBe(
      "Nov 1, 2026, 12:00 – 1:00 AM",
    );
    expect(describeSpan("2026-10-31T15:00:00.000Z", "2026-11-01T15:00:00.000Z", "day", TOKYO)).toBe("Sun, Nov 1, 2026");
    expect(normalizeSpaces(describeSpan("2026-10-25T15:00:00.000Z", "2026-11-01T15:00:00.000Z", "week", TOKYO))).toBe(
      "Oct 26 – Nov 1, 2026",
    );
    expect(describeSpan("2026-10-31T15:00:00.000Z", "2026-11-30T15:00:00.000Z", "month", TOKYO)).toBe("November 2026");
  });

  it("names a run of buckets by its first and last days", () => {
    expect(normalizeSpaces(describeSpan("2026-10-01T15:00:00.000Z", "2026-11-01T15:00:00.000Z", "day", TOKYO))).toBe(
      "Oct 2 – Nov 1, 2026",
    );
    expect(normalizeSpaces(describeSpan("2026-09-30T15:00:00.000Z", "2026-11-30T15:00:00.000Z", "month", TOKYO))).toBe(
      "October – November 2026",
    );
  });

  it("names both ends of an hour that starts and ends at the same time on the clock because clocks fell back", () => {
    expect(
      normalizeSpaces(describeSpan("2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", "hour", "America/New_York")),
    ).toBe("Nov 1, 2026, 1:00 AM EDT – 1:00 AM EST");
  });
});

describe("totalByModel", () => {
  it("adds up each model's usage across buckets, most AI credits first", () => {
    const totals = totalByModel([
      bucket([
        { model: "gpt-5.5", requests: 2, aiCredits: 1, requestsWithoutAiCredits: 0 },
        { model: "claude-opus-5.5", requests: 1, aiCredits: null, requestsWithoutAiCredits: 1 },
      ]),
      bucket([{ model: "claude-opus-5.5", requests: 3, aiCredits: 4.5, requestsWithoutAiCredits: 0 }]),
    ]);

    expect(totals).toEqual([
      { model: "claude-opus-5.5", requests: 4, aiCredits: 4.5, requestsWithoutAiCredits: 1 },
      { model: "gpt-5.5", requests: 2, aiCredits: 1, requestsWithoutAiCredits: 0 },
    ]);
  });

  it("leaves a model's AI credits unrecorded when none of its usage recorded them", () => {
    expect(
      totalByModel([bucket([{ model: "gpt-5.5", requests: 2, aiCredits: null, requestsWithoutAiCredits: 2 }])]),
    ).toEqual([{ model: "gpt-5.5", requests: 2, aiCredits: null, requestsWithoutAiCredits: 2 }]);
  });
});
