import { describe, expect, it } from "bun:test";
import type { CalendarEvent } from "../calendar/calendar.ts";
import type { TrainingSession } from "../training/training.ts";
import type { Task } from "../tasks/tasks.ts";
import { deadlineWarnings, planDay, selectItems, sickDayMoves, type PlanInput } from "./planner.ts";

const today = "2026-10-17";
let counter = 0;

function task(overrides: Partial<Task> = {}): Task {
  counter++;
  return {
    id: `t${counter}`,
    title: `Task ${counter}`,
    status: "open",
    themeId: "personal",
    essential: false,
    priority: "normal",
    sizeConfirmed: true,
    deadlineFixed: false,
    size: "M",
    labels: [],
    source: "manual",
    postponeCount: 0,
    createdAt: "2026-10-16T08:00:00.000Z",
    updatedAt: "2026-10-16T08:00:00.000Z",
    ...overrides,
  };
}

function meeting(themeId: string | undefined, minutes: number, blocking = true): CalendarEvent {
  return {
    id: `m${minutes}`,
    calendar: "main",
    title: "Meeting",
    allDay: false,
    start: "",
    end: "",
    minutes,
    blocking,
    themeId,
    themeSource: themeId ? "name" : "unknown",
  };
}

function input(overrides: Partial<PlanInput>): PlanInput {
  return {
    today,
    energy: "normal",
    budgets: { personal: 120 },
    themeIds: ["personal"],
    trainingThemeId: "exercise",
    tasks: [],
    lastCompletedOn: new Map(),
    meetings: [],
    training: [],
    ...overrides,
  };
}

function ids(plan: ReturnType<typeof planDay>, themeId = "personal") {
  return plan.find((p) => p.themeId === themeId)!.items.map((i) => i.taskId);
}

describe("planDay", () => {
  it("fills each theme's budget with the most important tasks first", () => {
    const old = task({ title: "old", createdAt: "2026-09-01T08:00:00.000Z" });
    const fresh = task({ title: "fresh" });
    const due = task({ title: "due", deadline: "2026-10-19" });
    const high = task({ title: "high", priority: "high" });
    const plan = planDay(input({ tasks: [fresh, old, due, high] }));
    expect(ids(plan)).toEqual([due.id, high.id]);
    expect(plan[0]).toMatchObject({ budget: 120, available: 120 });
  });

  it("subtracts meetings of that theme and skips tasks that do not fit, trying smaller ones", () => {
    const big = task({ size: "L", priority: "high" });
    const small = task({ size: "S" });
    const plan = planDay(input({ tasks: [big, small], meetings: [meeting("personal", 60), meeting("hvnly", 30), meeting("personal", 30, false)] }));
    expect(plan[0]).toMatchObject({ meetingMinutes: 60, available: 60 });
    expect(ids(plan)).toEqual([small.id]);
  });

  it("always lists tasks picked for today and due today, flagged when over budget", () => {
    const picked = task({ firstOn: today, size: "L" });
    const dueToday = task({ deadline: today, size: "L" });
    const plan = planDay(input({ tasks: [picked, dueToday], budgets: { personal: 0 } }));
    expect(plan[0]!.items.map((i) => [i.taskId, i.overBudget])).toEqual([
      [picked.id, true],
      [dueToday.id, true],
    ]);
  });

  it("ranks essentials first but does not force them into a full day", () => {
    const essential = task({ essential: true, size: "L" });
    const small = task({ size: "S" });
    expect(ids(planDay(input({ tasks: [small, essential], budgets: { personal: 300 } })))).toEqual([essential.id, small.id]);
    expect(ids(planDay(input({ tasks: [small, essential], budgets: { personal: 60 } })))).toEqual([small.id]);
  });

  it("assumes an hour for unsized tasks and says so", () => {
    const plan = planDay(input({ tasks: [task({ size: undefined })] }));
    expect(plan[0]!.items[0]).toMatchObject({ minutes: 60, sizeAssumed: true });
  });

  it("counts training against the exercise budget", () => {
    const longRun: TrainingSession = { id: "r", date: today, kind: "long", title: "Long run", minMinutes: 75, maxMinutes: 100, status: "planned", travel: false };
    const plan = planDay(input({ themeIds: ["exercise"], budgets: { exercise: 120 }, training: [longRun], tasks: [task({ themeId: "exercise" })] }));
    expect(plan[0]).toMatchObject({ trainingMinutes: 75, available: 45, items: [] });
    const sick = planDay(input({ themeIds: ["exercise"], budgets: { exercise: 120 }, training: [{ ...longRun, status: "sick" }] }));
    expect(sick[0]!.trainingMinutes).toBe(0);
  });

  it("skips non-urgent half-day tasks on a lower-energy day and prefers small ones", () => {
    const large = task({ size: "L" });
    const medium = task({ size: "M" });
    const small = task({ size: "S" });
    const plan = planDay(input({ energy: "lower", budgets: { personal: 600 }, tasks: [large, medium, small] }));
    expect(ids(plan)).toEqual([small.id, medium.id]);
  });

  it("only keeps essentials and today's deadlines when sick", () => {
    const essential = task({ essential: true });
    const normal = task();
    const plan = planDay(input({ energy: "sick", tasks: [essential, normal] }));
    expect(plan[0]).toMatchObject({ budget: 0, available: 0 });
    expect(ids(plan)).toEqual([essential.id]);
  });

  it("respects recurrence", () => {
    const countDone = task({ recurrence: { kind: "count", times: 2, per: "week" }, progress: { done: 2, target: 2, periodStart: "2026-10-12" } });
    const countOpen = task({ recurrence: { kind: "count", times: 2, per: "week" }, progress: { done: 0, target: 2, periodStart: "2026-10-12" } });
    const saturday = task({ recurrence: { kind: "weekdays", days: ["sat"] }, size: "S" });
    const monday = task({ recurrence: { kind: "weekdays", days: ["mon"] } });
    const everyWeek = task({ recurrence: { kind: "every", interval: 1, unit: "week" }, size: "S" });
    const doneToday = task({ recurrence: { kind: "every", interval: 1, unit: "day" }, size: "S" });
    const unparsed = task({ recurrence: { kind: "unparsed", text: "every year" } });
    const plan = planDay(
      input({
        budgets: { personal: 600 },
        tasks: [countDone, countOpen, saturday, monday, everyWeek, doneToday, unparsed],
        lastCompletedOn: new Map([
          [everyWeek.id, "2026-10-09"],
          [doneToday.id, today],
        ]),
      }),
    );
    expect(new Set(ids(plan))).toEqual(new Set([countOpen.id, saturday.id, everyWeek.id]));
  });

  it("plans monthly tasks from their date until done, like a deadline", () => {
    const payment = task({ title: "Pay rent", recurrence: { kind: "monthly", day: 15 }, size: "S", createdAt: "2026-09-01T08:00:00.000Z" });
    const later = task({ title: "Report", recurrence: { kind: "monthly", day: 20 }, size: "S", createdAt: "2026-10-01T08:00:00.000Z" });
    const fresh = task({ title: "New", recurrence: { kind: "monthly", day: 10 }, size: "S", createdAt: "2026-10-12T08:00:00.000Z" });
    const plan = planDay(input({ budgets: { personal: 0 }, tasks: [payment, later, fresh] }));
    expect(plan[0]!.items.map((i) => [i.taskId, i.reason, i.overBudget])).toEqual([[payment.id, "Overdue by 2 days", true]]);
    const done = planDay(input({ budgets: { personal: 60 }, tasks: [payment], lastCompletedOn: new Map([[payment.id, "2026-10-15"]]) }));
    expect(ids(done)).toEqual([]);
    const sameDay = planDay(input({ today: "2026-10-20", budgets: { personal: 0 }, tasks: [later] }));
    expect(sameDay[0]!.items.map((i) => i.reason)).toEqual(["Due today"]);
  });

  it("pushes count tasks that are running out of days", () => {
    const behind = task({ recurrence: { kind: "count", times: 2, per: "week" }, progress: { done: 0, target: 2, periodStart: "2026-10-12" } });
    const high = task({ priority: "high" });
    const plan = planDay(input({ budgets: { personal: 60 }, tasks: [high, behind] }));
    expect(ids(plan)).toEqual([behind.id]);
    expect(plan[0]!.items[0]!.reason).toBe("0 of 2 done this week");
  });

  it("waits for snoozed tasks and puts do-first tasks at the top", () => {
    const snoozed = task({ notBefore: "2026-10-20", priority: "high" });
    const wakes = task({ notBefore: today });
    const first = task({ firstOn: today, size: "L" });
    const plan = planDay(input({ budgets: { personal: 60 }, tasks: [snoozed, wakes, first] }));
    expect(plan[0]!.items.map((i) => [i.taskId, i.overBudget, i.reason])).toEqual([
      [first.id, true, "You picked this for today"],
      [wakes.id, false, ""],
    ]);
  });

  it("ignores subtasks, inbox items and other themes", () => {
    const plan = planDay(input({ tasks: [task({ parentId: "x" }), task({ status: "inbox" }), task({ themeId: "hvnly" })] }));
    expect(ids(plan)).toEqual([]);
  });

  it("explains its picks", () => {
    const plan = planDay(
      input({
        budgets: { personal: 600 },
        tasks: [
          task({ essential: true, deadline: "2026-10-16" }),
          task({ deadline: "2026-10-18", priority: "high" }),
          task({ createdAt: "2026-09-20T08:00:00.000Z" }),
        ],
      }),
    );
    expect(plan[0]!.items.map((i) => i.reason)).toEqual(["Essential, Overdue by 1 day", "Due tomorrow, High priority", "Waiting 3 weeks"]);
  });
});

describe("deadlineWarnings", () => {
  it("warns when the work due exceeds today's pace", () => {
    const big = task({ title: "Workflow x", size: "L", deadline: "2026-10-18" });
    const warnings = deadlineWarnings({ today, budgets: { personal: 60 }, tasks: [big] }, new Set());
    expect(warnings).toEqual([
      {
        taskId: big.id,
        themeId: "personal",
        title: "Workflow x",
        deadline: "2026-10-18",
        detail: "is due tomorrow. About 4h of work in this theme is due by then, and today's pace gives 2h.",
        message: "“Workflow x” is due tomorrow. About 4h of work in this theme is due by then, and today's pace gives 2h.",
      },
    ]);
  });

  it("warns about deadlines soon in a theme with no time today", () => {
    const soon = task({ title: "Invoice", size: "S", deadline: "2026-10-19" });
    expect(deadlineWarnings({ today, budgets: {}, tasks: [soon] }, new Set())[0]?.message).toBe(
      "“Invoice” is due in 2 days, but this theme has no time today.",
    );
  });

  it("warns about overdue tasks that are not planned", () => {
    const overdue = task({ title: "Tax", deadline: "2026-10-10" });
    expect(deadlineWarnings({ today, budgets: { personal: 600 }, tasks: [overdue] }, new Set())).toHaveLength(1);
    expect(deadlineWarnings({ today, budgets: { personal: 600 }, tasks: [overdue] }, new Set([overdue.id]))).toHaveLength(0);
  });

  it("ignores snoozed tasks while they are snoozed", () => {
    const snoozed = task({ title: "Later", size: "L", deadline: "2026-10-19", notBefore: "2026-10-18" });
    expect(deadlineWarnings({ today, budgets: {}, tasks: [snoozed] }, new Set())).toEqual([]);
    expect(deadlineWarnings({ today: "2026-10-18", budgets: {}, tasks: [snoozed] }, new Set())).toHaveLength(1);
  });

  it("ignores tasks already scheduled for a later day", () => {
    const later = task({ title: "Grant", deadline: "2026-10-19", firstOn: "2026-10-18" });
    expect(deadlineWarnings({ today, budgets: {}, tasks: [later] }, new Set())).toEqual([]);
    expect(deadlineWarnings({ today, budgets: {}, tasks: [{ ...later, firstOn: today }] }, new Set())).toHaveLength(1);
  });

  it("only looks 7 days ahead", () => {
    const inSeven = task({ title: "In seven", size: "L", deadline: "2026-10-24" });
    const inEight = task({ title: "In eight", size: "L", deadline: "2026-10-25" });
    expect(deadlineWarnings({ today, budgets: {}, tasks: [inSeven, inEight] }, new Set()).map((w) => w.title)).toEqual(["In seven"]);
  });

  it("never warns about tasks in today's plan", () => {
    const big = task({ title: "Workflow x", size: "L", deadline: "2026-10-18" });
    expect(deadlineWarnings({ today, budgets: {}, tasks: [big] }, new Set([big.id]))).toEqual([]);
  });

  it("stays quiet when there is enough time", () => {
    const fine = task({ size: "S", deadline: "2026-10-24" });
    expect(deadlineWarnings({ today, budgets: { personal: 60 }, tasks: [fine] }, new Set())).toEqual([]);
  });
});

describe("sickDayMoves", () => {
  const at = (deadline: string) => ({ taskId: deadline, title: `Due ${deadline}`, themeId: "personal", deadline, detail: "", message: "" });

  it("lands each task the day before its deadline, never earlier than tomorrow", () => {
    expect(sickDayMoves(today, [at("2026-10-22"), at("2026-10-19"), at("2026-10-18"), at("2026-10-12")]).map((m) => [m.day, m.noBuffer])).toEqual([
      ["2026-10-21", false],
      ["2026-10-18", false],
      ["2026-10-18", true],
      ["2026-10-18", true],
    ]);
  });

  it("keeps the task details for the preview", () => {
    expect(sickDayMoves(today, [at("2026-10-19")])).toEqual([
      { taskId: "2026-10-19", title: "Due 2026-10-19", themeId: "personal", deadline: "2026-10-19", day: "2026-10-18", noBuffer: false },
    ]);
  });
});

describe("selectItems", () => {
  const pool = [
    { taskId: "a", minutes: 60, sizeAssumed: false, reason: "", mandatory: false },
    { taskId: "b", minutes: 60, sizeAssumed: false, reason: "", mandatory: false },
    { taskId: "c", minutes: 15, sizeAssumed: false, reason: "", mandatory: false },
    { taskId: "e", minutes: 240, sizeAssumed: false, reason: "Essential", mandatory: true },
  ];

  it("follows the chosen order, ignores unknown ids and keeps within budget", () => {
    expect(selectItems(pool, ["c", "zzz", "b", "a", "c"], 90).map((i) => [i.taskId, i.overBudget])).toEqual([
      ["c", false],
      ["b", false],
      ["e", true],
    ]);
  });

  it("never drops mandatory items", () => {
    expect(selectItems(pool, [], 600).map((i) => i.taskId)).toEqual(["e"]);
  });
});
