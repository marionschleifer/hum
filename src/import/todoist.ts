import { fail, isoNow, type Ctx } from "../context.ts";
import { createProject, findProjectByName } from "../projects/projects.ts";
import type { Recurrence } from "../recurrence/recurrence.ts";
import { findThemeByName, getTheme } from "../themes/themes.ts";
import { createTask } from "../tasks/tasks.ts";
import { parseTodoistRecurrence } from "./todoist-recurrence.ts";

export type TodoistProject = {
  id: string;
  name: string;
  parent_id?: string | null;
  inbox_project?: boolean;
  is_archived?: boolean;
  is_deleted?: boolean;
  child_order?: number;
};

export type TodoistItem = {
  id: string;
  content: string;
  description?: string | null;
  project_id: string;
  parent_id?: string | null;
  labels?: string[];
  priority?: number;
  due?: { string?: string; is_recurring?: boolean; date?: string } | null;
  deadline?: { date?: string } | null;
  checked?: boolean;
  is_deleted?: boolean;
  child_order?: number;
};

export type TodoistData = { projects: TodoistProject[]; items: TodoistItem[] };

export type ImportTarget =
  | { kind: "theme"; themeId: string }
  | { kind: "project"; themeId: string; projectName: string }
  | { kind: "inbox" }
  | { kind: "skip" };

export type ImportPreview = {
  alreadyImported: boolean;
  projects: { id: string; name: string; path: string; taskCount: number; suggestion: ImportTarget }[];
  taskCount: number;
  unclearRecurrences: string[];
};

export type ImportSummary = { tasks: number; subtasks: number; inInbox: number; skipped: number; projectsCreated: number };

const IMPORTED_KEY = "todoist_imported_at";

export function createTodoistFetcher(token: string, send: typeof fetch = fetch): () => Promise<TodoistData> {
  return async () => {
    const response = await send("https://api.todoist.com/api/v1/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sync_token: "*", resource_types: JSON.stringify(["projects", "items"]) }),
    });
    if (!response.ok) throw new Error(`Todoist ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as Partial<TodoistData>;
    return { projects: body.projects ?? [], items: body.items ?? [] };
  };
}

export function previewImport(ctx: Ctx, data: TodoistData): ImportPreview {
  const projects = activeProjects(data);
  const items = activeItems(data);
  const byId = new Map(projects.map((project) => [project.id, project]));
  const suggestions = new Map<string, ImportTarget>();
  const suggest = (project: TodoistProject): ImportTarget => {
    const known = suggestions.get(project.id);
    if (known) return known;
    const parent = project.parent_id ? byId.get(project.parent_id) : undefined;
    const suggestion = suggestTarget(ctx, project, parent ? suggest(parent) : undefined);
    suggestions.set(project.id, suggestion);
    return suggestion;
  };
  return {
    alreadyImported: isImported(ctx),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: projectPath(project, byId),
      taskCount: items.filter((item) => item.project_id === project.id).length,
      suggestion: suggest(project),
    })),
    taskCount: items.length,
    unclearRecurrences: [
      ...new Set(
        items
          .map((item) => recurrenceOf(item))
          .filter((r): r is Extract<Recurrence, { kind: "unparsed" }> => r?.kind === "unparsed")
          .map((r) => r.text),
      ),
    ],
  };
}

export function runImport(ctx: Ctx, data: TodoistData, mapping: Record<string, ImportTarget>): ImportSummary {
  if (isImported(ctx)) fail(409, "Todoist was already imported");
  for (const target of Object.values(mapping)) checkTarget(ctx, target);
  const items = activeItems(data);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const summary: ImportSummary = { tasks: 0, subtasks: 0, inInbox: 0, skipped: 0, projectsCreated: 0 };
  const humIds = new Map<string, string>();
  const placements = new Map<string, { themeId?: string; projectId?: string } | "skip">();

  const placementFor = (projectId: string) => {
    const known = placements.get(projectId);
    if (known) return known;
    const placement = resolveTarget(ctx, mapping[projectId] ?? { kind: "inbox" }, summary);
    placements.set(projectId, placement);
    return placement;
  };

  ctx.db.transaction(() => {
    const ordered = [...items].sort((a, b) => depth(a, itemsById) - depth(b, itemsById) || (a.child_order ?? 0) - (b.child_order ?? 0));
    for (const item of ordered) {
      const rootId = rootOf(item, itemsById).id;
      const parentHumId = rootId === item.id ? undefined : humIds.get(rootId);
      const placement = placementFor(itemsById.get(rootId)!.project_id);
      if (placement === "skip" || (rootId !== item.id && !parentHumId)) {
        summary.skipped++;
        continue;
      }
      const recurrence = recurrenceOf(item);
      const task = createTask(ctx, {
        title: item.content,
        notes: item.description ?? undefined,
        parentId: parentHumId,
        themeId: placement.themeId,
        projectId: placement.projectId,
        inbox: recurrence?.kind === "unparsed",
        priority: item.priority === 4 ? "high" : "normal",
        deadline: validDate(item.deadline?.date),
        recurrence,
        labels: item.labels ?? [],
        source: "todoist",
        sourceRef: item.id,
      });
      humIds.set(item.id, task.id);
      if (parentHumId) summary.subtasks++;
      else summary.tasks++;
      if (!parentHumId && task.status === "inbox") summary.inInbox++;
    }
    ctx.db.query("INSERT INTO meta (key, value) VALUES (?, ?)").run(IMPORTED_KEY, isoNow(ctx));
  })();
  return summary;
}

function suggestTarget(ctx: Ctx, project: TodoistProject, parent: ImportTarget | undefined): ImportTarget {
  if (project.inbox_project) return { kind: "inbox" };
  const theme = findThemeByName(ctx, project.name);
  if (theme) return { kind: "theme", themeId: theme.id };
  if (parent?.kind === "theme") return { kind: "project", themeId: parent.themeId, projectName: project.name };
  if (parent?.kind === "project") return parent;
  return { kind: "inbox" };
}

function resolveTarget(
  ctx: Ctx,
  target: ImportTarget,
  summary: ImportSummary,
): { themeId?: string; projectId?: string } | "skip" {
  switch (target.kind) {
    case "skip":
      return "skip";
    case "inbox":
      return {};
    case "theme":
      return { themeId: target.themeId };
    case "project": {
      const existing = findProjectByName(ctx, target.themeId, target.projectName);
      if (existing) return { themeId: target.themeId, projectId: existing.id };
      summary.projectsCreated++;
      const created = createProject(ctx, { themeId: target.themeId, name: target.projectName });
      return { themeId: target.themeId, projectId: created.id };
    }
  }
}

function checkTarget(ctx: Ctx, target: ImportTarget): void {
  if (!["theme", "project", "inbox", "skip"].includes(target?.kind)) fail(400, "Invalid import target");
  if ((target.kind === "theme" || target.kind === "project") && !getTheme(ctx, target.themeId)) {
    fail(400, "Unknown theme in import mapping");
  }
  if (target.kind === "project" && !target.projectName?.trim()) fail(400, "Project name is required");
}

function isImported(ctx: Ctx): boolean {
  return ctx.db.query("SELECT 1 FROM meta WHERE key = ?").get(IMPORTED_KEY) !== null;
}

function activeProjects(data: TodoistData): TodoistProject[] {
  return data.projects.filter((project) => !project.is_archived && !project.is_deleted);
}

function activeItems(data: TodoistData): TodoistItem[] {
  return data.items.filter((item) => !item.checked && !item.is_deleted && item.content.trim() !== "");
}

function recurrenceOf(item: TodoistItem): Recurrence | undefined {
  return item.due?.is_recurring && item.due.string ? parseTodoistRecurrence(item.due.string) : undefined;
}

function rootOf(item: TodoistItem, byId: Map<string, TodoistItem>): TodoistItem {
  let current = item;
  const seen = new Set<string>();
  while (current.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parent_id)!;
  }
  return current;
}

function depth(item: TodoistItem, byId: Map<string, TodoistItem>): number {
  return rootOf(item, byId).id === item.id ? 0 : 1;
}

function projectPath(project: TodoistProject, byId: Map<string, TodoistProject>): string {
  const parent = project.parent_id ? byId.get(project.parent_id) : undefined;
  return parent ? `${projectPath(parent, byId)} / ${project.name}` : project.name;
}

function validDate(value: string | undefined): string | undefined {
  const day = value?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}
