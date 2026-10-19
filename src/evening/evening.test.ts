import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import type { LearnInput, SuggestInput } from "../ai/evening.ts";
import { listLearnings } from "../learnings/learnings.ts";
import { makeDayPlan } from "../planning/dayplans.ts";
import { completeTask, createTask, getTask } from "../tasks/tasks.ts";
import { eveningView, pendingEvening, wrapUpDay } from "./evening.ts";
import { applySuggestion, dismissSuggestion, listPendingSuggestions, ruleSuggestion } from "./suggestions.ts";

const tz = "Europe/Zurich";
const day1 = "2026-10-17";

function setup() {
  const ctx = testCtx();
  const add = (title: string, extra: Record<string, unknown> = {}) =>
    createTask(ctx, { title, source: "manual", themeId: "personal", size: "M", sizeConfirmed: true, ...extra });
  const plan = (today: string, minutes = 240) =>
    makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { personal: minutes } });
  return { ctx, add, plan };
}

describe("eveningView", () => {
  it("lists the day's plan with what got done, plus done tasks outside the plan", async () => {
    const { ctx, add, plan } = setup();
    const done = add("Done one");
    add("Still open");
    await plan(day1);
    const extra = add("Unplanned", { themeId: "hvnly" });
    completeTask(ctx, done.id, day1);
    completeTask(ctx, extra.id, day1);
    const view = eveningView(ctx, day1);
    expect(view.hasPlan).toBe(true);
    expect(view.items.map((i) => [i.task.title, i.doneToday])).toEqual([
      ["Done one", true],
      ["Still open", false],
    ]);
    expect(view.doneUnplanned.map((t) => t.title)).toEqual(["Unplanned"]);
  });

  it("knows when there is no plan", () => {
    expect(eveningView(testCtx(), day1)).toMatchObject({ hasPlan: false, items: [] });
  });
});

describe("wrapUpDay", () => {
  it("records reasons, counts postponements and drops what is no longer relevant", async () => {
    const { ctx, add, plan } = setup();
    const busy = add("Busy");
    const stale = add("Stale");
    const silent = add("Silent");
    await plan(day1);
    const result = await wrapUpDay({ ctx }, day1, [
      { taskId: busy.id, reason: "no_time" },
      { taskId: stale.id, reason: "not_relevant", note: "Event got cancelled" },
    ]);
    expect(result).toMatchObject({ dropped: 1, postponed: 2, suggestions: [] });
    expect(getTask(ctx, busy.id)?.postponeCount).toBe(1);
    expect(getTask(ctx, silent.id)?.postponeCount).toBe(1);
    expect(getTask(ctx, stale.id)).toMatchObject({ status: "dropped", postponeCount: 0 });
    const reasons = ctx.db.query<{ reason: string; note: string | null }, []>("SELECT reason, note FROM postponements ORDER BY reason").all();
    expect(reasons).toEqual([
      { reason: "no_time", note: null },
      { reason: "not_relevant", note: "Event got cancelled" },
      { reason: "other", note: null },
    ]);
    expect(eveningView(ctx, day1).wrappedUpAt).toBe("2026-10-17T08:00:00.000Z");
    await expect(wrapUpDay({ ctx }, day1, [])).rejects.toThrow("already wrapped up");
  });

  it("clears a do-first mark once the day is over", async () => {
    const { ctx, add, plan } = setup();
    const first = add("First", { firstOn: day1 });
    await plan(day1);
    await wrapUpDay({ ctx }, day1, [{ taskId: first.id, reason: "no_time" }]);
    expect(getTask(ctx, first.id)?.firstOn).toBeUndefined();
  });

  it("suggests something after the third postponement, using Claude within the rules", async () => {
    const { ctx, add, plan } = setup();
    const stuck = add("Write grant report", { size: "L" });
    const days = ["2026-10-17", "2026-10-18", "2026-10-19"];
    let seen: SuggestInput | undefined;
    const suggest = async (input: SuggestInput) => {
      seen = input;
      return { suggestions: [{ taskId: stuck.id, action: "break_down", reason: "Start with the outline.", subtasks: ["Outline", " ", "Numbers"] }] };
    };
    for (const [i, day] of days.entries()) {
      await plan(day, 300);
      const result = await wrapUpDay({ ctx, suggest }, day, [{ taskId: stuck.id, reason: "didnt_want" }]);
      expect(result.suggestions.length).toBe(i === 2 ? 1 : 0);
    }
    expect(seen?.tasks[0]).toMatchObject({ title: "Write grant report", ruleAction: "break_down", history: [{}, {}, {}] });
    const [suggestion] = listPendingSuggestions(ctx);
    expect(suggestion).toMatchObject({ action: "break_down", reason: "Start with the outline.", payload: { subtasks: ["Outline", "Numbers"] } });
    applySuggestion(ctx, suggestion!.id, "2026-10-20");
    expect(ctx.db.query("SELECT title FROM tasks WHERE parent_id = ? ORDER BY title").all(stuck.id)).toEqual([
      { title: "Numbers" },
      { title: "Outline" },
    ]);
    expect(getTask(ctx, stuck.id)?.postponeCount).toBe(0);
    expect(listPendingSuggestions(ctx)).toEqual([]);
  });

  it("falls back to rule suggestions when Claude fails and never writes Accounto subtasks", async () => {
    const { ctx, add, plan } = setup();
    const accounto = add("Workflow for Meier", { themeId: "accounto", size: "L" });
    const suggest = async () => ({
      suggestions: [{ taskId: accounto.id, action: "break_down", reason: "Split it.", subtasks: ["Write the mapping"] }],
    });
    for (const day of ["2026-10-17", "2026-10-18", "2026-10-19"]) {
      await makeDayPlan({ ctx }, { today: day, timeZone: tz, energy: "normal", budgets: { accounto: 300 } });
      await wrapUpDay({ ctx, suggest }, day, [{ taskId: accounto.id, reason: "no_time" }]);
    }
    expect(listPendingSuggestions(ctx)[0]).toMatchObject({ action: "break_down", payload: {} });

    const other = add("Other", { size: "S" });
    for (const day of ["2026-10-20", "2026-10-21", "2026-10-22"]) {
      await plan(day);
      await wrapUpDay(
        {
          ctx,
          log: () => {},
          suggest: async () => {
            throw new Error("down");
          },
        },
        day,
        [{ taskId: other.id, reason: "no_time" }],
      );
    }
    expect(listPendingSuggestions(ctx).find((s) => s.taskId === other.id)).toMatchObject({ action: "do_first" });
  });

  it("stores a learning when Claude finds a pattern", async () => {
    const { ctx, add, plan } = setup();
    const a = add("A");
    const b = add("B");
    let seen: LearnInput | undefined;
    const findLearning = async (input: LearnInput) => {
      seen = input;
      return { learning: "Personal tasks slip on busy days." };
    };
    await plan(day1);
    await wrapUpDay({ ctx, findLearning }, day1, [{ taskId: a.id, reason: "no_time" }, { taskId: b.id, reason: "no_time" }]);
    expect(listLearnings(ctx)).toEqual([]);
    await plan("2026-10-18");
    await wrapUpDay({ ctx, findLearning }, "2026-10-18", [{ taskId: a.id, reason: "no_time" }]);
    expect(seen?.postponements.map((p) => p.title)).toEqual(["A", "B", "A", "B"]);
    expect(listLearnings(ctx).map((l) => [l.text, l.source])).toEqual([["Personal tasks slip on busy days.", "evening"]]);
  });

  it("needs a plan and valid reasons", async () => {
    const { ctx, add, plan } = setup();
    await expect(wrapUpDay({ ctx }, day1, [])).rejects.toThrow("no plan");
    const task = add("A");
    await plan(day1);
    await expect(wrapUpDay({ ctx }, day1, [{ taskId: task.id, reason: "meh" as never }])).rejects.toThrow("Invalid reason");
  });
});

describe("pendingEvening", () => {
  it("returns the latest skipped evening and quietly closes older ones", async () => {
    const { ctx, add, plan } = setup();
    add("A");
    await plan("2026-10-15");
    await plan("2026-10-16");
    await plan(day1);
    expect(pendingEvening(ctx, day1)).toBe("2026-10-16");
    expect(eveningView(ctx, "2026-10-15").wrappedUpAt).toBeDefined();
    await wrapUpDay({ ctx }, "2026-10-16", []);
    expect(pendingEvening(ctx, day1)).toBeUndefined();
  });
});

describe("suggestions", () => {
  const base = { taskId: "t", date: day1 };

  function taskWith(extra: Record<string, unknown>) {
    const ctx = testCtx();
    return createTask(ctx, { title: "T", source: "manual", themeId: "personal", ...extra });
  }

  it("follows simple rules", () => {
    const history = (reason: string) => [1, 2, 3].map(() => ({ ...base, reason }));
    expect(ruleSuggestion(taskWith({ size: "S" }), history("blocked"), day1)).toMatchObject({
      action: "reschedule",
      payload: { notBefore: "2026-10-24" },
    });
    expect(ruleSuggestion(taskWith({ size: "S" }), history("didnt_want"), day1).action).toBe("drop");
    expect(ruleSuggestion(taskWith({ size: "S", essential: true }), history("didnt_want"), day1).action).toBe("break_down");
    expect(ruleSuggestion(taskWith({ size: "L" }), history("no_time"), day1).action).toBe("break_down");
    expect(ruleSuggestion(taskWith({ size: "M" }), history("no_time"), day1).action).toBe("do_first");
    expect(ruleSuggestion(taskWith({ size: "L", deadline: "2026-10-18" }), history("no_time"), day1).action).toBe("do_first");
    expect(ruleSuggestion(taskWith({}), history("other"), day1)).toMatchObject({ action: "do_first", reason: "Put off 3 times. Doing it first tomorrow gets it out of the way." });
  });

  it("lets a recent block outweigh skipped answers", () => {
    const history = [
      { ...base, reason: "other" },
      { ...base, reason: "other" },
      { ...base, reason: "blocked", note: "waiting for visa info" },
    ];
    expect(ruleSuggestion(taskWith({ deadline: "2026-10-20" }), history, day1)).toMatchObject({
      action: "reschedule",
      reason: "Put off 3 times, most recently because it was blocked. Hum will bring it back in a week.",
    });
  });

  it("applies do first, reschedule and drop, or can be dismissed", async () => {
    const { ctx, add, plan } = setup();
    const tasks = {
      first: add("first", { size: "S" }),
      later: add("later", { size: "S" }),
      gone: add("gone", { size: "S" }),
      keep: add("keep", { size: "S" }),
    };
    const reasons = { first: "no_time", later: "blocked", gone: "didnt_want", keep: "no_time" } as const;
    for (const day of ["2026-10-17", "2026-10-18", "2026-10-19"]) {
      await plan(day);
      await wrapUpDay({ ctx }, day, Object.entries(tasks).map(([key, task]) => ({ taskId: task.id, reason: reasons[key as keyof typeof reasons] })));
    }
    const pending = new Map(listPendingSuggestions(ctx).map((s) => [s.task.title, s]));
    expect(applySuggestion(ctx, pending.get("first")!.id, "2026-10-20").firstOn).toBe("2026-10-20");
    expect(applySuggestion(ctx, pending.get("later")!.id, "2026-10-20").notBefore).toBe("2026-10-26");
    expect(applySuggestion(ctx, pending.get("gone")!.id, "2026-10-20").status).toBe("dropped");
    dismissSuggestion(ctx, pending.get("keep")!.id);
    expect(getTask(ctx, tasks.keep.id)).toMatchObject({ status: "open", postponeCount: 0 });
    expect(() => dismissSuggestion(ctx, pending.get("keep")!.id)).toThrow("already handled");
  });
});
