import { describe, expect, it } from "vitest";
import { bucketBoundaries, chooseInterval, resolveTimeZone, type TrendInterval } from "../src/db/buckets";

function boundaries(first: string, last: string, interval: TrendInterval, timeZone: string): string[] {
  return bucketBoundaries(Date.parse(first), Date.parse(last), interval, timeZone).map((time) =>
    new Date(time).toISOString(),
  );
}

describe("bucketBoundaries", () => {
  it("starts days at local midnight", () => {
    expect(boundaries("2026-10-31T16:00:00.000Z", "2026-11-02T03:00:00.000Z", "day", "Asia/Tokyo")).toEqual([
      "2026-10-31T15:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
  });

  it("covers whole buckets, from the one the range starts in through the one it ends in", () => {
    expect(boundaries("2026-10-31T15:00:00.000Z", "2026-11-01T15:00:00.000Z", "day", "Asia/Tokyo")).toEqual([
      "2026-10-31T15:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
    expect(boundaries("2026-11-01T06:00:00.000Z", "2026-11-01T06:00:00.000Z", "day", "Asia/Tokyo")).toEqual([
      "2026-10-31T15:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
    ]);
  });

  it("starts hours on the local hour in time zones offset by half an hour", () => {
    expect(boundaries("2026-11-01T00:40:00.000Z", "2026-11-01T01:50:00.000Z", "hour", "Asia/Kolkata")).toEqual([
      "2026-11-01T00:30:00.000Z",
      "2026-11-01T01:30:00.000Z",
      "2026-11-01T02:30:00.000Z",
    ]);
  });

  it("follows clocks that fall back, giving the day 25 hours", () => {
    expect(boundaries("2026-11-01T12:00:00.000Z", "2026-11-01T12:00:00.000Z", "day", "America/New_York")).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ]);
    expect(
      boundaries("2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z", "hour", "America/New_York"),
    ).toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });

  it("starts a day whose midnight a clock change skips at its first moment", () => {
    // Clocks in Santiago and Beirut move from midnight to 1:00 when daylight saving time starts.
    expect(boundaries("2026-09-06T12:00:00.000Z", "2026-09-06T12:00:00.000Z", "day", "America/Santiago")).toEqual([
      "2026-09-06T04:00:00.000Z",
      "2026-09-07T03:00:00.000Z",
    ]);
    expect(boundaries("2026-03-29T06:00:00.000Z", "2026-03-29T06:00:00.000Z", "day", "Asia/Beirut")).toEqual([
      "2026-03-28T22:00:00.000Z",
      "2026-03-29T21:00:00.000Z",
    ]);
  });

  it("starts weeks on Monday", () => {
    // 2026-11-01 is a Sunday.
    expect(boundaries("2026-11-01T03:00:00.000Z", "2026-11-02T03:00:00.000Z", "week", "Asia/Tokyo")).toEqual([
      "2026-10-25T15:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
      "2026-11-08T15:00:00.000Z",
    ]);
  });

  it("starts months on the first day", () => {
    expect(boundaries("2026-10-15T12:00:00.000Z", "2026-11-15T12:00:00.000Z", "month", "America/New_York")).toEqual([
      "2026-10-01T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-12-01T05:00:00.000Z",
    ]);
    expect(boundaries("2026-12-15T12:00:00.000Z", "2026-12-15T12:00:00.000Z", "month", "Asia/Tokyo")).toEqual([
      "2026-11-30T15:00:00.000Z",
      "2026-12-31T15:00:00.000Z",
    ]);
  });
});

describe("chooseInterval", () => {
  const now = Date.parse("2026-11-01T12:00:00.000Z");
  const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

  it("picks the finest interval that charts the range in at most about 100 buckets", () => {
    expect(chooseInterval(daysAgo(1), now, "auto")).toBe("hour");
    expect(chooseInterval(daysAgo(7), now, "auto")).toBe("day");
    expect(chooseInterval(daysAgo(90), now, "auto")).toBe("day");
    expect(chooseInterval(daysAgo(365), now, "auto")).toBe("week");
    expect(chooseInterval(daysAgo(3 * 365), now, "auto")).toBe("month");
  });

  it("keeps a requested interval unless the range needs more than 400 of its buckets", () => {
    expect(chooseInterval(daysAgo(7), now, "hour")).toBe("hour");
    expect(chooseInterval(daysAgo(30), now, "hour")).toBe("day");
    expect(chooseInterval(daysAgo(365), now, "day")).toBe("day");
    expect(chooseInterval(daysAgo(2 * 365), now, "day")).toBe("week");
    expect(chooseInterval(daysAgo(1), now, "month")).toBe("month");
    expect(chooseInterval(daysAgo(100 * 365), now, "month")).toBe("month");
  });
});

describe("resolveTimeZone", () => {
  it("accepts IANA time zone names", () => {
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back to the local time zone for a missing or unknown name", () => {
    const local = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolveTimeZone(undefined)).toBe(local);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(local);
  });
});
