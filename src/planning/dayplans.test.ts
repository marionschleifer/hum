import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import type { PlanChoiceInput } from "../ai/planning.ts";
import { saveCalendarSettings } from "../calendar/calendar.ts";
import type { GoogleApi } from "../google/google.ts";
import { completeTask, createTask, getTask } from "../tasks/tasks.ts";
import { makeDayPlan, parseMorningNote, pickForToday, todayView } from "./dayplans.ts";

const today = "2026-10-17";
const tz = "Europe/Zurich";

function googleWith(main: unknown[]): GoogleApi {
  return { get: async <T>() => ({ items: main }) as T };
}

function setup() {
  const ctx = testCtx();
  saveCalendarSettings(ctx, { account: "me@example.com", mainCalendarId: "me@example.com" });
  const add = (title: string, extra: Record<string, unknown> = {}) =>
    createTask(ctx, { title, source: "manual", themeId: "accounto", size: "M", sizeConfirmed: true, ...extra });
  return { ctx, add };
}

const standup = {
  id: "s",
  summary: "Accounto standup",
  start: { dateTime: "2026-10-17T09:00:00+02:00" },
  end: { dateTime: "2026-10-17T10:00:00+02:00" },
};

describe("makeDayPlan", () => {
  it("plans per theme after meetings and training and stores it", async () => {
    const { ctx, add } = setup();
    add("Workflow x", { deadline: "2026-10-18" });
    add("Workflow y");
    add("Workflow z");
    const run = add("Stretch", { themeId: "exercise", size: "S" });
    const view = await makeDayPlan(
      { ctx, google: googleWith([standup]) },
      { today, timeZone: tz, energy: "normal", budgets: { accounto: 180, exercise: 90 } },
    );
    const accounto = view.plan!.themes.find((t) => t.themeId === "accounto")!;
    expect(accounto).toMatchObject({ budget: 180, meetingMinutes: 60, available: 120 });
    expect(accounto.items.map((i) => i.task.title)).toEqual(["Workflow x", "Workflow y"]);
    const exercise = view.plan!.themes.find((t) => t.themeId === "exercise")!;
    expect(exercise).toMatchObject({ trainingMinutes: 0, available: 90 });
    expect(exercise.items.map((i) => i.taskId)).toEqual([run.id]);
    expect(view.meetings.map((m) => m.title)).toEqual(["Accounto standup"]);
    expect(view.training.map((s) => s.title)).toEqual(["Rest"]);
    expect(view.week.sessions.map((s) => s.title)).toEqual(["Strength", "Intervals", "Easy run", "Strength", "Tempo run", "Rest", "Long run"]);
    expect(view.plan!.createdAt).toBe("2026-10-17T08:00:00.000Z");
    expect((await todayView({ ctx, google: googleWith([standup]) }, today, tz)).plan?.themes.length).toBe(5);
  });

  it("keeps open work free of todos and remembers it", async () => {
    const { ctx, add } = setup();
    add("Workflow x");
    add("Workflow y");
    const deps = { ctx, google: googleWith([standup]) };
    await makeDayPlan(deps, { today, timeZone: tz, energy: "normal", budgets: { accounto: 240 }, openWork: { accounto: 120 } });
    const accounto = (await todayView(deps, today, tz)).plan!.themes.find((t) => t.themeId === "accounto")!;
    expect(accounto).toMatchObject({ budget: 240, meetingMinutes: 60, openMinutes: 120, available: 60 });
    expect(accounto.items.map((i) => i.task.title)).toEqual(["Workflow x"]);
    expect((await todayView(deps, today, tz)).plan!.openWork).toEqual({ accounto: 120 });
  });

  it("refuses open work that is more than the theme's budget or negative", async () => {
    const { ctx } = setup();
    const plan = (openWork: Record<string, number>) =>
      makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 }, openWork });
    await expect(plan({ accounto: 90 })).rejects.toThrow("Open work for Accounto is more than its budget");
    await expect(plan({ accounto: -5 })).rejects.toThrow("Invalid open work for Accounto");
  });

  it("does not warn about deadlines using time that is kept for open work", async () => {
    const { ctx, add } = setup();
    add("Big one", { size: "L", deadline: "2026-10-18" });
    const view = await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 150 }, openWork: { accounto: 120 } });
    expect(view.warnings.map((w) => w.detail)).toEqual([
      "is due tomorrow. About 4h of work in this theme is due by then, and today's pace gives 1h.",
    ]);
  });

  it("lets Claude choose from the pool but enforces budget and mandatory tasks", async () => {
    const { ctx, add } = setup();
    const essential = add("Essential", { firstOn: today, size: "L" });
    const first = add("Ranked first", { priority: "high" });
    const light = add("Light one", { size: "S" });
    let seen: PlanChoiceInput | undefined;
    const choosePlan = async (input: PlanChoiceInput) => {
      seen = input;
      return { themes: [{ themeId: "accounto", taskIds: [light.id, "invented", first.id] }], note: "A light Saturday." };
    };
    const view = await makeDayPlan(
      { ctx, choosePlan },
      { today, timeZone: tz, energy: "lower", energyNote: "slept badly", budgets: { accounto: 60 } },
    );
    expect(seen?.energyNote).toBe("slept badly");
    expect(seen?.themes.map((t) => t.themeId)).toEqual(["accounto"]);
    expect(seen?.themes[0]!.pool.find((p) => p.taskId === essential.id)).toMatchObject({ title: "Essential", mandatory: true });
    const items = view.plan!.themes.find((t) => t.themeId === "accounto")!.items;
    expect(items.map((i) => [i.task.title, i.overBudget])).toEqual([
      ["Light one", false],
      ["Essential", true],
    ]);
    expect(view.plan!.aiNote).toBe("A light Saturday.");
  });

  it("keeps the ranked plan when Claude fails", async () => {
    const { ctx, add } = setup();
    add("Only task");
    const errors: unknown[] = [];
    const view = await makeDayPlan(
      {
        ctx,
        log: (_m, e) => errors.push(e),
        choosePlan: async () => {
          throw new Error("overloaded");
        },
      },
      { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } },
    );
    expect(view.plan!.themes.find((t) => t.themeId === "accounto")!.items.map((i) => i.task.title)).toEqual(["Only task"]);
    expect(errors).toHaveLength(1);
  });

  it("re-plans the same day, leaving out what is done", async () => {
    const { ctx, add } = setup();
    const first = add("First", { priority: "high" });
    add("Second");
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } });
    completeTask(ctx, first.id, today);
    ctx.advance(4 * 3600 * 1000);
    const view = await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "lower", budgets: { accounto: 60 } });
    expect(view.plan).toMatchObject({ energy: "lower", createdAt: "2026-10-17T08:00:00.000Z", replannedAt: "2026-10-17T12:00:00.000Z" });
    expect(view.plan!.themes.find((t) => t.themeId === "accounto")!.items.map((i) => i.task.title)).toEqual(["Second"]);
  });

  it("marks planned tasks done during the day", async () => {
    const { ctx, add } = setup();
    const task = add("Do it");
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } });
    completeTask(ctx, task.id, today);
    const view = await todayView({ ctx }, today, tz);
    expect(view.plan!.themes.find((t) => t.themeId === "accounto")!.items[0]).toMatchObject({ doneToday: true });
  });

  it("validates input", async () => {
    const { ctx } = setup();
    await expect(makeDayPlan({ ctx }, { today, timeZone: "Mars/Base", energy: "normal", budgets: {} })).rejects.toThrow("Invalid time zone");
    await expect(makeDayPlan({ ctx }, { today, timeZone: tz, energy: "meh" as never, budgets: {} })).rejects.toThrow("Invalid energy");
    await expect(makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: -5 } })).rejects.toThrow("Invalid budget");
  });
});

describe("training in the plan", () => {
  it("counts the day's training against the exercise budget", async () => {
    const { ctx } = setup();
    const view = await makeDayPlan({ ctx }, { today: "2026-10-18", timeZone: tz, energy: "normal", budgets: { exercise: 120 } });
    expect(view.training.map((s) => s.title)).toEqual(["Long run"]);
    expect(view.plan!.themes.find((t) => t.themeId === "exercise")).toMatchObject({ trainingMinutes: 75, available: 45 });
  });
});

describe("pickForToday", () => {
  it("marks a task for today and slots it into an existing plan at the top of its theme", async () => {
    const { ctx, add } = setup();
    add("Ranked");
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } });
    const picked = add("My pick", { size: "L" });
    expect(pickForToday(ctx, picked.id, today, { pick: true }).firstOn).toBe(today);
    const items = (await todayView({ ctx }, today, tz)).plan!.themes.find((t) => t.themeId === "accounto")!.items;
    expect(items.map((i) => [i.task.title, i.reason, i.overBudget])).toEqual([
      ["My pick", "You picked this for today", true],
      ["Ranked", "", false],
    ]);
    pickForToday(ctx, picked.id, today, { pick: false });
    expect(getTask(ctx, picked.id)?.firstOn).toBeUndefined();
    expect((await todayView({ ctx }, today, tz)).plan!.themes.find((t) => t.themeId === "accounto")!.items.map((i) => i.task.title)).toEqual([
      "Ranked",
    ]);
  });

  it("sorts an inbox task and picks it in one step, and needs a theme", () => {
    const { ctx } = setup();
    const inbox = createTask(ctx, { title: "Call the vet", source: "voice" });
    expect(() => pickForToday(ctx, inbox.id, today, { pick: true })).toThrow("Pick a theme first");
    expect(pickForToday(ctx, inbox.id, today, { pick: true, themeId: "personal" })).toMatchObject({
      status: "open",
      themeId: "personal",
      firstOn: today,
    });
  });

  it("is picked into the next plan when there is no plan yet", async () => {
    const { ctx, add } = setup();
    add("Ranked", { priority: "high" });
    const picked = add("Pick");
    pickForToday(ctx, picked.id, today, { pick: true });
    const view = await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } });
    expect(view.plan!.themes.find((t) => t.themeId === "accounto")!.items.map((i) => i.task.title)).toEqual(["Pick"]);
  });

  it("rejects subtasks and finished tasks", () => {
    const { ctx, add } = setup();
    const parent = add("Parent");
    const child = createTask(ctx, { title: "Child", parentId: parent.id, source: "manual" });
    expect(() => pickForToday(ctx, child.id, today, { pick: true })).toThrow("not a subtask");
    completeTask(ctx, parent.id, today);
    expect(() => pickForToday(ctx, parent.id, today, { pick: true })).toThrow("already done");
  });
});

describe("too big for today", () => {
  it("names the first task that does not fit a theme's time", async () => {
    const { ctx, add } = setup();
    add("Build workflow x", { size: "L" });
    const view = await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 120 } });
    const accounto = view.plan!.themes.find((t) => t.themeId === "accounto")!;
    expect(accounto.items).toEqual([]);
    expect(accounto.tooBig).toMatchObject({ task: { title: "Build workflow x" }, minutes: 240 });
    expect(view.plan!.themes.find((t) => t.themeId === "hvnly")!.tooBig).toBeUndefined();
  });

  it("stops naming a task once it is picked for today", async () => {
    const { ctx, add } = setup();
    const big = add("Build workflow x", { size: "L" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 120 } });
    pickForToday(ctx, big.id, today, { pick: true });
    const accounto = (await todayView({ ctx }, today, tz)).plan!.themes.find((t) => t.themeId === "accounto")!;
    expect(accounto.items.map((i) => i.task.title)).toEqual(["Build workflow x"]);
    expect(accounto.tooBig).toBeUndefined();
  });

  it("stops naming a task once the theme has time for it", async () => {
    const { ctx, add } = setup();
    add("Build workflow x", { size: "L" });
    await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 120 } });
    ctx.db.query("UPDATE day_plans SET budgets = ? WHERE date = ?").run(JSON.stringify({ accounto: 240 }), today);
    const accounto = (await todayView({ ctx }, today, tz)).plan!.themes.find((t) => t.themeId === "accounto")!;
    expect(accounto.tooBig).toBeUndefined();
  });
});

describe("todayView", () => {
  it("shows due and overdue tasks and the calendar without a plan", async () => {
    const { ctx, add } = setup();
    add("Overdue", { deadline: "2026-10-15" });
    add("Later", { deadline: "2026-10-30" });
    const view = await todayView({ ctx, google: googleWith([standup]) }, today, tz);
    expect(view.plan).toBeUndefined();
    expect(view.connected).toBe(true);
    expect(view.due.map((t) => t.title)).toEqual(["Overdue"]);
    expect(view.warnings).toEqual([]);
  });

  it("reports calendar problems without failing", async () => {
    const { ctx } = setup();
    const broken: GoogleApi = {
      get: async () => {
        throw new Error("Google API 500");
      },
    };
    const view = await todayView({ ctx, google: broken, log: () => {} }, today, tz);
    expect(view.calendarError).toBe("Google API 500");
    expect(view.meetings).toEqual([]);
  });

  it("says when the calendar is not connected", async () => {
    expect((await todayView({ ctx: testCtx() }, today, tz)).connected).toBe(false);
  });

  it("warns about deadlines at risk once a plan exists", async () => {
    const { ctx, add } = setup();
    add("Big", { size: "L", deadline: "2026-10-18" });
    const view = await makeDayPlan({ ctx }, { today, timeZone: tz, energy: "normal", budgets: { accounto: 60 } });
    expect(view.warnings.map((w) => w.message)).toEqual([
      "“Big” is due tomorrow. About 4h of work in this theme is due by then, and today's pace gives 2h.",
    ]);
  });
});

describe("parseMorningNote", () => {
  it("turns words into budgets per theme", async () => {
    const { ctx } = setup();
    const parseBudgets = async () => ({
      budgets: [
        { theme: "Accounto", minutes: 180 },
        { theme: "code blossom", minutes: 60 },
        { theme: "Unknown", minutes: 30 },
        { theme: "Exercise", minutes: 5000 },
      ],
      energy: "lower",
      note: "slept badly",
    });
    expect(await parseMorningNote({ ctx, parseBudgets }, "3h accounto, 1h code blossom, tired")).toEqual({
      budgets: { accounto: 180, "code-blossom": 60, exercise: 960 },
      energy: "lower",
      note: "slept badly",
    });
  });

  it("reads open work inside a budget, never more than the budget", async () => {
    const { ctx } = setup();
    const parseBudgets = async () => ({
      budgets: [
        { theme: "Accounto", minutes: 360, open: 120 },
        { theme: "Personal", minutes: 60, open: 90 },
        { theme: "hvnly", minutes: 30 },
      ],
    });
    expect(await parseMorningNote({ ctx, parseBudgets }, "6h accounto, 2 of that for email")).toEqual({
      budgets: { accounto: 360, personal: 60, hvnly: 30 },
      openWork: { accounto: 120, personal: 60 },
    });
  });

  it("needs text and an API key", async () => {
    const { ctx } = setup();
    await expect(parseMorningNote({ ctx }, " ")).rejects.toThrow("Say or type");
    await expect(parseMorningNote({ ctx }, "3h accounto")).rejects.toThrow("ANTHROPIC_API_KEY");
  });
});
