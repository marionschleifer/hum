import type { FindLearning, SuggestForTasks } from "../ai/evening.ts";
import { addDays } from "../calendar/time.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import { addLearning, learningTexts, type Learning } from "../learnings/learnings.ts";
import { checkDate, dropTask, getTask, type Task } from "../tasks/tasks.ts";
import { listThemes } from "../themes/themes.ts";
import { suggestForPostponed, type Suggestion } from "./suggestions.ts";

export const postponeReasons = ["no_time", "blocked", "didnt_want", "not_relevant", "other"] as const;
export type PostponeReason = (typeof postponeReasons)[number];

export type EveningItem = { task: Task; themeId: string; minutes: number; doneToday: boolean };

export type EveningView = {
  date: string;
  hasPlan: boolean;
  wrappedUpAt?: string;
  items: EveningItem[];
  doneUnplanned: Task[];
};

export type Answer = { taskId: string; reason: PostponeReason; note?: string };

export type EveningDeps = {
  ctx: Ctx;
  suggest?: SuggestForTasks;
  findLearning?: FindLearning;
  log?: (message: string, error: unknown) => void;
};

export type WrapUpResult = { suggestions: Suggestion[]; learning?: Learning; dropped: number; postponed: number };

const LEARNING_WINDOW_DAYS = 14;

export function eveningView(ctx: Ctx, date: string): EveningView {
  checkDate(date);
  const plan = ctx.db.query<{ wrapped_up_at: string | null }, [string]>("SELECT wrapped_up_at FROM day_plans WHERE date = ?").get(date);
  const completed = new Set(
    ctx.db.query<{ task_id: string }, [string]>("SELECT task_id FROM completions WHERE completed_on = ?").all(date).map((r) => r.task_id),
  );
  const items = ctx.db
    .query<{ task_id: string; theme_id: string; minutes: number }, [string]>(
      "SELECT task_id, theme_id, minutes FROM day_plan_items WHERE date = ? ORDER BY theme_id, sort_order",
    )
    .all(date)
    .flatMap((row) => {
      const task = getTask(ctx, row.task_id);
      return task ? [{ task, themeId: row.theme_id, minutes: row.minutes, doneToday: completed.has(task.id) }] : [];
    });
  const planned = new Set(items.map((item) => item.task.id));
  return {
    date,
    hasPlan: plan !== null,
    wrappedUpAt: plan?.wrapped_up_at ?? undefined,
    items,
    doneUnplanned: [...completed]
      .filter((id) => !planned.has(id))
      .flatMap((id) => {
        const task = getTask(ctx, id);
        return task ? [task] : [];
      }),
  };
}

export function pendingEvening(ctx: Ctx, today: string): string | undefined {
  checkDate(today);
  const open = ctx.db
    .query<{ date: string }, [string]>("SELECT date FROM day_plans WHERE date < ? AND wrapped_up_at IS NULL ORDER BY date DESC")
    .all(today)
    .map((row) => row.date);
  const [latest, ...older] = open;
  if (older.length) {
    const skip = ctx.db.query("UPDATE day_plans SET wrapped_up_at = ? WHERE date = ?");
    for (const date of older) skip.run(isoNow(ctx), date);
  }
  return latest;
}

export async function wrapUpDay(deps: EveningDeps, date: string, answers: Answer[]): Promise<WrapUpResult> {
  const { ctx } = deps;
  const view = eveningView(ctx, date);
  if (!view.hasPlan) fail(409, "There is no plan for that day");
  if (view.wrappedUpAt) fail(409, "That day is already wrapped up");
  const byTask = new Map(answers.map((answer) => [answer.taskId, answer]));
  for (const answer of answers) {
    if (!postponeReasons.includes(answer.reason)) fail(400, "Invalid reason");
  }
  const undone = view.items.filter((item) => !item.doneToday && item.task.status === "open");
  const now = isoNow(ctx);
  const postponedIds: string[] = [];
  let dropped = 0;
  ctx.db.transaction(() => {
    const record = ctx.db.query(
      "INSERT INTO postponements (id, task_id, date, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const item of undone) {
      const answer = byTask.get(item.task.id) ?? { taskId: item.task.id, reason: "other" as const };
      const note = answer.note?.trim().slice(0, 500) || undefined;
      record.run(ctx.newId(), item.task.id, date, answer.reason, note ?? null, now);
      if (answer.reason === "not_relevant") {
        dropTask(ctx, item.task.id);
        dropped++;
        continue;
      }
      ctx.db
        .query("UPDATE tasks SET postpone_count = postpone_count + 1, first_on = CASE WHEN first_on <= ? THEN NULL ELSE first_on END WHERE id = ?")
        .run(date, item.task.id);
      postponedIds.push(item.task.id);
    }
    ctx.db.query("UPDATE day_plans SET wrapped_up_at = ? WHERE date = ?").run(now, date);
  })();
  const suggestions = await suggestForPostponed(deps, postponedIds, date);
  const learning = await maybeLearn(deps, date);
  return { suggestions, learning, dropped, postponed: postponedIds.length };
}

async function maybeLearn(deps: EveningDeps, date: string): Promise<Learning | undefined> {
  if (!deps.findLearning) return undefined;
  const { ctx } = deps;
  const since = addDays(date, -LEARNING_WINDOW_DAYS);
  const rows = ctx.db
    .query<{ task_id: string; date: string; reason: string; note: string | null }, [string, string]>(
      "SELECT task_id, date, reason, note FROM postponements WHERE date > ? AND date <= ? ORDER BY date",
    )
    .all(since, date);
  if (rows.length < 3) return undefined;
  const themes = listThemes(ctx, { includeArchived: true });
  try {
    const raw = (await deps.findLearning({
      today: date,
      learnings: learningTexts(ctx),
      postponements: rows.map((row) => {
        const task = getTask(ctx, row.task_id);
        return {
          date: row.date,
          title: task?.title ?? "",
          theme: themes.find((t) => t.id === task?.themeId)?.name,
          size: task?.size,
          reason: row.reason,
          note: row.note ?? undefined,
        };
      }),
    })) as { learning?: unknown };
    const text = typeof raw?.learning === "string" ? raw.learning.trim() : "";
    return text ? addLearning(ctx, text, "evening") : undefined;
  } catch (error) {
    (deps.log ?? console.error)("Claude could not look for a learning", error);
    return undefined;
  }
}
