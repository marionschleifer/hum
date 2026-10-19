import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { listProjects } from "../projects/projects.ts";
import { listTasks } from "../tasks/tasks.ts";
import { createTodoistFetcher, previewImport, runImport, type TodoistData } from "./todoist.ts";

const data: TodoistData = {
  projects: [
    { id: "p-inbox", name: "Inbox", inbox_project: true },
    { id: "p-cb", name: "Code Blossom" },
    { id: "p-lisbon", name: "Lisbon", parent_id: "p-cb" },
    { id: "p-lisbon-visa", name: "Visa", parent_id: "p-lisbon" },
    { id: "p-misc", name: "Misc" },
    { id: "p-old", name: "Old", is_archived: true },
  ],
  items: [
    { id: "t1", content: "Book flights", project_id: "p-lisbon", priority: 4, due: { date: "2026-10-01", is_recurring: false, string: "Oct 1" } },
    { id: "t1a", content: "Compare prices", project_id: "p-lisbon", parent_id: "t1" },
    { id: "t1aa", content: "Too deep", project_id: "p-lisbon", parent_id: "t1a" },
    { id: "t2", content: "Water plants", project_id: "p-inbox", due: { is_recurring: true, string: "every week" }, labels: ["home"] },
    { id: "t3", content: "Annual review", project_id: "p-cb", due: { is_recurring: true, string: "every year" } },
    { id: "t4", content: "Pay tax", project_id: "p-misc", deadline: { date: "2026-11-30" }, priority: 2, description: "Canton form" },
    { id: "t5", content: "Done thing", project_id: "p-cb", checked: true },
    { id: "t6", content: "Deleted thing", project_id: "p-cb", is_deleted: true },
    { id: "t7", content: "Apply", project_id: "p-lisbon-visa" },
  ],
};

describe("previewImport", () => {
  it("suggests a mapping Marion can confirm", () => {
    const preview = previewImport(testCtx(), data);
    expect(preview.alreadyImported).toBe(false);
    expect(preview.taskCount).toBe(7);
    expect(preview.unclearRecurrences).toEqual(["every year"]);
    expect(preview.projects.map((p) => [p.path, p.taskCount, p.suggestion])).toEqual([
      ["Inbox", 1, { kind: "inbox" }],
      ["Code Blossom", 1, { kind: "theme", themeId: "code-blossom" }],
      ["Code Blossom / Lisbon", 3, { kind: "project", themeId: "code-blossom", projectName: "Lisbon" }],
      ["Code Blossom / Lisbon / Visa", 1, { kind: "project", themeId: "code-blossom", projectName: "Lisbon" }],
      ["Misc", 1, { kind: "inbox" }],
    ]);
  });
});

describe("runImport", () => {
  function imported() {
    const ctx = testCtx();
    const mapping = Object.fromEntries(previewImport(ctx, data).projects.map((p) => [p.id, p.suggestion]));
    mapping["p-misc"] = { kind: "theme", themeId: "personal" };
    const summary = runImport(ctx, data, mapping);
    return { ctx, summary };
  }

  it("imports active tasks into the confirmed places", () => {
    const { ctx, summary } = imported();
    expect(summary).toEqual({ tasks: 5, subtasks: 2, inInbox: 2, skipped: 0, projectsCreated: 1 });
    const lisbon = listProjects(ctx, { themeId: "code-blossom" });
    expect(lisbon.map((p) => p.name)).toEqual(["Lisbon"]);
    const tasks = listTasks(ctx);
    const byTitle = (title: string) => tasks.find((t) => t.title === title)!;
    expect(byTitle("Book flights")).toMatchObject({ projectId: lisbon[0]!.id, priority: "high", deadline: undefined, status: "open" });
    expect(byTitle("Apply").projectId).toBe(lisbon[0]!.id);
    expect(byTitle("Pay tax")).toMatchObject({ themeId: "personal", deadline: "2026-11-30", priority: "normal", notes: "Canton form" });
    expect(byTitle("Water plants")).toMatchObject({
      status: "inbox",
      labels: ["home"],
      recurrence: { kind: "every", interval: 1, unit: "week" },
    });
    expect(byTitle("Annual review")).toMatchObject({ status: "inbox", themeId: "code-blossom", recurrence: { kind: "unparsed", text: "every year" } });
    expect(tasks.find((t) => t.title === "Done thing")).toBeUndefined();
  });

  it("flattens deeper Todoist subtasks to one level", () => {
    const { ctx } = imported();
    const parent = listTasks(ctx).find((t) => t.title === "Book flights")!;
    expect(listTasks(ctx, { parentId: parent.id }).map((t) => t.title).sort()).toEqual(["Compare prices", "Too deep"]);
  });

  it("only runs once", () => {
    const { ctx } = imported();
    expect(() => runImport(ctx, data, {})).toThrow("already imported");
    expect(previewImport(ctx, data).alreadyImported).toBe(true);
  });

  it("can skip a project with its subtasks", () => {
    const ctx = testCtx();
    const summary = runImport(ctx, data, { "p-lisbon": { kind: "skip" } });
    expect(summary.skipped).toBe(3);
    expect(listTasks(ctx).some((t) => t.title === "Book flights")).toBe(false);
  });

  it("rejects mappings to unknown themes", () => {
    expect(() => runImport(testCtx(), data, { "p-cb": { kind: "theme", themeId: "nope" } })).toThrow("Unknown theme");
  });
});

describe("createTodoistFetcher", () => {
  it("reads projects and items through the sync endpoint", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const send = (async (url: string, init?: RequestInit) => {
      request = { url, init };
      return Response.json({ projects: [{ id: "1", name: "Inbox" }], items: [] });
    }) as typeof fetch;
    const result = await createTodoistFetcher("todoist-token", send)();
    expect(result).toEqual({ projects: [{ id: "1", name: "Inbox" }], items: [] });
    expect(request?.url).toBe("https://api.todoist.com/api/v1/sync");
    expect((request?.init?.headers as Record<string, string>).authorization).toBe("Bearer todoist-token");
    expect(String(request?.init?.body)).toContain("sync_token=*");
  });

  it("throws on errors", async () => {
    const send = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(createTodoistFetcher("x", send)()).rejects.toThrow("Todoist 401: nope");
  });
});
