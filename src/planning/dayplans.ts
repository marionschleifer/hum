import type { ChoosePlan, ParseBudgets } from "../ai/planning.ts";
import { calendarDay, type CalendarEvent } from "../calendar/calendar.ts";
import { isValidTimeZone } from "../calendar/time.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import type { GoogleApi } from "../google/google.ts";
import { atRiskItems, withoutLetGo, type AtRiskItem } from "./at-risk.ts";
import { learningTexts } from "../learnings/learnings.ts";
import { checkDate, getTask, listTasks, updateTask, type Task } from "../tasks/tasks.ts";
import { listThemes, normalizeName, type Theme } from "../themes/themes.ts";
import { sessionsOn, trainingWeek, type TrainingSession, type TrainingWeek } from "../training/training.ts";
import { deadlineWarnings, energies, firstMisfit, minutesFor, planDay, selectItems, sickDayMoves, type Energy, type PlanItem, type SickMove, type ThemePlan } from "./planner.ts";

export type PlanDeps = {
  ctx: Ctx;
  google?: GoogleApi;
  choosePlan?: ChoosePlan;
  parseBudgets?: ParseBudgets;
  log?: (message: string, error: unknown) => void;
};

export type PlanRequest = {
  today: string;
  timeZone: string;
  energy: Energy;
  energyNote?: string;
  budgets: Record<string, number>;
  openWork?: Record<string, number>;
};

export type PlannedTask = PlanItem & { task: Task; doneToday: boolean };

export type ThemePlanView = Omit<ThemePlan, "items" | "pool"> & { items: PlannedTask[]; tooBig?: { task: Task; minutes: number } };

export type DayPlanView = {
  energy: Energy;
  energyNote?: string;
  aiNote?: string;
  budgets: Record<string, number>;
  openWork: Record<string, number>;
  createdAt: string;
  replannedAt?: string;
  wrappedUpAt?: string;
  themes: ThemePlanView[];
};

export type TodayView = {
  date: string;
  connected: boolean;
  calendarError?: string;
  meetings: CalendarEvent[];
  training: TrainingSession[];
  week: TrainingWeek;
  due: Task[];
  plan?: DayPlanView;
  warnings: AtRiskItem[];
  sickMoves?: SickMove[];
};

const POOL_FOR_AI = 12;
const PICKED_REASON = "You picked this for today";
const MAX_BUDGET_MINUTES = 16 * 60;

export async function makeDayPlan(deps: PlanDeps, request: PlanRequest): Promise<TodayView> {
  const { ctx } = deps;
  const today = checkDate(request.today);
  const timeZone = checkTimeZone(request.timeZone);
  if (!energies.includes(request.energy)) fail(400, "Invalid energy");
  const themes = listThemes(ctx);
  const budgets = cleanBudgets(request.budgets, themes);
  const openWork = cleanOpenWork(request.openWork ?? {}, budgets, themes);
  const calendar = await readCalendar(deps, today, timeZone);
  const tasks = listTasks(ctx, { status: ["open"] }, today);
  const plans = planDay({
    today,
    energy: request.energy,
    budgets,
    openWork,
    themeIds: themes.map((theme) => theme.id),
    trainingThemeId: trainingThemeId(themes),
    tasks,
    lastCompletedOn: lastCompletions(ctx),
    meetings: calendar.meetings,
    training: sessionsOn(ctx, today),
  });
  const chosen = await chooseWithClaude(deps, { today, energy: request.energy, energyNote: request.energyNote, themes, tasks, plans, meetings: calendar.meetings });
  saveDayPlan(ctx, today, request, { budgets, openWork }, chosen.plans, chosen.note);
  return todayView(deps, today, timeZone);
}

export async function todayView(deps: PlanDeps, today: string, timeZone: string): Promise<TodayView> {
  const { ctx } = deps;
  checkDate(today);
  checkTimeZone(timeZone);
  const calendar = await readCalendar(deps, today, timeZone);
  const training = sessionsOn(ctx, today);
  const open = listTasks(ctx, { status: ["open"] }, today);
  const due = open.filter((task) => !task.parentId && task.deadline !== undefined && task.deadline <= today);
  const plan = storedPlan(ctx, today, calendar.meetings, training);
  const plannedIds = new Set(plan?.themes.flatMap((theme) => theme.items.map((item) => item.taskId)) ?? []);
  const budgets = Object.fromEntries(plan?.themes.map((theme) => [theme.themeId, theme.budget - theme.openMinutes]) ?? []);
  const warnings = plan ? atRiskItems(ctx, today, deadlineWarnings({ today, budgets, tasks: withoutLetGo(ctx, open) }, plannedIds), open) : [];
  return {
    date: today,
    connected: calendar.connected,
    calendarError: calendar.error,
    meetings: calendar.meetings,
    training,
    week: trainingWeek(ctx, today, today),
    due,
    plan,
    warnings,
    sickMoves: plan?.energy === "sick" && warnings.length ? sickDayMoves(today, warnings) : undefined,
  };
}

export function pickForToday(ctx: Ctx, taskId: string, today: string, options: { pick: boolean; themeId?: string }): Task {
  checkDate(today);
  const existing = getTask(ctx, taskId) ?? fail(404, "Task not found");
  if (existing.parentId) fail(400, "Pick the main task, not a subtask");
  if (existing.status === "done" || existing.status === "dropped") fail(409, `Task is already ${existing.status}`);
  const task = options.themeId ? updateTask(ctx, taskId, { themeId: options.themeId }) : existing;
  if (!options.pick) {
    ctx.db.transaction(() => {
      if (task.firstOn === today) updateTask(ctx, taskId, { firstOn: "" });
      ctx.db.query("DELETE FROM day_plan_items WHERE date = ? AND task_id = ?").run(today, taskId);
    })();
    return getTask(ctx, taskId)!;
  }
  if (!task.themeId) fail(400, "Pick a theme first");
  ctx.db.transaction(() => {
    updateTask(ctx, taskId, { firstOn: today });
    const hasPlan = ctx.db.query("SELECT 1 FROM day_plans WHERE date = ?").get(today) !== null;
    const planned = ctx.db.query("SELECT 1 FROM day_plan_items WHERE date = ? AND task_id = ?").get(today, taskId) !== null;
    if (!hasPlan) return;
    const { minutes, sizeAssumed } = minutesFor(task);
    if (planned) {
      ctx.db
        .query("UPDATE day_plan_items SET theme_id = ?, reason = ?, sort_order = -1 WHERE date = ? AND task_id = ?")
        .run(task.themeId!, PICKED_REASON, today, taskId);
      return;
    }
    const top = ctx.db
      .query<{ low: number | null }, [string, string]>("SELECT MIN(sort_order) AS low FROM day_plan_items WHERE date = ? AND theme_id = ?")
      .get(today, task.themeId!)?.low;
    ctx.db
      .query(
        `INSERT INTO day_plan_items (date, task_id, theme_id, sort_order, minutes, size_assumed, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(today, taskId, task.themeId!, (top ?? 0) - 1, minutes, sizeAssumed ? 1 : 0, PICKED_REASON);
  })();
  return getTask(ctx, taskId)!;
}

export async function parseMorningNote(
  deps: PlanDeps,
  text: string,
): Promise<{ budgets: Record<string, number>; openWork?: Record<string, number>; energy?: Energy; note?: string }> {
  if (!text.trim()) fail(400, "Say or type how much time each theme gets");
  if (!deps.parseBudgets) fail(503, "Reading budgets from text needs ANTHROPIC_API_KEY");
  const themes = listThemes(deps.ctx);
  const raw = (await deps.parseBudgets(text, themes.map((theme) => theme.name))) as {
    budgets?: { theme?: unknown; minutes?: unknown; open?: unknown }[];
    energy?: unknown;
    note?: unknown;
  };
  const budgets: Record<string, number> = {};
  const openWork: Record<string, number> = {};
  for (const entry of Array.isArray(raw?.budgets) ? raw.budgets : []) {
    const theme = themes.find((t) => normalizeName(t.name) === normalizeName(String(entry?.theme ?? "")));
    const minutes = Number(entry?.minutes);
    if (!theme || !Number.isFinite(minutes)) continue;
    budgets[theme.id] = clampMinutes(minutes);
    const open = Number(entry?.open);
    if (Number.isFinite(open) && open > 0) openWork[theme.id] = Math.min(budgets[theme.id]!, clampMinutes(open));
  }
  return {
    budgets,
    ...(Object.keys(openWork).length ? { openWork } : {}),
    energy: energies.includes(raw?.energy as Energy) ? (raw.energy as Energy) : undefined,
    note: typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim() : undefined,
  };
}

async function chooseWithClaude(
  deps: PlanDeps,
  context: {
    today: string;
    energy: Energy;
    energyNote?: string;
    themes: Theme[];
    tasks: Task[];
    plans: ThemePlan[];
    meetings: CalendarEvent[];
  },
): Promise<{ plans: ThemePlan[]; note?: string }> {
  const active = context.plans.filter((plan) => plan.pool.length > 0 && (plan.available > 0 || plan.items.length > 0));
  if (!deps.choosePlan || active.length === 0) return { plans: context.plans };
  const titles = new Map(context.tasks.map((task) => [task.id, task.title]));
  try {
    const raw = (await deps.choosePlan({
      today: context.today,
      weekday: new Date(`${context.today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      energy: context.energy,
      energyNote: context.energyNote?.trim() || undefined,
      learnings: learningTexts(deps.ctx),
      themes: active.map((plan) => {
        const theme = context.themes.find((t) => t.id === plan.themeId)!;
        return {
          themeId: plan.themeId,
          name: theme.name,
          isAccounto: theme.isAccounto,
          available: plan.available,
          meetings: context.meetings.filter((m) => m.themeId === plan.themeId && m.blocking).map((m) => m.title),
          pool: plan.pool
            .filter((item, index) => index < POOL_FOR_AI || item.mandatory)
            .map((item) => ({ ...item, title: titles.get(item.taskId) ?? "" })),
        };
      }),
    })) as { themes?: { themeId?: unknown; taskIds?: unknown }[]; note?: unknown };
    const choices = new Map(
      (Array.isArray(raw?.themes) ? raw.themes : [])
        .filter((choice) => typeof choice?.themeId === "string" && Array.isArray(choice.taskIds))
        .map((choice) => [choice.themeId as string, (choice.taskIds as unknown[]).filter((id): id is string => typeof id === "string")]),
    );
    const plans = context.plans.map((plan) => {
      const order = choices.get(plan.themeId);
      return order ? { ...plan, items: selectItems(plan.pool, order, plan.available) } : plan;
    });
    const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 400) || undefined : undefined;
    return { plans, note };
  } catch (error) {
    (deps.log ?? console.error)("Claude could not refine the plan, keeping the ranked plan", error);
    return { plans: context.plans };
  }
}

function saveDayPlan(
  ctx: Ctx,
  today: string,
  request: PlanRequest,
  time: { budgets: Record<string, number>; openWork: Record<string, number> },
  plans: ThemePlan[],
  aiNote: string | undefined,
): void {
  const now = isoNow(ctx);
  ctx.db.transaction(() => {
    ctx.db.query("DELETE FROM day_plan_items WHERE date = ?").run(today);
    ctx.db
      .query(
        `INSERT INTO day_plans (date, energy, energy_note, budgets, open_work, ai_note, too_big, created_at, replanned_at)
         VALUES ($date, $energy, $note, $budgets, $openWork, $ai, $tooBig, $now, NULL)
         ON CONFLICT(date) DO UPDATE SET energy = $energy, energy_note = $note, budgets = $budgets, open_work = $openWork,
           ai_note = $ai, too_big = $tooBig, replanned_at = $now`,
      )
      .run({
        date: today,
        energy: request.energy,
        note: request.energyNote?.trim() || null,
        budgets: JSON.stringify(time.budgets),
        openWork: JSON.stringify(time.openWork),
        ai: aiNote ?? null,
        tooBig: JSON.stringify(
          Object.fromEntries(plans.flatMap((plan) => {
            const misfit = firstMisfit(plan);
            return misfit ? [[plan.themeId, { taskId: misfit.taskId, minutes: misfit.minutes }]] : [];
          })),
        ),
        now,
      });
    const insert = ctx.db.query(
      `INSERT INTO day_plan_items (date, task_id, theme_id, sort_order, minutes, size_assumed, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const plan of plans) {
      plan.items.forEach((item, index) =>
        insert.run(today, item.taskId, plan.themeId, index, item.minutes, item.sizeAssumed ? 1 : 0, item.reason || null),
      );
    }
  })();
}

function storedPlan(ctx: Ctx, today: string, meetings: CalendarEvent[], training: TrainingSession[]): DayPlanView | undefined {
  const row = ctx.db
    .query<
      {
        energy: Energy;
        energy_note: string | null;
        budgets: string;
        open_work: string;
        ai_note: string | null;
        too_big: string;
        created_at: string;
        replanned_at: string | null;
        wrapped_up_at: string | null;
      },
      [string]
    >("SELECT * FROM day_plans WHERE date = ?")
    .get(today);
  if (!row) return undefined;
  const budgets = JSON.parse(row.budgets) as Record<string, number>;
  const openWork = JSON.parse(row.open_work) as Record<string, number>;
  const tooBig = JSON.parse(row.too_big) as Record<string, { taskId: string; minutes: number }>;
  const themes = listThemes(ctx);
  const items = ctx.db
    .query<
      { task_id: string; theme_id: string; minutes: number; size_assumed: number; reason: string | null },
      [string]
    >("SELECT * FROM day_plan_items WHERE date = ? ORDER BY sort_order")
    .all(today);
  const plannedIds = new Set(items.map((item) => item.task_id));
  const completedToday = new Set(
    ctx.db.query<{ task_id: string }, [string]>("SELECT task_id FROM completions WHERE completed_on = ?").all(today).map((r) => r.task_id),
  );
  const plannedRaw = planDay({
    today,
    energy: row.energy,
    budgets,
    openWork,
    themeIds: themes.map((theme) => theme.id),
    trainingThemeId: trainingThemeId(themes),
    tasks: [],
    lastCompletedOn: new Map(),
    meetings,
    training,
  });
  return {
    energy: row.energy,
    energyNote: row.energy_note ?? undefined,
    aiNote: row.ai_note ?? undefined,
    budgets,
    openWork,
    createdAt: row.created_at,
    replannedAt: row.replanned_at ?? undefined,
    wrappedUpAt: row.wrapped_up_at ?? undefined,
    themes: plannedRaw.map(({ items: _items, pool: _pool, ...numbers }) => {
      let remaining = numbers.available;
      const themeItems: PlannedTask[] = items
        .filter((item) => item.theme_id === numbers.themeId)
        .flatMap((item) => {
          const task = getTask(ctx, item.task_id);
          if (!task) return [];
          const overBudget = item.minutes > remaining;
          if (!overBudget) remaining -= item.minutes;
          return [
            {
              taskId: item.task_id,
              minutes: item.minutes,
              sizeAssumed: item.size_assumed === 1,
              reason: item.reason ?? "",
              overBudget,
              task,
              doneToday: task.status === "done" || completedToday.has(task.id),
            },
          ];
        });
      const misfit = tooBig[numbers.themeId];
      const stillTooBig = misfit && !plannedIds.has(misfit.taskId) && misfit.minutes > remaining;
      const misfitTask = stillTooBig ? getTask(ctx, misfit.taskId) : undefined;
      return {
        ...numbers,
        tooBig: misfitTask?.status === "open" ? { task: misfitTask, minutes: misfit!.minutes } : undefined,
        items: themeItems,
      };
    }),
  };
}

async function readCalendar(
  deps: PlanDeps,
  today: string,
  timeZone: string,
): Promise<{ connected: boolean; meetings: CalendarEvent[]; error?: string }> {
  try {
    return await calendarDay(deps.ctx, deps.google, today, timeZone);
  } catch (error) {
    (deps.log ?? console.error)("Could not read the calendar", error);
    return { connected: true, meetings: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function lastCompletions(ctx: Ctx): Map<string, string> {
  return new Map(
    ctx.db
      .query<{ task_id: string; last: string }, []>("SELECT task_id, MAX(completed_on) AS last FROM completions GROUP BY task_id")
      .all()
      .map((row) => [row.task_id, row.last]),
  );
}

function cleanBudgets(budgets: Record<string, number>, themes: Theme[]): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const theme of themes) {
    const value = Number(budgets?.[theme.id] ?? 0);
    if (!Number.isFinite(value) || value < 0) fail(400, `Invalid budget for ${theme.name}`);
    clean[theme.id] = clampMinutes(value);
  }
  return clean;
}

function cleanOpenWork(openWork: Record<string, number>, budgets: Record<string, number>, themes: Theme[]): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const theme of themes) {
    const value = Number(openWork?.[theme.id] ?? 0);
    if (!Number.isFinite(value) || value < 0) fail(400, `Invalid open work for ${theme.name}`);
    const minutes = clampMinutes(value);
    if (minutes > (budgets[theme.id] ?? 0)) fail(400, `Open work for ${theme.name} is more than its budget`);
    if (minutes > 0) clean[theme.id] = minutes;
  }
  return clean;
}

function clampMinutes(minutes: number): number {
  return Math.min(MAX_BUDGET_MINUTES, Math.max(0, Math.round(minutes)));
}

function trainingThemeId(themes: Theme[]): string | undefined {
  return themes.find((theme) => theme.id === "exercise")?.id;
}

function checkTimeZone(timeZone: string): string {
  if (!timeZone || !isValidTimeZone(timeZone)) fail(400, "Invalid time zone");
  return timeZone;
}
