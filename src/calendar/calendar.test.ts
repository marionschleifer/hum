import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import type { GoogleApi } from "../google/google.ts";
import { listThemes } from "../themes/themes.ts";
import {
  calendarDay,
  calendarSettings,
  hideEvent,
  listCalendars,
  listHiddenEvents,
  saveCalendarSettings,
  setTitleRule,
  themeForTitle,
  unhideEvent,
} from "./calendar.ts";

const tz = "Europe/Zurich";

function fakeApi(byCalendar: Record<string, unknown[]>) {
  const urls: string[] = [];
  const api: GoogleApi = {
    get: async <T>(_email: string, url: string) => {
      urls.push(url);
      if (url.includes("calendarList")) {
        return { items: [{ id: "main@example.com", summary: "main@example.com", primary: true }, { id: "train", summary: "Training plan" }] } as T;
      }
      const id = decodeURIComponent(url.split("/calendars/")[1]!.split("/events")[0]!);
      return { items: byCalendar[id] ?? [] } as T;
    },
  };
  return { api, urls };
}

function connected() {
  const ctx = testCtx();
  saveCalendarSettings(ctx, { account: "main@example.com", mainCalendarId: "main@example.com" });
  return ctx;
}

const timed = (id: string, summary: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  summary,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

describe("calendarDay", () => {
  it("is empty and says so when not connected", async () => {
    expect(await calendarDay(testCtx(), fakeApi({}).api, "2026-10-17", tz)).toEqual({ connected: false, meetings: [] });
  });

  it("queries the local day of the main calendar", async () => {
    const ctx = connected();
    const { api, urls } = fakeApi({
      "main@example.com": [timed("1", "Accounto standup", "2026-10-17T09:00:00+02:00", "2026-10-17T09:30:00+02:00")],
    });
    const day = await calendarDay(ctx, api, "2026-10-17", tz);
    expect(urls[0]).toContain("timeMin=2026-10-16T22%3A00%3A00.000Z");
    expect(urls[0]).toContain("timeMax=2026-10-17T22%3A00%3A00.000Z");
    expect(urls[0]).toContain("singleEvents=true");
    expect(day.meetings).toMatchObject([{ title: "Accounto standup", minutes: 30, blocking: true, themeId: "accounto", themeSource: "name" }]);
  });

  it("drops cancelled, declined and duplicate events and clips to the day", async () => {
    const ctx = connected();
    const { api } = fakeApi({
      "main@example.com": [
        timed("1", "Dinner", "2026-10-17T19:00:00+02:00", "2026-10-17T21:00:00+02:00"),
        timed("2", "dinner ", "2026-10-17T19:00:00+02:00", "2026-10-17T21:00:00+02:00"),
        timed("3", "Cancelled", "2026-10-17T10:00:00+02:00", "2026-10-17T11:00:00+02:00", { status: "cancelled" }),
        timed("4", "Declined", "2026-10-17T10:00:00+02:00", "2026-10-17T11:00:00+02:00", {
          attendees: [{ self: true, responseStatus: "declined" }],
        }),
        timed("5", "Night shift", "2026-10-17T23:00:00+02:00", "2026-10-18T02:00:00+02:00"),
        timed("6", "Busy maybe", "2026-10-17T12:00:00+02:00", "2026-10-17T13:00:00+02:00", { transparency: "transparent" }),
      ],
    });
    const day = await calendarDay(ctx, api, "2026-10-17", tz);
    expect(day.meetings.map((e) => [e.title, e.minutes, e.blocking])).toEqual([
      ["Dinner", 120, true],
      ["Night shift", 60, true],
      ["Busy maybe", 60, false],
    ]);
  });

  it("asks about all-day events too, and hides events Marion discards", async () => {
    const ctx = connected();
    const { api } = fakeApi({
      "main@example.com": [
        { id: "1", summary: "Weekend away", start: { date: "2026-10-17" }, end: { date: "2026-10-18" } },
        { id: "2", summary: "Accounto offsite", start: { date: "2026-10-17" }, end: { date: "2026-10-18" } },
      ],
    });
    const day = await calendarDay(ctx, api, "2026-10-17", tz);
    expect(day.meetings.map((e) => [e.title, e.minutes, e.themeSource])).toEqual([
      ["Weekend away", 0, "unknown"],
      ["Accounto offsite", 0, "name"],
    ]);

    hideEvent(ctx, { id: "1", title: "Weekend away", start: "2026-10-17" });
    expect((await calendarDay(ctx, api, "2026-10-17", tz)).meetings.map((e) => e.title)).toEqual(["Accounto offsite"]);
    expect(listHiddenEvents(ctx)).toEqual([
      { id: "1", title: "Weekend away", start: "2026-10-17", hiddenAt: "2026-10-17T08:00:00.000Z" },
    ]);
    unhideEvent(ctx, "1");
    expect((await calendarDay(ctx, api, "2026-10-17", tz)).meetings).toHaveLength(2);
    expect(() => unhideEvent(ctx, "1")).toThrow("not found");
  });

  it("uses remembered title rules, including 'not a theme'", async () => {
    const ctx = connected();
    setTitleRule(ctx, "Weekly sync", "accounto");
    setTitleRule(ctx, "Lunch with Anna", undefined);
    const { api } = fakeApi({
      "main@example.com": [
        timed("1", "weekly  sync", "2026-10-17T09:00:00+02:00", "2026-10-17T10:00:00+02:00"),
        timed("2", "Lunch with Anna", "2026-10-17T12:00:00+02:00", "2026-10-17T13:00:00+02:00"),
        timed("3", "Workshop", "2026-10-17T14:00:00+02:00", "2026-10-17T15:00:00+02:00"),
      ],
    });
    const day = await calendarDay(ctx, api, "2026-10-17", tz);
    expect(day.meetings.map((e) => [e.title, e.themeId, e.themeSource])).toEqual([
      ["weekly  sync", "accounto", "rule"],
      ["Lunch with Anna", undefined, "ignored"],
      ["Workshop", undefined, "unknown"],
    ]);
  });
});

describe("themeForTitle", () => {
  const themes = listThemes(testCtx());
  const none = new Map<string, string | undefined>();

  it("maps obvious titles by theme name as a whole word", () => {
    expect(themeForTitle("Accounto Hackathon & Team Dinner", themes, none)).toEqual({ themeId: "accounto", themeSource: "name" });
    expect(themeForTitle("Code Blossom mentoring", themes, none).themeId).toBe("code-blossom");
    expect(themeForTitle("Accountability chat", themes, none).themeSource).toBe("unknown");
  });

  it("does not guess when two themes match", () => {
    expect(themeForTitle("Accounto x Code Blossom intro", themes, none).themeSource).toBe("unknown");
  });
});

describe("settings and lists", () => {
  it("stores and clears calendar choices", () => {
    const ctx = connected();
    expect(calendarSettings(ctx)).toEqual({ account: "main@example.com", mainCalendarId: "main@example.com" });
    expect(saveCalendarSettings(ctx, { mainCalendarId: "" })).toEqual({ account: "main@example.com" });
  });

  it("lists calendars", async () => {
    expect(await listCalendars(fakeApi({}).api, "main@example.com")).toEqual([
      { id: "main@example.com", summary: "main@example.com", primary: true },
      { id: "train", summary: "Training plan", primary: false },
    ]);
  });

  it("rejects rules for unknown themes", () => {
    expect(() => setTitleRule(testCtx(), "x", "nope")).toThrow("Unknown theme");
  });
});
