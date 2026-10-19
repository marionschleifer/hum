import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { createProject } from "../projects/projects.ts";
import {
  completeTask,
  createTask,
  dropTask,
  getTask,
  listTasks,
  reopenTask,
  restoreTask,
  updateTask,
} from "./tasks.ts";

const today = "2026-10-17";

describe("createTask", () => {
  it("puts tasks without a theme in the inbox", () => {
    const task = createTask(testCtx(), { title: "Something", source: "quick_add" });
    expect(task).toMatchObject({ status: "inbox", priority: "normal", essential: false, labels: [] });
    expect(task.themeId).toBeUndefined();
  });

  it("opens tasks that have a theme", () => {
    expect(createTask(testCtx(), { title: "Run", themeId: "exercise", source: "manual" }).status).toBe("open");
  });

  it("can keep a themed task in the inbox", () => {
    expect(createTask(testCtx(), { title: "Run", themeId: "exercise", inbox: true, source: "manual" }).status).toBe("inbox");
  });

  it("takes the theme from the project", () => {
    const ctx = testCtx();
    const project = createProject(ctx, { themeId: "code-blossom", name: "Lisbon" });
    const task = createTask(ctx, { title: "Book flights", projectId: project.id, themeId: "personal", source: "manual" });
    expect(task).toMatchObject({ themeId: "code-blossom", projectId: project.id });
  });

  it("allows exactly one level of subtasks, inheriting the parent's place", () => {
    const ctx = testCtx();
    const parent = createTask(ctx, { title: "Plan trip", themeId: "code-blossom", source: "manual" });
    const child = createTask(ctx, { title: "Visa", parentId: parent.id, themeId: "personal", source: "manual" });
    expect(child).toMatchObject({ parentId: parent.id, themeId: "code-blossom", status: "open" });
    expect(() => createTask(ctx, { title: "Too deep", parentId: child.id, source: "manual" })).toThrow(
      "Subtasks cannot have subtasks",
    );
  });

  it("only marks a size as confirmed when a size exists", () => {
    const ctx = testCtx();
    expect(createTask(ctx, { title: "A", size: "M", source: "manual", sizeConfirmed: true }).sizeConfirmed).toBe(true);
    expect(createTask(ctx, { title: "B", source: "manual", sizeConfirmed: true }).sizeConfirmed).toBe(false);
  });

  it("validates input", () => {
    const ctx = testCtx();
    expect(() => createTask(ctx, { title: " ", source: "manual" })).toThrow("Title is required");
    expect(() => createTask(ctx, { title: "A", deadline: "17.10.2026", source: "manual" })).toThrow("Invalid date");
    expect(() => createTask(ctx, { title: "A", themeId: "nope", source: "manual" })).toThrow("Unknown theme");
  });

  it("dedupes labels", () => {
    expect(createTask(testCtx(), { title: "A", labels: ["x", " x", "", "y"], source: "manual" }).labels).toEqual(["x", "y"]);
  });
});

describe("updateTask", () => {
  it("sorts an inbox task out when it gets a theme", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", source: "voice" });
    expect(updateTask(ctx, task.id, { themeId: "hvnly" }).status).toBe("open");
  });

  it("refuses to open a task without a theme", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", source: "voice" });
    expect(() => updateTask(ctx, task.id, { status: "open" })).toThrow("Pick a theme");
  });

  it("sends a task back to the inbox when its theme is cleared", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", themeId: "personal", source: "manual" });
    expect(updateTask(ctx, task.id, { themeId: "" })).toMatchObject({ status: "inbox", themeId: undefined });
  });

  it("drops the project when moving to a theme it does not belong to", () => {
    const ctx = testCtx();
    const project = createProject(ctx, { themeId: "personal", name: "Flat" });
    const task = createTask(ctx, { title: "A", projectId: project.id, source: "manual" });
    expect(updateTask(ctx, task.id, { themeId: "hvnly" })).toMatchObject({ themeId: "hvnly", projectId: undefined });
  });

  it("moves subtasks along with their parent", () => {
    const ctx = testCtx();
    const parent = createTask(ctx, { title: "P", source: "voice" });
    const child = createTask(ctx, { title: "C", parentId: parent.id, source: "voice" });
    expect(child.status).toBe("inbox");
    updateTask(ctx, parent.id, { themeId: "personal" });
    expect(getTask(ctx, child.id)).toMatchObject({ themeId: "personal", status: "open" });
    expect(() => updateTask(ctx, child.id, { themeId: "hvnly" })).toThrow("Subtasks follow their parent");
  });

  it("confirms a size Marion sets and clears fields with empty strings", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", size: "S", deadline: today, source: "voice" });
    expect(task.sizeConfirmed).toBe(false);
    const updated = updateTask(ctx, task.id, { size: "L", deadline: "" });
    expect(updated).toMatchObject({ size: "L", sizeConfirmed: true, deadline: undefined });
    expect(updateTask(ctx, task.id, { size: "" })).toMatchObject({ size: undefined, sizeConfirmed: false });
  });

  it("snoozes and marks tasks to do first", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", themeId: "personal", source: "manual" });
    expect(updateTask(ctx, task.id, { notBefore: "2026-10-24", firstOn: "2026-10-18" })).toMatchObject({
      notBefore: "2026-10-24",
      firstOn: "2026-10-18",
    });
    expect(updateTask(ctx, task.id, { notBefore: "" }).notBefore).toBeUndefined();
    expect(() => updateTask(ctx, task.id, { firstOn: "soon" })).toThrow("Invalid date");
  });

  it("sets and clears recurrence", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "Stretch", themeId: "exercise", source: "manual" });
    const recurring = updateTask(ctx, task.id, { recurrence: { kind: "count", times: 3, per: "week" } });
    expect(recurring.recurrence).toEqual({ kind: "count", times: 3, per: "week" });
    expect(updateTask(ctx, task.id, { recurrence: "" }).recurrence).toBeUndefined();
  });
});

describe("completing and dropping", () => {
  it("completes a task with its open subtasks", () => {
    const ctx = testCtx();
    const parent = createTask(ctx, { title: "P", themeId: "personal", source: "manual" });
    const child = createTask(ctx, { title: "C", parentId: parent.id, source: "manual" });
    expect(completeTask(ctx, parent.id, today)).toMatchObject({ status: "done", doneAt: "2026-10-17T08:00:00.000Z" });
    expect(getTask(ctx, child.id)?.status).toBe("done");
  });

  it("keeps recurring tasks open and tracks progress for the period", () => {
    const ctx = testCtx();
    const task = createTask(ctx, {
      title: "Stretch",
      themeId: "exercise",
      recurrence: { kind: "count", times: 2, per: "week" },
      source: "manual",
    });
    const done = completeTask(ctx, task.id, today);
    expect(done.status).toBe("open");
    expect(done.progress).toEqual({ done: 1, target: 2, periodStart: "2026-10-12" });
    expect(reopenTask(ctx, task.id, today).progress?.done).toBe(0);
  });

  it("reopens a done task", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", themeId: "personal", source: "manual" });
    completeTask(ctx, task.id, today);
    expect(reopenTask(ctx, task.id, today)).toMatchObject({ status: "open", doneAt: undefined });
  });

  it("refuses to complete twice", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", themeId: "personal", source: "manual" });
    completeTask(ctx, task.id, today);
    expect(() => completeTask(ctx, task.id, today)).toThrow("already done");
  });

  it("drops into the archive and restores", () => {
    const ctx = testCtx();
    const task = createTask(ctx, { title: "A", source: "manual" });
    expect(dropTask(ctx, task.id).status).toBe("dropped");
    expect(listTasks(ctx, { status: ["dropped"] }).map((t) => t.id)).toEqual([task.id]);
    expect(restoreTask(ctx, task.id)).toMatchObject({ status: "inbox", droppedAt: undefined });
  });
});

describe("listTasks", () => {
  it("filters and orders essential first, then by deadline, then priority", () => {
    const ctx = testCtx();
    const low = createTask(ctx, { title: "low", themeId: "personal", priority: "low", source: "manual" });
    const high = createTask(ctx, { title: "high", themeId: "personal", priority: "high", source: "manual" });
    const due = createTask(ctx, { title: "due", themeId: "personal", deadline: "2026-11-01", source: "manual" });
    const essential = createTask(ctx, { title: "essential", themeId: "personal", essential: true, source: "manual" });
    createTask(ctx, { title: "other theme", themeId: "hvnly", source: "manual" });
    const ids = listTasks(ctx, { themeId: "personal", status: ["open"] }).map((t) => t.id);
    expect(ids).toEqual([essential.id, due.id, high.id, low.id]);
  });

  it("can list only top-level tasks", () => {
    const ctx = testCtx();
    const parent = createTask(ctx, { title: "P", themeId: "personal", source: "manual" });
    createTask(ctx, { title: "C", parentId: parent.id, source: "manual" });
    expect(listTasks(ctx, { topLevelOnly: true }).map((t) => t.id)).toEqual([parent.id]);
  });
});
