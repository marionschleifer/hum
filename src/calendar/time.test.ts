import { describe, expect, it } from "bun:test";
import { addDays, daysBetween, isValidTimeZone, localDay, zonedMidnight } from "./time.ts";

describe("zonedMidnight", () => {
  it("finds local midnight in summer and winter time", () => {
    expect(zonedMidnight("2026-10-17", "Europe/Zurich").toISOString()).toBe("2026-10-16T22:00:00.000Z");
    expect(zonedMidnight("2026-11-04", "Europe/Zurich").toISOString()).toBe("2026-11-03T23:00:00.000Z");
    expect(zonedMidnight("2026-10-17", "Africa/Nairobi").toISOString()).toBe("2026-10-16T21:00:00.000Z");
    expect(zonedMidnight("2026-10-17", "UTC").toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });

  it("handles the day clocks change", () => {
    expect(zonedMidnight("2026-10-25", "Europe/Zurich").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(zonedMidnight("2026-10-26", "Europe/Zurich").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("day helpers", () => {
  it("reads the local day of an instant", () => {
    expect(localDay(new Date("2026-10-16T22:30:00Z"), "Europe/Zurich")).toBe("2026-10-17");
  });

  it("adds and counts days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-17", "2026-10-20")).toBe(3);
    expect(daysBetween("2026-10-17", "2026-10-15")).toBe(-2);
  });

  it("validates time zones", () => {
    expect(isValidTimeZone("Europe/Zurich")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});
