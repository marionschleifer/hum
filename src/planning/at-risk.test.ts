import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { createTask, getTask, updateTask } from "../tasks/tasks.ts";
import { giveTimeToday, letGo, moveAtRisk, moveDeadline, scheduleForTomorrow, splitFirstStep } from "./at-risk.ts";
import { makeDayPlan, todayView } from "./dayplans.ts";

const today = "2026-10-17";
const tz = "Europe/Zurich";

function setup() {
  const ctx = testCtx();
  const add = (title: string, extra: Record<string, unknown> = {}) =>
    createTask(ctx, { title, source: "manual", themeId: "code-blossom", size: "M", sizeConfirmed: true, ...extra });
  return { ctx, add };
}

describe("scheduleForTomorrow", () => {
  it("picks the task for tomorrow and clears today's warning", async () => {
    const { ctx, add } = setup();
    const grant = add("Apply for the grant", { deadline: "2026-10-19" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: {} });
    expect((await todayView({ ctx }, today, tz)).warnings).toHaveLength(1);

    const scheduled = scheduleForTomorrow(ctx, grant.id, today);
    expect(scheduled).toMatchObject({ task: { firstOn: "2026-10-18" }, noBuffer: false });
    expect((await todayView({ ctx }, today, tz)).warnings).toEqual([]);
  });

  it("says when tomorrow is the deadline and no buffer is left", () => {
    const { ctx, add } = setup();
    expect(scheduleForTomorrow(ctx, add("Due tomorrow", { deadline: "2026-10-18" }).id, today).noBuffer).toBe(true);
    expect(scheduleForTomorrow(ctx, add("Overdue", { deadline: "2026-10-10" }).id, today).noBuffer).toBe(true);
  });

  it("refuses tasks that are not open", () => {
    const { ctx } = setup();
    const inbox = createTask(ctx, { title: "Unsorted", source: "manual" });
    expect(() => scheduleForTomorrow(ctx, inbox.id, today)).toThrow("Only open tasks can be scheduled");
  });
});

describe("splitFirstStep", () => {
  it("adds a small first step for today in the same theme", async () => {
    const { ctx, add } = setup();
    const grant = add("Apply for the grant", { size: "L", deadline: "2026-10-18", priority: "high" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "sick", budgets: {} });

    const step = splitFirstStep(ctx, grant.id, today, "Open the application form");
    expect(step).toMatchObject({
      title: "Open the application form",
      themeId: "code-blossom",
      size: "S",
      priority: "high",
      firstOn: today,
      status: "open",
    });
    expect(getTask(ctx, grant.id)).toMatchObject({ size: "L", status: "open" });
    const plan = (await todayView({ ctx }, today, tz)).plan!;
    expect(plan.themes.find((t) => t.themeId === "code-blossom")!.items.map((i) => i.task.title)).toEqual(["Open the application form"]);
    expect((await todayView({ ctx }, today, tz)).warnings.map((w) => w.title)).toEqual(["Apply for the grant"]);
  });

  it("needs a title", () => {
    const { ctx, add } = setup();
    expect(() => splitFirstStep(ctx, add("Big").id, today, "  ")).toThrow();
  });
});

describe("sick-day moves", () => {
  it("previews where each task lands and changes nothing until accepted", async () => {
    const { ctx, add } = setup();
    const grant = add("Grant", { deadline: "2026-10-18" });
    const chanel = add("Reach out to Chanel", { deadline: "2026-10-19", themeId: "personal" });
    const later = add("Report", { deadline: "2026-10-20", size: "S" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "sick", budgets: { "code-blossom": 120, personal: 60 } });

    const view = await todayView({ ctx }, today, tz);
    expect(view.sickMoves?.map((m) => [m.title, m.day, m.noBuffer])).toEqual([
      ["Grant", "2026-10-18", true],
      ["Reach out to Chanel", "2026-10-18", false],
      ["Report", "2026-10-19", false],
    ]);
    expect([grant, chanel, later].map((t) => getTask(ctx, t.id)!.firstOn)).toEqual([undefined, undefined, undefined]);

    moveAtRisk(ctx, today, view.sickMoves!.map(({ taskId, day }) => ({ taskId, day })));
    expect([grant, chanel, later].map((t) => getTask(ctx, t.id)!.firstOn)).toEqual(["2026-10-18", "2026-10-18", "2026-10-19"]);
    const after = await todayView({ ctx }, today, tz);
    expect(after.warnings).toEqual([]);
    expect(after.sickMoves).toBeUndefined();
  });

  it("offers no moves on a day that is not sick", async () => {
    const { ctx, add } = setup();
    add("Grant", { deadline: "2026-10-18" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "lower", budgets: {} });
    const view = await todayView({ ctx }, today, tz);
    expect(view.warnings).toHaveLength(1);
    expect(view.sickMoves).toBeUndefined();
  });

  it("refuses moves to today or earlier", () => {
    const { ctx, add } = setup();
    expect(() => moveAtRisk(ctx, today, [{ taskId: add("Grant").id, day: today }])).toThrow("Move tasks to a later day");
  });
});

describe("giveTimeToday", () => {
  it("moves minutes from another theme and puts the task in today's plan", async () => {
    const { ctx, add } = setup();
    const grant = add("Grant", { deadline: "2026-10-18", size: "S" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 120 } });
    expect((await todayView({ ctx }, today, tz)).warnings).toHaveLength(1);

    giveTimeToday(ctx, grant.id, today, 30, "accounto");
    const view = await todayView({ ctx }, today, tz);
    expect(view.plan!.budgets).toMatchObject({ accounto: 90, "code-blossom": 30 });
    expect(view.plan!.themes.find((t) => t.themeId === "code-blossom")!.items.map((i) => i.task.title)).toEqual(["Grant"]);
    expect(view.warnings).toEqual([]);
  });

  it("takes time from free time without touching other themes", async () => {
    const { ctx, add } = setup();
    const grant = add("Grant", { deadline: "2026-10-18" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 120 } });
    giveTimeToday(ctx, grant.id, today, 15, undefined);
    expect((await todayView({ ctx }, today, tz)).plan!.budgets).toMatchObject({ accounto: 120, "code-blossom": 15 });
  });

  it("refuses odd amounts, a theme without enough time, and days without a plan", async () => {
    const { ctx, add } = setup();
    const grant = add("Grant", { deadline: "2026-10-18" });
    expect(() => giveTimeToday(ctx, grant.id, today, 15, undefined)).toThrow("Plan the day first");
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 20 } });
    expect(() => giveTimeToday(ctx, grant.id, today, 45, undefined)).toThrow("Give 15 or 30 minutes");
    expect(() => giveTimeToday(ctx, grant.id, today, 30, "accounto")).toThrow("That theme does not have that much time today");
    expect(() => giveTimeToday(ctx, grant.id, today, 15, "code-blossom")).toThrow("Take the time from another theme");
  });
});

describe("moveDeadline", () => {
  it("moves soft deadlines only, and only into the future", () => {
    const { ctx, add } = setup();
    const soft = add("Chanel", { deadline: "2026-10-19" });
    const fixed = add("Grant", { deadline: "2026-10-18", deadlineFixed: true });
    expect(moveDeadline(ctx, soft.id, today, "2026-10-24").deadline).toBe("2026-10-24");
    expect(() => moveDeadline(ctx, soft.id, today, today)).toThrow("Pick a day after today");
    expect(() => moveDeadline(ctx, fixed.id, today, "2026-10-24")).toThrow("This deadline is fixed");
  });
});

describe("letGo", () => {
  it("records the decision and silences the warning for that deadline only", async () => {
    const { ctx, add } = setup();
    const chanel = add("Chanel", { deadline: "2026-10-19" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: {} });
    letGo(ctx, chanel.id, today);
    expect(ctx.db.query("SELECT task_id, date, deadline, decision FROM deadline_decisions").all()).toEqual([
      { task_id: chanel.id, date: today, deadline: "2026-10-19", decision: "let_go" },
    ]);
    expect(getTask(ctx, chanel.id)!.status).toBe("open");
    expect((await todayView({ ctx }, today, tz)).warnings).toEqual([]);

    updateTask(ctx, chanel.id, { deadline: "2026-10-20" });
    expect((await todayView({ ctx }, today, tz)).warnings.map((w) => w.title)).toEqual(["Chanel"]);
  });
});

describe("fit check and stakes", () => {
  it("compares the task with tomorrow's usual free time in its theme", async () => {
    const { ctx, add } = setup();
    for (const [day, minutes] of [["2026-10-14", 60], ["2026-10-15", 120], ["2026-10-16", 0]] as const) {
      await makeDayPlan({ ctx }, { today: day, timeZone: tz, energy: "normal", budgets: { "code-blossom": minutes } });
    }
    await makeDayPlan({ ctx }, { today: "2026-10-13", timeZone: tz, energy: "sick", budgets: { "code-blossom": 600 } });
    add("Already tomorrow", { size: "S", firstOn: "2026-10-18" });
    add("Grant", { size: "M", deadline: "2026-10-19" });
    add("Chanel", { size: "S", deadline: "2026-10-19", themeId: "personal" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: {} });

    const fits = Object.fromEntries((await todayView({ ctx }, today, tz)).warnings.map((w) => [w.title, w.fit]));
    expect(fits.Grant).toEqual({ needed: 60, usual: 60, free: 45, fits: false });
    expect(fits.Chanel).toEqual({ needed: 15, usual: 0, free: 0, fits: false });
  });

  it("says nothing about fit without any past plans", async () => {
    const { ctx, add } = setup();
    add("Grant", { deadline: "2026-10-18" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: {} });
    expect((await todayView({ ctx }, today, tz)).warnings[0]!.fit).toEqual({ needed: 60 });
  });

  it("sorts high stakes first, then by due date, low stakes last", async () => {
    const { ctx, add } = setup();
    add("Low soon", { deadline: "2026-10-18", stakes: "low" });
    add("Plain later", { deadline: "2026-10-20" });
    add("Plain soon", { deadline: "2026-10-18" });
    add("High later", { deadline: "2026-10-20", stakes: "high" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: {} });
    expect((await todayView({ ctx }, today, tz)).warnings.map((w) => [w.title, w.stakes])).toEqual([
      ["High later", "high"],
      ["Plain soon", undefined],
      ["Plain later", undefined],
      ["Low soon", "low"],
    ]);
  });
});
