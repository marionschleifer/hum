import { describe, expect, it } from "bun:test";
import type { CalendarEvent } from "../calendar/calendar.ts";
import type { TrainingSession } from "../training/training.ts";
import { defaultBudgets, openWorkFor, plannedMinutes } from "./default-budgets.ts";

function meeting(themeId: string | undefined, minutes: number, blocking = true): CalendarEvent {
  return { id: `m${minutes}${themeId}`, title: "Meeting", allDay: false, start: "", end: "", minutes, blocking, themeId, themeSource: themeId ? "name" : "unknown" };
}

function session(kind: TrainingSession["kind"], minMinutes?: number, status: TrainingSession["status"] = "planned"): TrainingSession {
  return { id: kind, date: "2026-11-18", kind, title: kind, minMinutes, status, travel: false };
}

const themes = ["accounto", "code-blossom", "exercise", "learning", "personal"];

describe("defaultBudgets", () => {
  it("starts each theme at the time of its meetings that block time", () => {
    const budgets = defaultBudgets({
      themeIds: themes,
      meetings: [meeting("accounto", 60), meeting("accounto", 30), meeting("code-blossom", 45), meeting("personal", 60, false), meeting(undefined, 90)],
      training: [],
    });
    expect(budgets).toEqual({ accounto: 90, "code-blossom": 45, learning: 60 });
  });

  it("adds today's training to Exercise, leaving out rest and skipped sessions", () => {
    expect(defaultBudgets({ themeIds: themes, meetings: [], training: [session("strength", 60), session("rest")] }).exercise).toBe(60);
    expect(defaultBudgets({ themeIds: themes, meetings: [], training: [session("easy", 40, "skipped")] }).exercise).toBeUndefined();
    expect(defaultBudgets({ themeIds: themes, meetings: [meeting("exercise", 30)], training: [session("intervals")] }).exercise).toBe(90);
  });

  it("gives Learning its hour on top of learning meetings, only when the theme exists", () => {
    expect(defaultBudgets({ themeIds: themes, meetings: [meeting("learning", 30)], training: [] }).learning).toBe(90);
    expect(defaultBudgets({ themeIds: ["accounto"], meetings: [], training: [] })).toEqual({});
  });

  it("ignores meetings of themes that are gone", () => {
    expect(defaultBudgets({ themeIds: ["accounto"], meetings: [meeting("hvnly", 60)], training: [] })).toEqual({});
  });
});

describe("plannedMinutes", () => {
  it("is each theme's meetings plus training for Exercise, without the Learning hour", () => {
    expect(
      plannedMinutes({ themeIds: themes, meetings: [meeting("accounto", 90)], training: [session("strength", 60)] }),
    ).toEqual({ accounto: 90, exercise: 60 });
  });
});

describe("openWorkFor", () => {
  const planned = { accounto: 90 };

  it("makes the time added on top of what is planned open work", () => {
    expect(openWorkFor({ budgets: { accounto: 240, personal: 60 }, planned, chosen: {} })).toEqual({ accounto: 150, personal: 60 });
  });

  it("keeps an open-work value set by hand, never above the budget", () => {
    expect(openWorkFor({ budgets: { accounto: 240, personal: 60 }, planned, chosen: { accounto: 30, personal: 120 } })).toEqual({ accounto: 30, personal: 60 });
  });

  it("has no open work where the budget is only meetings, or below them", () => {
    expect(openWorkFor({ budgets: { accounto: 90 }, planned, chosen: {} })).toEqual({});
    expect(openWorkFor({ budgets: { accounto: 60 }, planned, chosen: {} })).toEqual({});
  });
});
