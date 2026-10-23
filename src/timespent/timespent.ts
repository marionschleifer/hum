import { addDays } from "../calendar/time.ts";
import { fail, type Ctx } from "../context.ts";
import { startOfWeek } from "../recurrence/recurrence.ts";
import { checkDate } from "../tasks/tasks.ts";
import { listThemes } from "../themes/themes.ts";

export type ThemeTime = { themeId: string; budget: number; openMinutes: number; spent?: number };

export type DayTime = { date: string; planned: boolean; recorded: boolean; themes: ThemeTime[] };

export type ThemeTotal = { themeId: string; budget: number; spent: number; budgetOnRecordedDays: number; recordedDays: number };

export type WeekSummary = { monday: string; days: DayTime[]; totals: ThemeTotal[] };

export type TimeRecord = { date: string; theme: string; budget: number; openMinutes: number; spent: number };

type PlanRow = { date: string; energy: string; budgets: string; open_work: string; time_spent: string | null };

const MAX_MINUTES = 16 * 60;
const RECENT_DAYS = 14;

export function recordTimeSpent(ctx: Ctx, date: string, minutes: Record<string, number>): Record<string, number> {
  checkDate(date);
  if (!planRow(ctx, date)) fail(409, "There is no plan for that day");
  const themes = listThemes(ctx, { includeArchived: true });
  const clean: Record<string, number> = {};
  for (const [themeId, value] of Object.entries(minutes ?? {})) {
    const theme = themes.find((t) => t.id === themeId) ?? fail(400, "Unknown theme");
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > MAX_MINUTES) fail(400, `Invalid time for ${theme.name}`);
    clean[themeId] = Math.round(number);
  }
  ctx.db.query("UPDATE day_plans SET time_spent = ? WHERE date = ?").run(JSON.stringify(clean), date);
  return clean;
}

export function timeSpentOn(ctx: Ctx, date: string): Record<string, number> | undefined {
  const row = planRow(ctx, checkDate(date));
  return row?.time_spent ? (JSON.parse(row.time_spent) as Record<string, number>) : undefined;
}

export function dayTime(ctx: Ctx, date: string): DayTime {
  checkDate(date);
  const row = planRow(ctx, date);
  const spent = row?.time_spent ? (JSON.parse(row.time_spent) as Record<string, number>) : undefined;
  return {
    date,
    planned: row !== undefined,
    recorded: spent !== undefined,
    themes: listThemes(ctx).map((theme) => themeTime(theme.id, row, spent)),
  };
}

export function weekSummary(ctx: Ctx, anyDay: string): WeekSummary {
  const monday = startOfWeek(checkDate(anyDay));
  const days = Array.from({ length: 7 }, (_, i) => dayTime(ctx, addDays(monday, i)));
  const totals = listThemes(ctx).map((theme) => {
    const entries = days.map((day) => ({ day, time: day.themes.find((t) => t.themeId === theme.id)! }));
    const recorded = entries.filter(({ day }) => day.recorded);
    return {
      themeId: theme.id,
      budget: sum(entries.map(({ time }) => time.budget)),
      spent: sum(recorded.map(({ time }) => time.spent ?? 0)),
      budgetOnRecordedDays: sum(recorded.map(({ time }) => time.budget)),
      recordedDays: recorded.length,
    };
  });
  return { monday, days, totals };
}

export function recentTimeRecords(ctx: Ctx, date: string): TimeRecord[] {
  const since = addDays(checkDate(date), -RECENT_DAYS);
  const themes = listThemes(ctx, { includeArchived: true });
  return ctx.db
    .query<PlanRow, [string, string]>(
      "SELECT date, energy, budgets, open_work, time_spent FROM day_plans WHERE date > ? AND date <= ? AND time_spent IS NOT NULL ORDER BY date",
    )
    .all(since, date)
    .flatMap((row) => {
      const spent = JSON.parse(row.time_spent!) as Record<string, number>;
      return themes.flatMap((theme) => {
        const time = themeTime(theme.id, row, spent);
        if (time.budget === 0 && !time.spent) return [];
        return [{ date: row.date, theme: theme.name, budget: time.budget, openMinutes: time.openMinutes, spent: time.spent ?? 0 }];
      });
    });
}

function themeTime(themeId: string, row: PlanRow | undefined, spent: Record<string, number> | undefined): ThemeTime {
  const sick = row?.energy === "sick";
  const budget = row && !sick ? ((JSON.parse(row.budgets) as Record<string, number>)[themeId] ?? 0) : 0;
  const open = row && !sick ? ((JSON.parse(row.open_work) as Record<string, number>)[themeId] ?? 0) : 0;
  const time: ThemeTime = { themeId, budget, openMinutes: Math.min(budget, open) };
  if (spent?.[themeId] !== undefined) time.spent = spent[themeId];
  return time;
}

function planRow(ctx: Ctx, date: string): PlanRow | undefined {
  return (
    ctx.db
      .query<PlanRow, [string]>("SELECT date, energy, budgets, open_work, time_spent FROM day_plans WHERE date = ?")
      .get(date) ?? undefined
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
