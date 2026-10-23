import { describe, expect, it } from "bun:test";
import { freshTestCtx, testCtx } from "../../test/helpers.ts";
import {
  addSession,
  moveSession,
  sessionMinutes,
  sessionsOn,
  setTrainingTemplate,
  TEN_K_WEEK,
  trainingTemplate,
  trainingWeek,
  updateSession,
  weekWarnings,
  type SessionKind,
  type SessionStatus,
  type TrainingSession,
} from "./training.ts";

let counter = 0;
function session(date: string, kind: SessionKind, status: SessionStatus = "planned"): TrainingSession {
  const titles: Record<SessionKind, string> = {
    strength: "Strength",
    intervals: "Intervals",
    easy: "Easy run",
    tempo: "Tempo run",
    long: "Long run",
    rest: "Rest",
  };
  return { id: `s${++counter}`, date, kind, title: titles[kind], status, travel: false };
}

const monday = "2026-10-19";

function week(ctx = testCtx(), today = monday) {
  return trainingWeek(ctx, monday, today);
}

function layout(sessions: { date: string; title: string }[]) {
  return sessions.map((s) => `${s.date.slice(8)} ${s.title}`);
}

describe("trainingWeek", () => {
  it("fills a new week from the template, once", () => {
    const ctx = testCtx();
    const first = week(ctx);
    expect(layout(first.sessions)).toEqual([
      "19 Strength",
      "20 Intervals",
      "21 Easy run",
      "22 Strength",
      "23 Tempo run",
      "24 Rest",
      "25 Long run",
    ]);
    expect(first.sessions[2]).toMatchObject({ minMinutes: 40, maxMinutes: 50, status: "planned" });
    expect(first.warnings).toEqual([]);
    expect(trainingWeek(ctx, "2026-10-22", monday).sessions.map((s) => s.id)).toEqual(first.sessions.map((s) => s.id));
  });

  it("finds a day's sessions, creating the week when needed", () => {
    expect(sessionsOn(testCtx(), "2026-10-25").map((s) => s.title)).toEqual(["Long run"]);
  });
});

describe("training template", () => {
  it("starts empty on a fresh install, so there is no training and no warning", () => {
    const ctx = freshTestCtx();
    expect(trainingTemplate(ctx)).toEqual([]);
    expect(week(ctx)).toEqual({ monday, sessions: [], warnings: [] });
    expect(sessionsOn(ctx, "2026-10-25")).toEqual([]);
  });

  it("fills weeks from the template once one is set", () => {
    const ctx = freshTestCtx();
    week(ctx);
    setTrainingTemplate(ctx, [
      { day: 0, kind: "strength", minMinutes: 45 },
      { day: 3, kind: "easy", minMinutes: 30, maxMinutes: 40 },
    ]);
    expect(layout(week(ctx).sessions)).toEqual(["19 Strength", "22 Easy run"]);
    expect(week(ctx).sessions[0]).toMatchObject({ minMinutes: 45 });
  });

  it("leaves weeks that are already filled as they are", () => {
    const ctx = testCtx();
    const before = week(ctx).sessions.map((s) => s.id);
    setTrainingTemplate(ctx, [{ day: 0, kind: "rest" }]);
    expect(week(ctx).sessions.map((s) => s.id)).toEqual(before);
    expect(layout(trainingWeek(ctx, "2026-10-26", monday).sessions)).toEqual(["26 Rest"]);
  });

  it("keeps the 10k week as a ready-made template", () => {
    expect(TEN_K_WEEK.map((entry) => entry.kind)).toEqual(["strength", "intervals", "easy", "strength", "tempo", "rest", "long"]);
    expect(trainingTemplate(testCtx())).toEqual(TEN_K_WEEK);
  });

  it("rejects templates it cannot fill", () => {
    const ctx = freshTestCtx();
    expect(() => setTrainingTemplate(ctx, [{ day: 7, kind: "easy" }])).toThrow("Invalid day");
    expect(() => setTrainingTemplate(ctx, [{ day: 1, kind: "yoga" as never }])).toThrow("Invalid session");
    expect(() => setTrainingTemplate(ctx, [{ day: 1, kind: "easy" }, { day: 1, kind: "long" }])).toThrow("one session per day");
    expect(() => setTrainingTemplate(ctx, [{ day: 1, kind: "easy", minMinutes: 0 }])).toThrow("Invalid minutes");
    expect(() => setTrainingTemplate(ctx, [{ day: 1, kind: "easy", minMinutes: 50, maxMinutes: 40 }])).toThrow("Invalid minutes");
    expect(trainingTemplate(ctx)).toEqual([]);
  });

  it("sorts the template by day and drops minutes from rest days", () => {
    const ctx = freshTestCtx();
    setTrainingTemplate(ctx, [{ day: 6, kind: "long", minMinutes: 80 }, { day: 2, kind: "rest", minMinutes: 20 }]);
    expect(trainingTemplate(ctx)).toEqual([{ day: 2, kind: "rest" }, { day: 6, kind: "long", minMinutes: 80 }]);
  });
});

describe("moveSession", () => {
  it("swaps with what is on the target day", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    const intervals = sessions.find((s) => s.kind === "intervals")!;
    const moved = moveSession(ctx, intervals.id, "2026-10-21");
    expect(layout(moved)).toEqual([
      "19 Strength",
      "20 Easy run",
      "21 Intervals",
      "22 Strength",
      "23 Tempo run",
      "24 Rest",
      "25 Long run",
    ]);
  });

  it("stays within the week", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    expect(() => moveSession(ctx, sessions[0]!.id, "2026-10-26")).toThrow("within their week");
  });
});

describe("rules", () => {
  it("warns when hard sessions are too close, after the long run, or the rest day is gone", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    const byKind = (kind: string) => sessions.find((s) => s.kind === kind)!;
    moveSession(ctx, byKind("tempo").id, "2026-10-21");
    expect(week(ctx).warnings.map((w) => w.message)).toEqual(["Intervals and Tempo run are less than 48 hours apart."]);
    moveSession(ctx, byKind("tempo").id, "2026-10-23");
    moveSession(ctx, byKind("long").id, "2026-10-19");
    expect(week(ctx).warnings.map((w) => w.message)).toEqual(["Intervals is the day after the long run."]);
  });

  it("warns when no full rest day is left", () => {
    const busy = ["19", "20", "21", "22", "23", "24", "25"].map((day, i) => session(`2026-10-${day}`, i % 2 ? "strength" : "easy"));
    expect(weekWarnings(busy, monday).map((w) => w.message)).toContain("This week has no full rest day.");
  });

  it("suggests skipping the easy run first, then a strength session, when the week no longer fits", () => {
    const past = [
      session("2026-10-19", "strength", "done"),
      session("2026-10-20", "intervals", "done"),
      session("2026-10-21", "tempo", "done"),
      session("2026-10-22", "strength", "done"),
      session("2026-10-23", "strength", "done"),
    ];
    const easy = session("2026-10-24", "easy");
    const long = session("2026-10-25", "long");
    expect(weekWarnings([...past, easy, long], "2026-10-24").find((w) => w.skipSessionId)).toEqual({
      message: "This week has more sessions left than free days. Skip the easy run first.",
      skipSessionId: easy.id,
    });
    const strength = session("2026-10-24", "strength");
    expect(weekWarnings([...past, strength, long], "2026-10-24").find((w) => w.skipSessionId)?.skipSessionId).toBe(strength.id);
    const withRest = weekWarnings([...past.slice(0, 4), session("2026-10-23", "rest"), easy, long], "2026-10-24");
    expect(withRest.some((w) => w.message.includes("more sessions left"))).toBe(false);
  });

  it("treats sick days as unavailable", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    updateSession(ctx, sessions.find((s) => s.date === "2026-10-23")!.id, { status: "sick" });
    expect(trainingWeek(ctx, monday, "2026-10-23").sessions.find((s) => s.kind === "tempo")?.status).toBe("sick");
  });
});

describe("changing a session's kind", () => {
  it("turns a long run into an easy run with the template's easy minutes", () => {
    const ctx = testCtx();
    const long = week(ctx).sessions.find((s) => s.kind === "long")!;
    expect(updateSession(ctx, long.id, { kind: "easy" })).toMatchObject({ kind: "easy", title: "Easy run", minMinutes: 40, maxMinutes: 50 });
  });

  it("makes an extra rest day, which counts no minutes and clears travel", () => {
    const ctx = testCtx();
    const strength = week(ctx).sessions[0]!;
    updateSession(ctx, strength.id, { travel: true });
    const rest = updateSession(ctx, strength.id, { kind: "rest" });
    expect(rest).toMatchObject({ kind: "rest", title: "Rest", travel: false, minMinutes: undefined, maxMinutes: undefined });
    expect(sessionMinutes(rest)).toBe(0);
    expect(layout(week(ctx).sessions)).toContain("19 Rest");
  });

  it("falls back to the 10k minutes for a kind the template does not have, and rejects unknown kinds", () => {
    const ctx = freshTestCtx();
    setTrainingTemplate(ctx, [{ day: 0, kind: "strength", minMinutes: 45 }]);
    const strength = week(ctx).sessions[0]!;
    expect(updateSession(ctx, strength.id, { kind: "long" })).toMatchObject({ minMinutes: 75, maxMinutes: 100 });
    expect(() => updateSession(ctx, strength.id, { kind: "yoga" as never })).toThrow("Invalid session");
  });
});

describe("addSession", () => {
  it("adds a session to a day with nothing planned", () => {
    const ctx = freshTestCtx();
    setTrainingTemplate(ctx, [{ day: 0, kind: "strength", minMinutes: 45 }]);
    week(ctx);
    const added = addSession(ctx, "2026-10-22", "tempo");
    expect(added).toMatchObject({ date: "2026-10-22", kind: "tempo", status: "planned", minMinutes: 30, maxMinutes: 30 });
    expect(layout(week(ctx).sessions)).toEqual(["19 Strength", "22 Tempo run"]);
  });

  it("only adds to an empty day, and fills the week first", () => {
    const ctx = testCtx();
    expect(() => addSession(ctx, "2026-10-20", "easy")).toThrow("already has a session");
    expect(() => addSession(ctx, "2026-10-20", "yoga" as never)).toThrow("Invalid session");
  });
});

describe("updateSession", () => {
  it("marks done, sick for the whole day, and travel makes strength bodyweight", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    const strength = sessions[0]!;
    expect(updateSession(ctx, strength.id, { travel: true }).title).toBe("Bodyweight strength");
    expect(updateSession(ctx, strength.id, { status: "done", note: " felt good " })).toMatchObject({ status: "done", note: "felt good" });
    expect(() => updateSession(ctx, strength.id, { status: "meh" as never })).toThrow("Invalid status");
  });

  it("counts minutes only for sessions that happen", () => {
    const ctx = testCtx();
    const { sessions } = week(ctx);
    expect(sessions.map(sessionMinutes)).toEqual([60, 60, 40, 60, 30, 0, 75]);
    expect(sessionMinutes(updateSession(ctx, sessions[1]!.id, { status: "skipped" }))).toBe(0);
  });
});
