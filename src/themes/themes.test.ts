import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { createProject, findProjectByName, listProjects, updateProject } from "../projects/projects.ts";
import { createTask, getTask } from "../tasks/tasks.ts";
import { createTheme, findThemeByName, listThemes, updateTheme } from "./themes.ts";

describe("themes", () => {
  it("starts with Marion's five themes, Accounto flagged", () => {
    const themes = listThemes(testCtx());
    expect(themes.map((t) => t.name)).toEqual(["Accounto", "Code Blossom", "hvnly", "Personal", "Exercise"]);
    expect(themes.filter((t) => t.isAccounto).map((t) => t.name)).toEqual(["Accounto"]);
  });

  it("creates themes at the end", () => {
    const ctx = testCtx();
    const theme = createTheme(ctx, { name: " Garden ", color: "#00aa00" });
    expect(theme).toMatchObject({ name: "Garden", sortOrder: 6, isAccounto: false });
  });

  it("archives instead of deleting", () => {
    const ctx = testCtx();
    updateTheme(ctx, "hvnly", { archived: true });
    expect(listThemes(ctx).map((t) => t.id)).not.toContain("hvnly");
    expect(listThemes(ctx, { includeArchived: true }).find((t) => t.id === "hvnly")?.archivedAt).toBeDefined();
  });

  it("keeps the Accounto flag when renamed", () => {
    const ctx = testCtx();
    expect(updateTheme(ctx, "accounto", { name: "Day job" }).isAccounto).toBe(true);
  });

  it("finds themes by name, ignoring case and spacing", () => {
    expect(findThemeByName(testCtx(), "  code   blossom")?.id).toBe("code-blossom");
  });

  it("rejects empty names", () => {
    expect(() => createTheme(testCtx(), { name: "  " })).toThrow("Name is required");
  });
});

describe("projects", () => {
  it("belongs to a theme", () => {
    const ctx = testCtx();
    const project = createProject(ctx, { themeId: "code-blossom", name: "Lisbon trip" });
    expect(listProjects(ctx, { themeId: "code-blossom" })).toEqual([project]);
    expect(findProjectByName(ctx, "code-blossom", "lisbon TRIP")?.id).toBe(project.id);
  });

  it("rejects unknown themes", () => {
    expect(() => createProject(testCtx(), { themeId: "nope", name: "X" })).toThrow("Unknown theme");
  });

  it("moves its tasks along when moved to another theme", () => {
    const ctx = testCtx();
    const project = createProject(ctx, { themeId: "personal", name: "Flat" });
    const task = createTask(ctx, { title: "Call landlord", projectId: project.id, source: "manual" });
    updateProject(ctx, project.id, { themeId: "hvnly" });
    expect(getTask(ctx, task.id)?.themeId).toBe("hvnly");
  });
});
