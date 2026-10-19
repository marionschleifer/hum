import { describe, expect, it } from "bun:test";
import {
  currentMonthlyOccurrence,
  describeRecurrence,
  monthlyOccurrence,
  nextMonthlyOccurrence,
  parseRecurrence,
  periodProgress,
  startOfWeek,
} from "./recurrence.ts";

describe("parseRecurrence", () => {
  it("accepts N times per week", () => {
    expect(parseRecurrence({ kind: "count", times: 3, per: "week" })).toEqual({ kind: "count", times: 3, per: "week" });
  });

  it("sorts weekdays into week order", () => {
    expect(parseRecurrence({ kind: "weekdays", days: ["fri", "mon"] })).toEqual({ kind: "weekdays", days: ["mon", "fri"] });
  });

  it("rejects nonsense", () => {
    expect(() => parseRecurrence({ kind: "count", times: 0, per: "week" })).toThrow("Invalid recurrence");
    expect(() => parseRecurrence({ kind: "weekdays", days: ["funday"] })).toThrow("Invalid recurrence");
    expect(() => parseRecurrence({ kind: "every", interval: 2, unit: "year" })).toThrow("Invalid recurrence");
    expect(() => parseRecurrence(undefined)).toThrow("Invalid recurrence");
  });
});

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence({ kind: "count", times: 2, per: "week" })).toBe("Twice a week");
    expect(describeRecurrence({ kind: "count", times: 4, per: "month" })).toBe("4 times a month");
    expect(describeRecurrence({ kind: "weekdays", days: ["mon", "thu"] })).toBe("Every Mon, Thu");
    expect(describeRecurrence({ kind: "every", interval: 1, unit: "day" })).toBe("Every day");
    expect(describeRecurrence({ kind: "every", interval: 2, unit: "week" })).toBe("Every 2 weeks");
  });
});

describe("periodProgress", () => {
  it("counts completions since Monday for weekly counts", () => {
    const progress = periodProgress(
      { kind: "count", times: 3, per: "week" },
      ["2026-10-11", "2026-10-12", "2026-10-15"],
      "2026-10-17",
    );
    expect(progress).toEqual({ done: 2, target: 3, periodStart: "2026-10-12" });
  });

  it("counts completions since the first of the month for monthly counts", () => {
    const progress = periodProgress({ kind: "count", times: 2, per: "month" }, ["2026-09-30", "2026-10-01"], "2026-10-17");
    expect(progress?.done).toBe(1);
  });

  it("has no progress for other kinds", () => {
    expect(periodProgress({ kind: "weekdays", days: ["mon"] }, [], "2026-10-17")).toBeUndefined();
  });
});

describe("startOfWeek", () => {
  it("returns Monday, also for Sundays", () => {
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
  });
});

describe("monthly recurrence", () => {
  it("accepts a day of the month or an nth working day, but not both", () => {
    expect(parseRecurrence({ kind: "monthly", day: 20 })).toEqual({ kind: "monthly", day: 20 });
    expect(parseRecurrence({ kind: "monthly", workday: 1 })).toEqual({ kind: "monthly", workday: 1 });
    expect(parseRecurrence({ kind: "monthly", day: -1 })).toEqual({ kind: "monthly", day: -1 });
    expect(() => parseRecurrence({ kind: "monthly", day: 20, workday: 1 })).toThrow("Invalid recurrence");
    expect(() => parseRecurrence({ kind: "monthly", day: 32 })).toThrow("Invalid recurrence");
    expect(() => parseRecurrence({ kind: "monthly", workday: 6 })).toThrow("Invalid recurrence");
  });

  it("reads naturally", () => {
    expect(describeRecurrence({ kind: "monthly", day: 20 })).toBe("Every 20th of the month");
    expect(describeRecurrence({ kind: "monthly", day: 1 })).toBe("Every 1st of the month");
    expect(describeRecurrence({ kind: "monthly", day: 22 })).toBe("Every 22nd of the month");
    expect(describeRecurrence({ kind: "monthly", day: 11 })).toBe("Every 11th of the month");
    expect(describeRecurrence({ kind: "monthly", day: -1 })).toBe("Last day of the month");
    expect(describeRecurrence({ kind: "monthly", workday: 1 })).toBe("First working day of the month");
    expect(describeRecurrence({ kind: "monthly", workday: -1 })).toBe("Last working day of the month");
  });

  it("finds the date in a month, clamping short months and skipping weekends", () => {
    expect(monthlyOccurrence({ kind: "monthly", day: 31 }, 2026, 2)).toBe("2026-02-28");
    expect(monthlyOccurrence({ kind: "monthly", day: -1 }, 2026, 11)).toBe("2026-11-30");
    expect(monthlyOccurrence({ kind: "monthly", workday: 1 }, 2026, 11)).toBe("2026-11-02");
    expect(monthlyOccurrence({ kind: "monthly", workday: 2 }, 2026, 8)).toBe("2026-08-04");
    expect(monthlyOccurrence({ kind: "monthly", workday: -1 }, 2026, 10)).toBe("2026-10-30");
  });

  it("finds the current and next occurrence around today", () => {
    const rule = { kind: "monthly" as const, day: 20 };
    expect(currentMonthlyOccurrence(rule, "2026-10-17")).toBe("2026-09-20");
    expect(currentMonthlyOccurrence(rule, "2026-10-20")).toBe("2026-10-20");
    expect(currentMonthlyOccurrence(rule, "2026-01-05")).toBe("2025-12-20");
    expect(nextMonthlyOccurrence(rule, "2026-10-17")).toBe("2026-10-20");
    expect(nextMonthlyOccurrence(rule, "2026-12-20")).toBe("2027-01-20");
  });
});
