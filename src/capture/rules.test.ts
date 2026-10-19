import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { createProject, listProjects } from "../projects/projects.ts";
import { listThemes } from "../themes/themes.ts";
import { fallbackTask, planTasks } from "./rules.ts";

function setup() {
  const ctx = testCtx();
  createProject(ctx, { themeId: "code-blossom", name: "Lisbon trip" });
  return { themes: listThemes(ctx), projects: listProjects(ctx) };
}

function plan(raw: unknown, note: string) {
  const { themes, projects } = setup();
  return planTasks(raw, note, themes, projects);
}

describe("planTasks", () => {
  it("files confident tasks under their theme and project", () => {
    const [task] = plan(
      [{ title: "Book flights", theme: "Code Blossom", project: "lisbon trip", confident: true, size: "M", subtasks: [] }],
      "book flights for the lisbon trip",
    );
    expect(task).toMatchObject({ title: "Book flights", themeId: "code-blossom", size: "M", sizeConfirmed: false });
    expect(task?.projectId).toBeDefined();
  });

  it("sends unsure tasks to the inbox without a theme", () => {
    const [task] = plan([{ title: "Call Anna", theme: "Personal", confident: false, subtasks: [] }], "call anna");
    expect(task?.themeId).toBeUndefined();
  });

  it("sends unknown themes to the inbox", () => {
    const [task] = plan([{ title: "X", theme: "Gardening", confident: true, subtasks: [] }], "x");
    expect(task?.themeId).toBeUndefined();
  });

  it("keeps an unknown project as a note instead of inventing one", () => {
    const [task] = plan([{ title: "X", theme: "Personal", project: "Garden", confident: true, subtasks: [] }], "x");
    expect(task).toMatchObject({ themeId: "personal", projectId: undefined, notes: "Project mentioned: Garden" });
  });

  it("never sets essential unless Marion says so", () => {
    const raw = [{ title: "Pay tax", theme: "Personal", confident: true, essential: true, subtasks: [] }];
    expect(plan(raw, "pay tax")[0]?.essential).toBe(false);
    expect(plan(raw, "pay tax, this is essential")[0]?.essential).toBe(true);
  });

  it("never invents urgency", () => {
    const raw = [{ title: "Pay tax", theme: "Personal", confident: true, priority: "high", subtasks: [] }];
    expect(plan(raw, "pay tax")[0]?.priority).toBe("normal");
    expect(plan(raw, "pay tax, high priority")[0]?.priority).toBe("high");
  });

  it("only keeps deadlines when the note mentions a date", () => {
    const raw = [{ title: "Send invoice", theme: "hvnly", confident: true, deadline: "2026-10-20", subtasks: [] }];
    expect(plan(raw, "send invoice")[0]?.deadline).toBeUndefined();
    expect(plan(raw, "send invoice by tuesday")[0]?.deadline).toBe("2026-10-20");
  });

  it("only keeps fixed weekdays when Marion names days", () => {
    const weekdays = [{ title: "Yoga", theme: "Exercise", confident: true, recurrence: { kind: "weekdays", days: ["mon"] }, subtasks: [] }];
    expect(plan(weekdays, "yoga twice a week")[0]?.recurrence).toBeUndefined();
    expect(plan(weekdays, "yoga every monday")[0]?.recurrence).toEqual({ kind: "weekdays", days: ["mon"] });
    const count = [{ title: "Yoga", theme: "Exercise", confident: true, recurrence: { kind: "count", times: 2, per: "week" }, subtasks: [] }];
    expect(plan(count, "yoga twice a week")[0]?.recurrence).toEqual({ kind: "count", times: 2, per: "week" });
  });

  it("keeps monthly repeats only when Marion mentions the month", () => {
    const monthly = [{ title: "Pay rent", theme: "Code Blossom", confident: true, recurrence: { kind: "monthly", day: 20 }, subtasks: [] }];
    expect(plan(monthly, "pay rent every 20th of the month")[0]?.recurrence).toEqual({ kind: "monthly", day: 20 });
    expect(plan(monthly, "pay rent on the 20th")[0]?.recurrence).toBeUndefined();
    const workday = [{ title: "Invoices", theme: "hvnly", confident: true, recurrence: { kind: "monthly", workday: 1 }, subtasks: [] }];
    expect(plan(workday, "invoices every first working day of the month")[0]?.recurrence).toEqual({ kind: "monthly", workday: 1 });
  });

  it("ignores malformed items and fields", () => {
    const tasks = plan(
      [null, "text", { title: "  " }, { title: "Ok", size: "XL", deadline: "soon", priority: "max", subtasks: ["a", 3, " "] }],
      "ok by friday",
    );
    expect(tasks).toEqual([
      {
        title: "Ok",
        notes: undefined,
        themeId: undefined,
        projectId: undefined,
        essential: false,
        priority: "normal",
        size: undefined,
        sizeConfirmed: false,
        deadline: undefined,
        recurrence: undefined,
        subtasks: ["a"],
      },
    ]);
    expect(plan("not a list", "x")).toEqual([]);
  });
});

describe("fallbackTask", () => {
  it("keeps short notes as the title", () => {
    expect(fallbackTask("  buy   milk ")).toEqual({ title: "buy milk", notes: undefined, subtasks: [] });
  });

  it("shortens long notes and keeps the full text in notes", () => {
    const long = "word ".repeat(40);
    const task = fallbackTask(long);
    expect(task.title.length).toBe(120);
    expect(task.notes).toBe(long.trim());
  });
});
