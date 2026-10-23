import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { makeDayPlan } from "../planning/dayplans.ts";
import { recentTimeRecords, recordTimeSpent, timeSpentOn, weekSummary } from "./timespent.ts";

const tz = "Europe/Zurich";

async function planned(days: { date: string; budgets: Record<string, number>; openWork?: Record<string, number>; energy?: "normal" | "sick" }[]) {
  const ctx = testCtx();
  for (const day of days) {
    await makeDayPlan({ ctx }, { today: day.date, timeZone: tz, energy: day.energy ?? "normal", budgets: day.budgets, openWork: day.openWork });
  }
  return ctx;
}

describe("recordTimeSpent", () => {
  it("stores the minutes per theme for a planned day and can be changed later", async () => {
    const ctx = await planned([{ date: "2026-10-19", budgets: { accounto: 360 } }]);
    expect(timeSpentOn(ctx, "2026-10-19")).toBeUndefined();
    expect(recordTimeSpent(ctx, "2026-10-19", { accounto: 330.4, personal: 0 })).toEqual({ accounto: 330, personal: 0 });
    recordTimeSpent(ctx, "2026-10-19", { accounto: 300 });
    expect(timeSpentOn(ctx, "2026-10-19")).toEqual({ accounto: 300 });
  });

  it("refuses days without a plan, unknown themes and impossible minutes", async () => {
    const ctx = await planned([{ date: "2026-10-19", budgets: { accounto: 60 } }]);
    expect(() => recordTimeSpent(ctx, "2026-10-20", { accounto: 60 })).toThrow("no plan");
    expect(() => recordTimeSpent(ctx, "2026-10-19", { nope: 60 })).toThrow("Unknown theme");
    expect(() => recordTimeSpent(ctx, "2026-10-19", { accounto: -1 })).toThrow("Invalid time for Accounto");
    expect(() => recordTimeSpent(ctx, "2026-10-19", { accounto: 25 * 60 })).toThrow("Invalid time for Accounto");
  });
});

describe("weekSummary", () => {
  it("compares budget and time spent per theme, per day and for the week", async () => {
    const ctx = await planned([
      { date: "2026-10-19", budgets: { accounto: 360, personal: 60 }, openWork: { accounto: 120 } },
      { date: "2026-10-20", budgets: { accounto: 240 } },
      { date: "2026-10-21", budgets: { accounto: 300 }, energy: "sick" },
    ]);
    recordTimeSpent(ctx, "2026-10-19", { accounto: 420, personal: 30 });
    const week = weekSummary(ctx, "2026-10-22");
    expect(week.monday).toBe("2026-10-19");
    expect(week.days.map((d) => [d.date, d.planned, d.recorded])).toEqual([
      ["2026-10-19", true, true],
      ["2026-10-20", true, false],
      ["2026-10-21", true, false],
      ["2026-10-22", false, false],
      ["2026-10-23", false, false],
      ["2026-10-24", false, false],
      ["2026-10-25", false, false],
    ]);
    expect(week.days[0]!.themes.find((t) => t.themeId === "accounto")).toEqual({ themeId: "accounto", budget: 360, openMinutes: 120, spent: 420 });
    expect(week.days[1]!.themes.find((t) => t.themeId === "accounto")).toEqual({ themeId: "accounto", budget: 240, openMinutes: 0 });
    expect(week.days[2]!.themes.find((t) => t.themeId === "accounto")?.budget).toBe(0);
    expect(week.totals.find((t) => t.themeId === "accounto")).toEqual({
      themeId: "accounto",
      budget: 600,
      spent: 420,
      budgetOnRecordedDays: 360,
      recordedDays: 1,
    });
    expect(week.totals.find((t) => t.themeId === "personal")).toMatchObject({ budget: 60, spent: 30, budgetOnRecordedDays: 60 });
  });
});

describe("recentTimeRecords", () => {
  it("lists recorded days of the last two weeks with budgets, for learnings", async () => {
    const ctx = await planned([
      { date: "2026-10-01", budgets: { accounto: 300 } },
      { date: "2026-10-19", budgets: { accounto: 360, hvnly: 0 }, openWork: { accounto: 60 } },
      { date: "2026-10-20", budgets: { accounto: 240 } },
    ]);
    recordTimeSpent(ctx, "2026-10-01", { accounto: 300 });
    recordTimeSpent(ctx, "2026-10-19", { accounto: 420, hvnly: 0 });
    expect(recentTimeRecords(ctx, "2026-10-20")).toEqual([
      { date: "2026-10-19", theme: "Accounto", budget: 360, openMinutes: 60, spent: 420 },
    ]);
  });
});
