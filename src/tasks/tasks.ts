import { fail, isoNow, type Ctx } from "../context.ts";
import { flag, text, type Row } from "../db/rows.ts";
import { getProject } from "../projects/projects.ts";
import { parseRecurrence, periodProgress, type PeriodProgress, type Recurrence } from "../recurrence/recurrence.ts";
import { getTheme } from "../themes/themes.ts";

export const taskStatuses = ["inbox", "open", "done", "dropped"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const priorities = ["high", "normal", "low"] as const;
export type Priority = (typeof priorities)[number];
export const sizes = ["S", "M", "L"] as const;
export type Size = (typeof sizes)[number];
export const stakesLevels = ["high", "low"] as const;
export type Stakes = (typeof stakesLevels)[number];
export type TaskSource = "quick_add" | "manual" | "voice" | "shortcut" | "cli" | "todoist" | "gmail" | "mcp";

export type Task = {
  id: string;
  title: string;
  notes?: string;
  parentId?: string;
  themeId?: string;
  projectId?: string;
  status: TaskStatus;
  essential: boolean;
  priority: Priority;
  size?: Size;
  sizeConfirmed: boolean;
  deadline?: string;
  deadlineFixed: boolean;
  stakes?: Stakes;
  recurrence?: Recurrence;
  labels: string[];
  source: TaskSource;
  sourceRef?: string;
  postponeCount: number;
  firstOn?: string;
  notBefore?: string;
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
  droppedAt?: string;
  progress?: PeriodProgress;
};

export type TaskInput = {
  title: string;
  notes?: string;
  parentId?: string;
  themeId?: string;
  projectId?: string;
  inbox?: boolean;
  essential?: boolean;
  priority?: Priority;
  size?: Size;
  sizeConfirmed?: boolean;
  deadline?: string;
  deadlineFixed?: boolean;
  stakes?: Stakes;
  recurrence?: Recurrence;
  labels?: string[];
  firstOn?: string;
  notBefore?: string;
  source: TaskSource;
  sourceRef?: string;
};

export type TaskPatch = {
  title?: string;
  notes?: string;
  themeId?: string;
  projectId?: string;
  status?: "inbox" | "open";
  essential?: boolean;
  priority?: Priority;
  size?: Size | "";
  sizeConfirmed?: boolean;
  deadline?: string;
  deadlineFixed?: boolean;
  stakes?: Stakes | "";
  recurrence?: Recurrence | "";
  labels?: string[];
  notBefore?: string;
  firstOn?: string;
};

export type TaskFilter = {
  status?: TaskStatus[];
  themeId?: string;
  projectId?: string;
  parentId?: string;
  essential?: boolean;
  topLevelOnly?: boolean;
};

export function createTask(ctx: Ctx, input: TaskInput): Task {
  const title = requireTitle(input.title);
  const parent = input.parentId ? requireParent(ctx, input.parentId) : undefined;
  const placement = parent
    ? { themeId: parent.themeId, projectId: parent.projectId }
    : resolvePlacement(ctx, input.themeId, input.projectId);
  const status: TaskStatus = parent
    ? parent.status === "inbox" ? "inbox" : "open"
    : placement.themeId && !input.inbox ? "open" : "inbox";
  const now = isoNow(ctx);
  const id = ctx.newId();
  ctx.db
    .query(
      `INSERT INTO tasks (id, title, notes, parent_id, theme_id, project_id, status, essential, priority, size,
         size_confirmed, deadline, deadline_fixed, stakes, recurrence, labels, first_on, not_before, source, source_ref, created_at, updated_at)
       VALUES ($id, $title, $notes, $parent, $theme, $project, $status, $essential, $priority, $size,
         $sizeConfirmed, $deadline, $deadlineFixed, $stakes, $recurrence, $labels, $firstOn, $notBefore, $source, $sourceRef, $now, $now)`,
    )
    .run({
      id,
      title,
      notes: blankToUndefined(input.notes) ?? null,
      parent: parent?.id ?? null,
      theme: placement.themeId ?? null,
      project: placement.projectId ?? null,
      status,
      essential: input.essential ? 1 : 0,
      priority: checkPriority(input.priority ?? "normal"),
      size: input.size ? checkSize(input.size) : null,
      sizeConfirmed: input.size && input.sizeConfirmed ? 1 : 0,
      deadline: input.deadline ? checkDate(input.deadline) : null,
      deadlineFixed: input.deadlineFixed ? 1 : 0,
      stakes: input.stakes ? checkStakes(input.stakes) : null,
      recurrence: input.recurrence ? JSON.stringify(parseRecurrence(input.recurrence)) : null,
      labels: JSON.stringify(cleanLabels(input.labels)),
      firstOn: input.firstOn ? checkDate(input.firstOn) : null,
      notBefore: input.notBefore ? checkDate(input.notBefore) : null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      now,
    });
  return getTask(ctx, id)!;
}

export function getTask(ctx: Ctx, id: string): Task | undefined {
  const row = ctx.db.query<Row, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? toTask(row) : undefined;
}

export function listTasks(ctx: Ctx, filter: TaskFilter = {}, today?: string): Task[] {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.status?.length) {
    const names = filter.status.map((status, i) => {
      params[`s${i}`] = status;
      return `$s${i}`;
    });
    clauses.push(`status IN (${names.join(", ")})`);
  }
  if (filter.themeId) {
    clauses.push("theme_id = $theme");
    params.theme = filter.themeId;
  }
  if (filter.projectId) {
    clauses.push("project_id = $project");
    params.project = filter.projectId;
  }
  if (filter.parentId) {
    clauses.push("parent_id = $parent");
    params.parent = filter.parentId;
  }
  if (filter.essential !== undefined) {
    clauses.push("essential = $essential");
    params.essential = filter.essential ? 1 : 0;
  }
  if (filter.topLevelOnly) clauses.push("parent_id IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const tasks = ctx.db
    .query<Row, Record<string, string | number>>(
      `SELECT * FROM tasks ${where}
       ORDER BY essential DESC, deadline IS NULL, deadline,
         CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, sort_order, created_at`,
    )
    .all(params)
    .map(toTask);
  return today ? withProgress(ctx, tasks, today) : tasks;
}

export function updateTask(ctx: Ctx, id: string, patch: TaskPatch): Task {
  const task = getTask(ctx, id) ?? fail(404, "Task not found");
  if (task.parentId && (patch.themeId !== undefined || patch.projectId !== undefined || patch.status !== undefined)) {
    fail(400, "Subtasks follow their parent");
  }
  const placement = nextPlacement(ctx, task, patch);
  const status = nextStatus(task, patch, placement.themeId);
  const size = patch.size === undefined ? task.size : patch.size === "" ? undefined : checkSize(patch.size);
  const sizeConfirmed = size === undefined ? false : (patch.sizeConfirmed ?? (patch.size ? true : task.sizeConfirmed));
  const recurrence =
    patch.recurrence === undefined ? task.recurrence : patch.recurrence === "" ? undefined : parseRecurrence(patch.recurrence);
  const deadline = patch.deadline === undefined ? task.deadline : patch.deadline === "" ? undefined : checkDate(patch.deadline);
  const notBefore = patch.notBefore === undefined ? task.notBefore : patch.notBefore === "" ? undefined : checkDate(patch.notBefore);
  const firstOn = patch.firstOn === undefined ? task.firstOn : patch.firstOn === "" ? undefined : checkDate(patch.firstOn);
  const stakes = patch.stakes === undefined ? task.stakes : patch.stakes === "" ? undefined : checkStakes(patch.stakes);
  ctx.db.transaction(() => {
    ctx.db
      .query(
        `UPDATE tasks SET title = $title, notes = $notes, theme_id = $theme, project_id = $project, status = $status,
           essential = $essential, priority = $priority, size = $size, size_confirmed = $sizeConfirmed,
           deadline = $deadline, deadline_fixed = $deadlineFixed, stakes = $stakes, recurrence = $recurrence, labels = $labels, not_before = $notBefore,
           first_on = $firstOn, updated_at = $now
         WHERE id = $id`,
      )
      .run({
        id,
        title: patch.title === undefined ? task.title : requireTitle(patch.title),
        notes: (patch.notes === undefined ? task.notes : blankToUndefined(patch.notes)) ?? null,
        theme: placement.themeId ?? null,
        project: placement.projectId ?? null,
        status,
        essential: (patch.essential ?? task.essential) ? 1 : 0,
        priority: checkPriority(patch.priority ?? task.priority),
        size: size ?? null,
        sizeConfirmed: sizeConfirmed ? 1 : 0,
        deadline: deadline ?? null,
        deadlineFixed: (patch.deadlineFixed ?? task.deadlineFixed) ? 1 : 0,
        stakes: stakes ?? null,
        recurrence: recurrence ? JSON.stringify(recurrence) : null,
        labels: JSON.stringify(patch.labels === undefined ? task.labels : cleanLabels(patch.labels)),
        notBefore: notBefore ?? null,
        firstOn: firstOn ?? null,
        now: isoNow(ctx),
      });
    ctx.db
      .query(
        `UPDATE tasks SET theme_id = $theme, project_id = $project, status = $status, updated_at = $now
         WHERE parent_id = $id AND status IN ('inbox', 'open')`,
      )
      .run({ id, theme: placement.themeId ?? null, project: placement.projectId ?? null, status, now: isoNow(ctx) });
  })();
  return getTask(ctx, id)!;
}

export function completeTask(ctx: Ctx, id: string, today: string): Task {
  const task = getTask(ctx, id) ?? fail(404, "Task not found");
  if (task.status === "done" || task.status === "dropped") fail(409, `Task is already ${task.status}`);
  const now = isoNow(ctx);
  ctx.db.transaction(() => {
    ctx.db
      .query("INSERT INTO completions (id, task_id, completed_on, completed_at) VALUES ($id, $task, $day, $now)")
      .run({ id: ctx.newId(), task: id, day: checkDate(today), now });
    if (isRepeating(task)) return;
    ctx.db
      .query(
        `UPDATE tasks SET status = 'done', done_at = $now, updated_at = $now
         WHERE (id = $id OR parent_id = $id) AND status IN ('inbox', 'open')`,
      )
      .run({ id, now });
  })();
  return withProgress(ctx, [getTask(ctx, id)!], today)[0]!;
}

export function reopenTask(ctx: Ctx, id: string, today: string): Task {
  const task = getTask(ctx, id) ?? fail(404, "Task not found");
  ctx.db.transaction(() => {
    const latest = ctx.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1",
      )
      .get(id);
    if (latest && (task.status === "done" || isRepeating(task))) {
      ctx.db.query("DELETE FROM completions WHERE id = ?").run(latest.id);
    }
    if (task.status === "done") setActive(ctx, task, "done_at");
  })();
  return withProgress(ctx, [getTask(ctx, id)!], today)[0]!;
}

export function dropTask(ctx: Ctx, id: string): Task {
  const task = getTask(ctx, id) ?? fail(404, "Task not found");
  if (task.status === "dropped") return task;
  const now = isoNow(ctx);
  ctx.db
    .query(
      `UPDATE tasks SET status = 'dropped', dropped_at = $now, updated_at = $now
       WHERE id = $id OR (parent_id = $id AND status IN ('inbox', 'open'))`,
    )
    .run({ id, now });
  return getTask(ctx, id)!;
}

export function restoreTask(ctx: Ctx, id: string): Task {
  const task = getTask(ctx, id) ?? fail(404, "Task not found");
  if (task.status !== "dropped") fail(409, "Only dropped tasks can be restored");
  setActive(ctx, task, "dropped_at");
  return getTask(ctx, id)!;
}

function setActive(ctx: Ctx, task: Task, clearColumn: "done_at" | "dropped_at"): void {
  const status: TaskStatus = task.themeId ? "open" : "inbox";
  ctx.db
    .query(`UPDATE tasks SET status = $status, ${clearColumn} = NULL, updated_at = $now WHERE id = $id`)
    .run({ id: task.id, status, now: isoNow(ctx) });
}

function withProgress(ctx: Ctx, tasks: Task[], today: string): Task[] {
  return tasks.map((task) => {
    if (task.recurrence?.kind !== "count") return task;
    const days = ctx.db
      .query<{ completed_on: string }, [string]>("SELECT completed_on FROM completions WHERE task_id = ?")
      .all(task.id)
      .map((row) => row.completed_on);
    return { ...task, progress: periodProgress(task.recurrence, days, today) };
  });
}

function isRepeating(task: Task): boolean {
  return task.recurrence !== undefined && task.recurrence.kind !== "unparsed";
}

function resolvePlacement(
  ctx: Ctx,
  themeId: string | undefined,
  projectId: string | undefined,
): { themeId?: string; projectId?: string } {
  if (projectId) {
    const project = getProject(ctx, projectId) ?? fail(400, "Unknown project");
    return { themeId: project.themeId, projectId: project.id };
  }
  if (themeId) {
    if (!getTheme(ctx, themeId)) fail(400, "Unknown theme");
    return { themeId };
  }
  return {};
}

function nextPlacement(ctx: Ctx, task: Task, patch: TaskPatch): { themeId?: string; projectId?: string } {
  if (patch.projectId) return resolvePlacement(ctx, undefined, patch.projectId);
  if (patch.themeId === "") return {};
  if (patch.themeId !== undefined) {
    const keepProject = patch.projectId !== "" && task.projectId && getProject(ctx, task.projectId)?.themeId === patch.themeId;
    return resolvePlacement(ctx, patch.themeId, keepProject ? task.projectId : undefined);
  }
  if (patch.projectId === "") return { themeId: task.themeId };
  return { themeId: task.themeId, projectId: task.projectId };
}

function nextStatus(task: Task, patch: TaskPatch, themeId: string | undefined): TaskStatus {
  if (task.status === "done" || task.status === "dropped") return task.status;
  if (!themeId) {
    if (patch.status === "open") fail(400, "Pick a theme before sorting a task out of the inbox");
    return "inbox";
  }
  if (patch.status) return patch.status;
  if (task.status === "inbox" && patch.themeId) return "open";
  return task.status;
}

function requireParent(ctx: Ctx, parentId: string): Task {
  const parent = getTask(ctx, parentId) ?? fail(400, "Unknown parent task");
  if (parent.parentId) fail(400, "Subtasks cannot have subtasks");
  return parent;
}

function requireTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed) fail(400, "Title is required");
  return trimmed;
}

function checkStakes(stakes: string): Stakes {
  if (!stakesLevels.includes(stakes as Stakes)) fail(400, "Invalid stakes");
  return stakes as Stakes;
}

function checkPriority(priority: string): Priority {
  if (!priorities.includes(priority as Priority)) fail(400, "Invalid priority");
  return priority as Priority;
}

function checkSize(size: string): Size {
  if (!sizes.includes(size as Size)) fail(400, "Invalid size");
  return size as Size;
}

export function checkDate(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) fail(400, "Invalid date");
  return day;
}

function cleanLabels(labels: string[] | undefined): string[] {
  return [...new Set((labels ?? []).map((label) => label.trim()).filter(Boolean))];
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function toTask(row: Row): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    notes: text(row.notes),
    parentId: text(row.parent_id),
    themeId: text(row.theme_id),
    projectId: text(row.project_id),
    status: row.status as TaskStatus,
    essential: flag(row.essential),
    priority: row.priority as Priority,
    size: text(row.size) as Size | undefined,
    sizeConfirmed: flag(row.size_confirmed),
    deadline: text(row.deadline),
    deadlineFixed: flag(row.deadline_fixed),
    stakes: text(row.stakes) as Stakes | undefined,
    recurrence: row.recurrence ? (JSON.parse(String(row.recurrence)) as Recurrence) : undefined,
    labels: JSON.parse(String(row.labels)) as string[],
    source: row.source as TaskSource,
    sourceRef: text(row.source_ref),
    postponeCount: Number(row.postpone_count),
    firstOn: text(row.first_on),
    notBefore: text(row.not_before),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    doneAt: text(row.done_at),
    droppedAt: text(row.dropped_at),
  };
}
