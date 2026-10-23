import type { CalendarEvent } from "../calendar/calendar.ts";
import { addDays, daysBetween } from "../calendar/time.ts";
import { currentMonthlyOccurrence, weekdays } from "../recurrence/recurrence.ts";
import { sessionMinutes, type TrainingSession } from "../training/training.ts";
import type { Size, Task } from "../tasks/tasks.ts";

export const energies = ["high", "normal", "lower", "sick"] as const;
export type Energy = (typeof energies)[number];

export const SIZE_MINUTES: Record<Size, number> = { S: 15, M: 60, L: 240 };
const ASSUMED_MINUTES = SIZE_MINUTES.M;
const AT_RISK_DAYS = 7;

export type PlanItem = { taskId: string; minutes: number; sizeAssumed: boolean; reason: string; overBudget: boolean };
export type PoolItem = Omit<PlanItem, "overBudget"> & { mandatory: boolean };

export type ThemePlan = {
  themeId: string;
  budget: number;
  meetingMinutes: number;
  trainingMinutes: number;
  openMinutes: number;
  available: number;
  items: PlanItem[];
  pool: PoolItem[];
};

export type PlanInput = {
  today: string;
  energy: Energy;
  budgets: Record<string, number>;
  openWork?: Record<string, number>;
  themeIds: string[];
  trainingThemeId?: string;
  tasks: Task[];
  lastCompletedOn: Map<string, string>;
  meetings: CalendarEvent[];
  training: TrainingSession[];
};

export type Warning = { taskId: string; themeId?: string; title: string; deadline: string; detail: string; message: string };
export type TomorrowFit = { needed: number; usual?: number; free?: number; fits?: boolean };
export type SickMove = { taskId: string; title: string; themeId?: string; deadline: string; day: string; noBuffer: boolean };

export function planDay(input: PlanInput): ThemePlan[] {
  const candidates = input.tasks.filter((task) => isCandidate(task, input));
  return input.themeIds.map((themeId) => {
    const budget = input.energy === "sick" ? 0 : Math.max(0, Math.round(input.budgets[themeId] ?? 0));
    const meetingMinutes = input.meetings
      .filter((event) => event.blocking && event.themeId === themeId)
      .reduce((sum, event) => sum + event.minutes, 0);
    const training =
      themeId === input.trainingThemeId && input.energy !== "sick"
        ? input.training.reduce((sum, session) => sum + sessionMinutes(session), 0)
        : 0;
    const openMinutes = Math.min(budget, Math.max(0, Math.round(input.openWork?.[themeId] ?? 0)));
    const available = Math.max(0, budget - meetingMinutes - training - openMinutes);
    const ranked = candidates
      .filter((task) => task.themeId === themeId)
      .map((task) => ({ task, score: score(task, input) }))
      .sort((a, b) => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt));
    const pool = ranked.map(({ task }) => poolItem(task, input));
    const items = selectItems(pool, pool.map((item) => item.taskId), available);
    return { themeId, budget, meetingMinutes, trainingMinutes: training, openMinutes, available, items, pool };
  });
}

export function selectItems(pool: PoolItem[], order: string[], available: number): PlanItem[] {
  const byId = new Map(pool.map((item) => [item.taskId, item]));
  const chosen = [...new Set(order)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  for (const item of pool) if (item.mandatory && !chosen.includes(item)) chosen.push(item);
  const items: PlanItem[] = [];
  let remaining = available;
  for (const { mandatory, ...item } of chosen) {
    if (item.minutes <= remaining) {
      items.push({ ...item, overBudget: false });
      remaining -= item.minutes;
    } else if (mandatory) {
      items.push({ ...item, overBudget: true });
    }
  }
  return items;
}

export function deadlineWarnings(input: Pick<PlanInput, "today" | "budgets" | "tasks">, plannedIds: Set<string>): Warning[] {
  const warnings: Warning[] = [];
  const horizon = addDays(input.today, AT_RISK_DAYS);
  const byTheme = new Map<string, Task[]>();
  for (const task of input.tasks) {
    if (task.status !== "open" || !task.deadline || task.deadline > horizon || !task.themeId) continue;
    if (task.notBefore && task.notBefore > input.today) continue;
    if (task.firstOn && task.firstOn > input.today) continue;
    byTheme.set(task.themeId, [...(byTheme.get(task.themeId) ?? []), task]);
  }
  for (const [themeId, tasks] of byTheme) {
    const daily = Math.max(0, input.budgets[themeId] ?? 0);
    let needed = 0;
    for (const task of tasks.sort((a, b) => a.deadline!.localeCompare(b.deadline!))) {
      needed += minutesFor(task).minutes;
      if (plannedIds.has(task.id)) continue;
      const daysLeft = daysBetween(input.today, task.deadline!);
      const warn = (detail: string) => warnings.push(warning(task, themeId, detail));
      if (daysLeft < 0) {
        warn("is overdue and not in today's plan.");
        continue;
      }
      const capacity = daily * (daysLeft + 1);
      if (daily === 0 && daysLeft <= 3) {
        warn(`is due ${dueText(daysLeft)}, but this theme has no time today.`);
      } else if (needed > capacity) {
        warn(`is due ${dueText(daysLeft)}. About ${hours(needed)} of work in this theme is due by then, and today's pace gives ${hours(capacity)}.`);
      }
    }
  }
  return warnings;
}

export function tomorrowFit(needed: number, usual: number | undefined, committed: number): TomorrowFit {
  if (usual === undefined) return { needed };
  const free = Math.max(0, usual - committed);
  return { needed, usual, free, fits: needed <= free };
}

export function byStakes<T extends { stakes?: "high" | "low"; deadline: string }>(items: T[]): T[] {
  const rank = { high: 0, none: 1, low: 2 };
  return [...items].sort((a, b) => rank[a.stakes ?? "none"] - rank[b.stakes ?? "none"] || a.deadline.localeCompare(b.deadline));
}

export function sickDayMoves(today: string, warnings: Warning[]): SickMove[] {
  return warnings.map((w) => {
    const day = sickDayLanding(today, w.deadline);
    return { taskId: w.taskId, title: w.title, themeId: w.themeId, deadline: w.deadline, day, noBuffer: day >= w.deadline };
  });
}

export function sickDayLanding(today: string, deadline: string): string {
  const tomorrow = addDays(today, 1);
  const dayBefore = addDays(deadline, -1);
  return dayBefore > tomorrow ? dayBefore : tomorrow;
}

export function firstMisfit(plan: ThemePlan): PoolItem | undefined {
  const planned = new Set(plan.items.map((item) => item.taskId));
  const used = plan.items.filter((item) => !item.overBudget).reduce((sum, item) => sum + item.minutes, 0);
  return plan.pool.find((item) => !planned.has(item.taskId) && item.minutes > plan.available - used);
}

export function minutesFor(task: Pick<Task, "size">): { minutes: number; sizeAssumed: boolean } {
  return task.size ? { minutes: SIZE_MINUTES[task.size], sizeAssumed: false } : { minutes: ASSUMED_MINUTES, sizeAssumed: true };
}

function poolItem(task: Task, input: PlanInput): PoolItem {
  return {
    taskId: task.id,
    ...minutesFor(task),
    reason: reasonFor(task, input),
    mandatory:
      task.firstOn === input.today ||
      dueBy(task, input, input.today) ||
      (input.energy === "sick" && task.essential),
  };
}

function isCandidate(task: Task, input: PlanInput): boolean {
  if (task.status !== "open" || task.parentId || !task.themeId) return false;
  if (task.notBefore && task.notBefore > input.today) return false;
  if (input.energy === "sick") {
    return task.essential || task.firstOn === input.today || dueBy(task, input, input.today);
  }
  if (input.energy === "lower" && task.size === "L" && !task.essential && task.firstOn !== input.today && !dueBy(task, input, addDays(input.today, 2))) {
    return false;
  }
  return isDueToday(task, input.today, input.lastCompletedOn.get(task.id));
}

function isDueToday(task: Task, today: string, lastCompletedOn: string | undefined): boolean {
  const recurrence = task.recurrence;
  if (!recurrence) return true;
  if (lastCompletedOn === today) return false;
  switch (recurrence.kind) {
    case "count":
      return (task.progress?.done ?? 0) < recurrence.times;
    case "weekdays":
      return recurrence.days.includes(weekdays[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7]!);
    case "every": {
      if (!lastCompletedOn) return true;
      const unitDays = { day: 1, week: 7, month: 30 }[recurrence.unit];
      return daysBetween(lastCompletedOn, today) >= recurrence.interval * unitDays;
    }
    case "monthly":
      return pendingOccurrence(task, today, lastCompletedOn) !== undefined;
    case "unparsed":
      return false;
  }
}

function pendingOccurrence(task: Task, today: string, lastCompletedOn: string | undefined): string | undefined {
  if (task.recurrence?.kind !== "monthly") return undefined;
  const occurrence = currentMonthlyOccurrence(task.recurrence, today);
  if (occurrence < task.createdAt.slice(0, 10)) return undefined;
  if (lastCompletedOn && lastCompletedOn >= occurrence) return undefined;
  return occurrence;
}

function deadlineOf(task: Task, input: Pick<PlanInput, "today" | "lastCompletedOn">): string | undefined {
  return task.deadline ?? pendingOccurrence(task, input.today, input.lastCompletedOn.get(task.id));
}

function dueBy(task: Task, input: Pick<PlanInput, "today" | "lastCompletedOn">, day: string): boolean {
  const deadline = deadlineOf(task, input);
  return deadline !== undefined && deadline <= day;
}

function score(task: Task, input: PlanInput): number {
  let total = 0;
  if (task.firstOn === input.today) total += 2000;
  if (task.essential) total += 1000;
  const deadline = deadlineOf(task, input);
  if (deadline) {
    const days = daysBetween(input.today, deadline);
    total += days < 0 ? 500 + Math.min(-days, 30) * 5 : days === 0 ? 450 : Math.max(0, 300 - days * 20);
  }
  total += { high: 120, normal: 0, low: -60 }[task.priority];
  total += Math.min(daysBetween(task.createdAt.slice(0, 10), input.today), 60) * 1.5;
  if (task.recurrence?.kind === "count" && task.progress) {
    const left = task.progress.target - task.progress.done;
    const periodEnd = task.recurrence.per === "week" ? addDays(task.progress.periodStart, 6) : endOfMonth(input.today);
    if (left >= daysBetween(input.today, periodEnd) + 1) total += 200;
  }
  if (input.energy === "lower" && task.size === "M") total -= 20;
  if (input.energy === "lower" && task.size === "S") total += 20;
  if (input.energy === "high" && task.size === "L") total += 30;
  return total;
}

function reasonFor(task: Task, input: PlanInput): string {
  const reasons: string[] = [];
  if (task.firstOn === input.today) reasons.push("You picked this for today");
  if (task.essential) reasons.push("Essential");
  const deadline = deadlineOf(task, input);
  if (deadline) {
    const days = daysBetween(input.today, deadline);
    if (days < 0) reasons.push(`Overdue by ${-days} ${-days === 1 ? "day" : "days"}`);
    else if (days <= 14) reasons.push(`Due ${dueText(days)}`);
  }
  if (task.priority === "high") reasons.push("High priority");
  if (task.recurrence?.kind === "count" && task.progress) {
    reasons.push(`${task.progress.done} of ${task.progress.target} done this ${task.recurrence.per}`);
  }
  const waiting = daysBetween(task.createdAt.slice(0, 10), input.today);
  if (reasons.length === 0 && waiting >= 7) reasons.push(`Waiting ${Math.floor(waiting / 7)} ${waiting < 14 ? "week" : "weeks"}`);
  return reasons.slice(0, 2).join(", ");
}

function warning(task: Task, themeId: string, detail: string): Warning {
  return { taskId: task.id, themeId, title: task.title, deadline: task.deadline!, detail, message: `“${task.title}” ${detail}` };
}

function dueText(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function hours(minutes: number): string {
  const value = Math.round((minutes / 60) * 10) / 10;
  return `${value}h`;
}

function endOfMonth(day: string): string {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}
