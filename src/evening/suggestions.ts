import type { SuggestForTasks } from "../ai/evening.ts";
import { addDays, daysBetween } from "../calendar/time.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import { learningTexts } from "../learnings/learnings.ts";
import { createTask, dropTask, getTask, updateTask, type Task } from "../tasks/tasks.ts";
import { listThemes } from "../themes/themes.ts";

export const SUGGEST_AFTER_POSTPONEMENTS = 3;
export const suggestionActions = ["do_first", "break_down", "reschedule", "drop"] as const;
export type SuggestionAction = (typeof suggestionActions)[number];
export type SuggestionPayload = { subtasks?: string[]; notBefore?: string };

export type Suggestion = {
  id: string;
  taskId: string;
  task: Task;
  date: string;
  action: SuggestionAction;
  reason: string;
  payload: SuggestionPayload;
  status: "pending" | "applied" | "dismissed";
};

export type Postponement = { taskId: string; date: string; reason: string; note?: string };

type Draft = { action: SuggestionAction; reason: string; payload: SuggestionPayload };

const DEFAULT_RESCHEDULE_DAYS = 7;
const MAX_SUBTASKS = 5;

export async function suggestForPostponed(
  deps: { ctx: Ctx; suggest?: SuggestForTasks; log?: (message: string, error: unknown) => void },
  taskIds: string[],
  date: string,
): Promise<Suggestion[]> {
  const { ctx } = deps;
  const pending = new Set(listPendingSuggestions(ctx).map((s) => s.taskId));
  const tasks = taskIds
    .map((id) => getTask(ctx, id))
    .filter((task): task is Task => task?.status === "open" && task.postponeCount >= SUGGEST_AFTER_POSTPONEMENTS && !pending.has(task.id));
  if (tasks.length === 0) return [];
  const histories = new Map(tasks.map((task) => [task.id, postponementsFor(ctx, task.id)]));
  const drafts = new Map(tasks.map((task) => [task.id, ruleSuggestion(task, histories.get(task.id)!, date)]));
  if (deps.suggest) {
    try {
      const refined = await refineWithClaude(deps.ctx, deps.suggest, tasks, histories, drafts, date);
      for (const [taskId, draft] of refined) drafts.set(taskId, draft);
    } catch (error) {
      (deps.log ?? console.error)("Claude could not suggest, keeping rule-based suggestions", error);
    }
  }
  const now = isoNow(ctx);
  const insert = ctx.db.query(
    "INSERT INTO suggestions (id, task_id, date, action, reason, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const task of tasks) {
    const draft = drafts.get(task.id)!;
    insert.run(ctx.newId(), task.id, date, draft.action, draft.reason, JSON.stringify(draft.payload), now);
  }
  return listPendingSuggestions(ctx).filter((s) => tasks.some((t) => t.id === s.taskId));
}

export function ruleSuggestion(task: Task, history: Postponement[], date: string): Draft {
  const main = mainReason(history);
  const times = `${history.length} times`;
  const big = task.size === "L";
  const deadlineSoon = task.deadline !== undefined && daysBetween(date, task.deadline) <= 2;
  if (main === "blocked") {
    return {
      action: "reschedule",
      reason: `Put off ${times}, most recently because it was blocked. Hum will bring it back in a week.`,
      payload: { notBefore: addDays(date, DEFAULT_RESCHEDULE_DAYS) },
    };
  }
  if (deadlineSoon) {
    return { action: "do_first", reason: `Put off ${times} and due soon. Doing it first tomorrow keeps the deadline safe.`, payload: {} };
  }
  if (main === "didnt_want") {
    if (big || task.essential) {
      return { action: "break_down", reason: `Put off ${times}, mostly because you didn't want to. A smaller first step often helps.`, payload: {} };
    }
    return { action: "drop", reason: `Put off ${times}, mostly because you didn't want to. Maybe it no longer matters.`, payload: {} };
  }
  if (big) {
    const why = main === "no_time" ? ", mostly for lack of time" : "";
    return { action: "break_down", reason: `Put off ${times}${why}. It may be too big for one day; a smaller first step fits easier.`, payload: {} };
  }
  return { action: "do_first", reason: `Put off ${times}. Doing it first tomorrow gets it out of the way.`, payload: {} };
}

export function listPendingSuggestions(ctx: Ctx): Suggestion[] {
  return ctx.db
    .query<
      { id: string; task_id: string; date: string; action: SuggestionAction; reason: string; payload: string; status: Suggestion["status"] },
      []
    >("SELECT * FROM suggestions WHERE status = 'pending' ORDER BY created_at")
    .all()
    .flatMap((row) => {
      const task = getTask(ctx, row.task_id);
      if (!task || task.status !== "open") return [];
      return [
        {
          id: row.id,
          taskId: row.task_id,
          task,
          date: row.date,
          action: row.action,
          reason: row.reason,
          payload: JSON.parse(row.payload) as SuggestionPayload,
          status: row.status,
        },
      ];
    });
}

export function applySuggestion(ctx: Ctx, id: string, today: string): Task {
  const suggestion = listPendingSuggestions(ctx).find((s) => s.id === id) ?? fail(404, "Suggestion not found or already handled");
  const task = suggestion.task;
  ctx.db.transaction(() => {
    switch (suggestion.action) {
      case "do_first": {
        const tomorrow = addDays(suggestion.date, 1);
        updateTask(ctx, task.id, { firstOn: tomorrow > today ? tomorrow : today });
        break;
      }
      case "reschedule":
        updateTask(ctx, task.id, { notBefore: suggestion.payload.notBefore ?? addDays(today, DEFAULT_RESCHEDULE_DAYS) });
        break;
      case "break_down":
        for (const title of suggestion.payload.subtasks ?? []) createTask(ctx, { title, parentId: task.id, source: "manual" });
        break;
      case "drop":
        dropTask(ctx, task.id);
        break;
    }
    resolve(ctx, id, "applied", task.id);
  })();
  return getTask(ctx, task.id)!;
}

export function dismissSuggestion(ctx: Ctx, id: string): void {
  const suggestion = listPendingSuggestions(ctx).find((s) => s.id === id) ?? fail(404, "Suggestion not found or already handled");
  resolve(ctx, id, "dismissed", suggestion.taskId);
}

function resolve(ctx: Ctx, id: string, status: "applied" | "dismissed", taskId: string): void {
  ctx.db.query("UPDATE suggestions SET status = ?, resolved_at = ? WHERE id = ?").run(status, isoNow(ctx), id);
  ctx.db.query("UPDATE tasks SET postpone_count = 0 WHERE id = ?").run(taskId);
}

async function refineWithClaude(
  ctx: Ctx,
  suggest: SuggestForTasks,
  tasks: Task[],
  histories: Map<string, Postponement[]>,
  drafts: Map<string, Draft>,
  date: string,
): Promise<Map<string, Draft>> {
  const themes = listThemes(ctx, { includeArchived: true });
  const raw = (await suggest({
    today: date,
    learnings: learningTexts(ctx),
    tasks: tasks.map((task) => {
      const theme = themes.find((t) => t.id === task.themeId);
      return {
        taskId: task.id,
        title: task.title,
        notes: task.notes,
        size: task.size,
        deadline: task.deadline,
        priority: task.priority,
        essential: task.essential,
        theme: theme?.name,
        isAccounto: theme?.isAccounto ?? false,
        history: histories.get(task.id)!.map(({ date: day, reason, note }) => ({ date: day, reason, note })),
        ruleAction: drafts.get(task.id)!.action,
      };
    }),
  })) as { suggestions?: Record<string, unknown>[] };
  const refined = new Map<string, Draft>();
  for (const item of Array.isArray(raw?.suggestions) ? raw.suggestions : []) {
    const task = tasks.find((t) => t.id === item?.taskId);
    const action = item?.action as SuggestionAction;
    const reason = typeof item?.reason === "string" ? item.reason.trim().slice(0, 300) : "";
    if (!task || !suggestionActions.includes(action) || !reason) continue;
    if (action === "drop" && task.essential) continue;
    const isAccounto = themes.find((t) => t.id === task.themeId)?.isAccounto ?? false;
    const payload: SuggestionPayload = {};
    if (action === "break_down" && !isAccounto && Array.isArray(item.subtasks)) {
      payload.subtasks = item.subtasks
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .map((s) => s.trim().slice(0, 120))
        .slice(0, MAX_SUBTASKS);
    }
    if (action === "reschedule") {
      const days = Number(item.rescheduleDays);
      payload.notBefore = addDays(date, Number.isInteger(days) && days >= 1 && days <= 60 ? days : DEFAULT_RESCHEDULE_DAYS);
    }
    refined.set(task.id, { action, reason, payload });
  }
  return refined;
}

function mainReason(history: Postponement[]): string {
  const given = history.filter((entry) => entry.reason !== "other");
  if (given.length === 0) return "other";
  const counts = new Map<string, number>();
  for (const entry of given) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  const latest = given[given.length - 1]!.reason;
  if (latest === "blocked") return "blocked";
  const top = Math.max(...counts.values());
  return counts.get(latest) === top ? latest : [...counts.entries()].find(([, n]) => n === top)![0];
}

function postponementsFor(ctx: Ctx, taskId: string): Postponement[] {
  return ctx.db
    .query<{ task_id: string; date: string; reason: string; note: string | null }, [string]>(
      "SELECT task_id, date, reason, note FROM postponements WHERE task_id = ? ORDER BY date",
    )
    .all(taskId)
    .map((row) => ({ taskId: row.task_id, date: row.date, reason: row.reason, note: row.note ?? undefined }));
}
