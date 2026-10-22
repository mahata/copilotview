import { describe, expect, it } from "vitest";
import { periodStart } from "../web/src/period";

describe("periodStart", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");

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
