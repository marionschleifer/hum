import { addDays } from "../calendar/time.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import { checkDate, createTask, getTask, updateTask, type Stakes, type Task } from "../tasks/tasks.ts";
import { sessionMinutes, sessionsOn } from "../training/training.ts";
import { pickForToday } from "./dayplans.ts";
import { byStakes, minutesFor, tomorrowFit, type TomorrowFit, type Warning } from "./planner.ts";

export type Scheduled = { task: Task; noBuffer: boolean };
export type AtRiskItem = Warning & { deadlineFixed: boolean; stakes?: Stakes; fit: TomorrowFit };

export const GIVE_TIME_MINUTES = [15, 30] as const;
const USUAL_DAYS = 7;

export function scheduleForTomorrow(ctx: Ctx, taskId: string, today: string): Scheduled {
  const task = openTopLevel(ctx, taskId);
  const tomorrow = addDays(checkDate(today), 1);
  return { task: updateTask(ctx, task.id, { firstOn: tomorrow }), noBuffer: task.deadline !== undefined && task.deadline <= tomorrow };
}

export function splitFirstStep(ctx: Ctx, taskId: string, today: string, title: string): Task {
  const task = openTopLevel(ctx, taskId);
  if (!task.themeId) fail(400, "Pick a theme first");
  const step = createTask(ctx, {
    title,
    themeId: task.themeId,
    projectId: task.projectId,
    priority: task.priority,
    size: "S",
    sizeConfirmed: true,
    source: "manual",
  });
  return pickForToday(ctx, step.id, checkDate(today), { pick: true });
}

export function moveAtRisk(ctx: Ctx, today: string, moves: { taskId: string; day: string }[]): Task[] {
  checkDate(today);
  if (!Array.isArray(moves) || moves.length === 0) fail(400, "Nothing to move");
  for (const move of moves) {
    openTopLevel(ctx, move.taskId);
    if (checkDate(move.day) <= today) fail(400, "Move tasks to a later day");
  }
  return ctx.db.transaction(() => moves.map((move) => updateTask(ctx, move.taskId, { firstOn: move.day })))();
}

export function atRiskItems(ctx: Ctx, today: string, warnings: Warning[], open: Task[]): AtRiskItem[] {
  return byStakes(
    warnings.map((warning) => {
      const task = open.find((t) => t.id === warning.taskId)!;
      return { ...warning, deadlineFixed: task.deadlineFixed, stakes: task.stakes, fit: fitTomorrow(ctx, task, today, open) };
    }),
  );
}

export function withoutLetGo(ctx: Ctx, tasks: Task[]): Task[] {
  const letGo = new Set(
    ctx.db
      .query<{ task_id: string; deadline: string }, []>("SELECT task_id, deadline FROM deadline_decisions WHERE decision = 'let_go'")
      .all()
      .map((row) => `${row.task_id}|${row.deadline}`),
  );
  return tasks.filter((task) => !task.deadline || !letGo.has(`${task.id}|${task.deadline}`));
}

export function letGo(ctx: Ctx, taskId: string, today: string): Task {
  const task = openTopLevel(ctx, taskId);
  if (!task.deadline) fail(400, "This task has no deadline");
  ctx.db
    .query("INSERT INTO deadline_decisions (id, task_id, date, deadline, decision, created_at) VALUES (?, ?, ?, ?, 'let_go', ?)")
    .run(ctx.newId(), task.id, checkDate(today), task.deadline, isoNow(ctx));
  return task;
}

export function moveDeadline(ctx: Ctx, taskId: string, today: string, deadline: string): Task {
  const task = openTopLevel(ctx, taskId);
  if (task.deadlineFixed) fail(409, "This deadline is fixed");
  if (checkDate(deadline) <= checkDate(today)) fail(400, "Pick a day after today");
  return updateTask(ctx, task.id, { deadline });
}

export function giveTimeToday(ctx: Ctx, taskId: string, today: string, minutes: number, from: string | undefined): Task {
  const task = openTopLevel(ctx, taskId);
  if (!task.themeId) fail(400, "Pick a theme first");
  if (!GIVE_TIME_MINUTES.includes(minutes as 15 | 30)) fail(400, "Give 15 or 30 minutes");
  if (from === task.themeId) fail(400, "Take the time from another theme");
  const row = ctx.db.query<{ budgets: string }, [string]>("SELECT budgets FROM day_plans WHERE date = ?").get(checkDate(today));
  if (!row) fail(409, "Plan the day first");
  const budgets = JSON.parse(row.budgets) as Record<string, number>;
  if (from) {
    if ((budgets[from] ?? 0) < minutes) fail(400, "That theme does not have that much time today");
    budgets[from] = budgets[from]! - minutes;
  }
  budgets[task.themeId] = (budgets[task.themeId] ?? 0) + minutes;
  return ctx.db.transaction(() => {
    ctx.db.query("UPDATE day_plans SET budgets = ? WHERE date = ?").run(JSON.stringify(budgets), today);
    return pickForToday(ctx, task.id, today, { pick: true });
  })();
}

function fitTomorrow(ctx: Ctx, task: Task, today: string, open: Task[]): TomorrowFit {
  const tomorrow = addDays(today, 1);
  const committed = open
    .filter((t) => t.id !== task.id && !t.parentId && t.themeId === task.themeId)
    .filter((t) => !(t.notBefore && t.notBefore > tomorrow))
    .filter((t) => t.firstOn === tomorrow || (t.deadline !== undefined && t.deadline <= tomorrow))
    .reduce((sum, t) => sum + minutesFor(t).minutes, 0);
  const training = task.themeId === "exercise" ? sessionsOn(ctx, tomorrow).reduce((sum, s) => sum + sessionMinutes(s), 0) : 0;
  return tomorrowFit(minutesFor(task).minutes, usualBudget(ctx, task.themeId!, today), committed + training);
}

function usualBudget(ctx: Ctx, themeId: string, before: string): number | undefined {
  const rows = ctx.db
    .query<{ budgets: string }, [string, number]>(
      "SELECT budgets FROM day_plans WHERE date < ? AND energy != 'sick' ORDER BY date DESC LIMIT ?",
    )
    .all(before, USUAL_DAYS);
  if (rows.length === 0) return undefined;
  const total = rows.reduce((sum, row) => sum + ((JSON.parse(row.budgets) as Record<string, number>)[themeId] ?? 0), 0);
  return Math.round(total / rows.length);
}

function openTopLevel(ctx: Ctx, taskId: string): Task {
  const task = getTask(ctx, taskId) ?? fail(404, "Task not found");
  if (task.parentId) fail(400, "Pick the main task, not a subtask");
  if (task.status !== "open") fail(409, "Only open tasks can be scheduled");
  return task;
}
