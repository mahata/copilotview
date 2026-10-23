import { afterEach, describe, expect, it, vi } from "vitest";
import { describePeriod, periodRange, periodStart } from "../web/src/period";

const now = Date.parse("2026-10-23T12:00:00.000Z");

function custom(periodFrom: string, periodTo: string) {
  return { period: "custom", periodFrom, periodTo };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("periodStart", () => {
  it("leaves all time unbounded", () => {
    expect(periodStart("", now)).toBeUndefined();
  });

  it("starts each preset its length before now", () => {
    expect(periodStart("24h", now)).toBe("2026-10-22T12:00:00.000Z");
    expect(periodStart("7d", now)).toBe("2026-10-16T12:00:00.000Z");
    expect(periodStart("30d", now)).toBe("2026-09-23T12:00:00.000Z");
    expect(periodStart("90d", now)).toBe("2026-07-25T12:00:00.000Z");
    expect(periodStart("1y", now)).toBe("2025-10-23T12:00:00.000Z");
  });

  it("leaves unknown presets unbounded", () => {
    expect(periodStart("forever", now)).toBeUndefined();
  });
});

describe("periodRange", () => {
  it("bounds presets only at the start and ignores the custom dates", () => {
    expect(periodRange({ period: "7d", periodFrom: "2026-01-01", periodTo: "2026-01-31" }, now)).toEqual({
      from: "2026-10-16T12:00:00.000Z",
    });
    expect(periodRange({ period: "", periodFrom: "2026-01-01", periodTo: "2026-01-31" }, now)).toEqual({});
  });

  it("covers whole days of a custom range in the browser's time zone", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(periodRange(custom("2026-10-01", "2026-10-15"), now)).toEqual({
      from: "2026-09-30T15:00:00.000Z",
      to: "2026-10-15T14:59:59.999Z",
    });
  });

  it("ends a custom range at midnight on days when daylight saving time changes", () => {
    vi.stubEnv("TZ", "America/New_York");
    // Clocks fall back during 2026-11-01, so the day lasts 25 hours.
    expect(periodRange(custom("2026-11-01", "2026-11-01"), now)).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T04:59:59.999Z",
    });
  });

  it("leaves either end of a custom range open when its date is empty", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(periodRange(custom("2026-10-01", ""), now)).toEqual({ from: "2026-09-30T15:00:00.000Z" });
    expect(periodRange(custom("", "2026-10-15"), now)).toEqual({ to: "2026-10-15T14:59:59.999Z" });
    expect(periodRange(custom("", ""), now)).toEqual({});
  });

  it("leaves an end open instead of throwing when its day is past the last representable time", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(periodRange(custom("275760-09-13", "275760-09-13"), now)).toEqual({
      from: "+275760-09-12T15:00:00.000Z",
    });
  });
});

describe("describePeriod", () => {
  it("names all time and presets", () => {
    expect(describePeriod({ period: "", periodFrom: "", periodTo: "" })).toBe("for the complete index");
    expect(describePeriod({ period: "7d", periodFrom: "2026-10-01", periodTo: "" })).toBe("for the past 7 days");
  });

  it("names the days of a custom range", () => {
    expect(describePeriod(custom("2026-10-01", "2026-10-15"))).toBe("from Oct 1, 2026 through Oct 15, 2026");
    expect(describePeriod(custom("2026-10-01", "2026-10-01"))).toBe("for Oct 1, 2026");
    expect(describePeriod(custom("2026-10-01", ""))).toBe("since Oct 1, 2026");
    expect(describePeriod(custom("", "2026-10-15"))).toBe("through Oct 15, 2026");
    expect(describePeriod(custom("", ""))).toBe("for the complete index");
  });

  it("keeps the picked day in time zones behind UTC", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(describePeriod(custom("2026-10-01", "2026-10-15"))).toBe("from Oct 1, 2026 through Oct 15, 2026");
  });
});
