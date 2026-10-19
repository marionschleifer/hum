import { addDays, daysBetween } from "../calendar/time.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import { flag, text, type Row } from "../db/rows.ts";
import { startOfWeek } from "../recurrence/recurrence.ts";
import { checkDate } from "../tasks/tasks.ts";

export const sessionKinds = ["strength", "intervals", "easy", "tempo", "long", "rest"] as const;
export type SessionKind = (typeof sessionKinds)[number];
export const sessionStatuses = ["planned", "done", "skipped", "sick"] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export type TrainingSession = {
  id: string;
  date: string;
  kind: SessionKind;
  title: string;
  minMinutes?: number;
  maxMinutes?: number;
  status: SessionStatus;
  travel: boolean;
  note?: string;
};

export type TrainingWarning = { message: string; skipSessionId?: string };

export type TrainingWeek = { monday: string; sessions: TrainingSession[]; warnings: TrainingWarning[] };

export type TemplateEntry = { day: number; kind: SessionKind; minMinutes?: number; maxMinutes?: number };

export const TEN_K_WEEK: TemplateEntry[] = [
  { day: 0, kind: "strength", minMinutes: 60 },
  { day: 1, kind: "intervals" },
  { day: 2, kind: "easy", minMinutes: 40, maxMinutes: 50 },
  { day: 3, kind: "strength", minMinutes: 60 },
  { day: 4, kind: "tempo", minMinutes: 30, maxMinutes: 30 },
  { day: 5, kind: "rest" },
  { day: 6, kind: "long", minMinutes: 75, maxMinutes: 100 },
];

const TITLES: Record<SessionKind, string> = {
  strength: "Strength",
  intervals: "Intervals",
  easy: "Easy run",
  tempo: "Tempo run",
  long: "Long run",
  rest: "Rest",
};

const TEMPLATE_KEY = "training_template";
const DEFAULT_MINUTES = 60;
const HARD_KINDS: SessionKind[] = ["intervals", "tempo"];
const DROP_ORDER: SessionKind[] = ["easy", "strength"];

export function trainingWeek(ctx: Ctx, anyDay: string, today: string): TrainingWeek {
  const monday = startOfWeek(checkDate(anyDay));
  ensureWeek(ctx, monday);
  const sessions = weekSessions(ctx, monday);
  return { monday, sessions, warnings: weekWarnings(sessions, today) };
}

export function trainingTemplate(ctx: Ctx): TemplateEntry[] {
  const row = ctx.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(TEMPLATE_KEY);
  return row ? (JSON.parse(row.value) as TemplateEntry[]) : [];
}

export function setTrainingTemplate(ctx: Ctx, entries: TemplateEntry[]): TemplateEntry[] {
  const template = entries.map(checkEntry).sort((a, b) => a.day - b.day);
  if (new Set(template.map((entry) => entry.day)).size !== template.length) fail(400, "Only one session per day");
  ctx.db
    .query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(TEMPLATE_KEY, JSON.stringify(template));
  return template;
}

export function sessionsOn(ctx: Ctx, date: string): TrainingSession[] {
  ensureWeek(ctx, startOfWeek(checkDate(date)));
  return ctx.db
    .query<Row, [string]>("SELECT * FROM training_sessions WHERE date = ? ORDER BY created_at")
    .all(date)
    .map(toSession);
}

export function moveSession(ctx: Ctx, id: string, date: string): TrainingSession[] {
  const session = getSession(ctx, id);
  checkDate(date);
  const monday = startOfWeek(session.date);
  if (startOfWeek(date) !== monday) fail(400, "Sessions can only move within their week");
  if (date === session.date) return weekSessions(ctx, monday);
  const now = isoNow(ctx);
  ctx.db.transaction(() => {
    ctx.db
      .query("UPDATE training_sessions SET date = ?, updated_at = ? WHERE date = ? AND id != ? AND status = 'planned'")
      .run(session.date, now, date, id);
    ctx.db.query("UPDATE training_sessions SET date = ?, updated_at = ? WHERE id = ?").run(date, now, id);
  })();
  return weekSessions(ctx, monday);
}

export function updateSession(
  ctx: Ctx,
  id: string,
  patch: { status?: SessionStatus; travel?: boolean; note?: string },
): TrainingSession {
  const session = getSession(ctx, id);
  if (patch.status !== undefined && !sessionStatuses.includes(patch.status)) fail(400, "Invalid status");
  const now = isoNow(ctx);
  ctx.db.transaction(() => {
    ctx.db
      .query("UPDATE training_sessions SET status = ?, travel = ?, note = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? session.status,
        (patch.travel ?? session.travel) ? 1 : 0,
        (patch.note === undefined ? session.note : patch.note.trim() || undefined) ?? null,
        now,
        id,
      );
    if (patch.status === "sick") {
      ctx.db
        .query("UPDATE training_sessions SET status = 'sick', updated_at = ? WHERE date = ? AND status = 'planned'")
        .run(now, session.date);
    }
  })();
  return getSession(ctx, id);
}

export function sessionMinutes(session: TrainingSession): number {
  if (session.kind === "rest" || session.status === "skipped" || session.status === "sick") return 0;
  return session.minMinutes ?? DEFAULT_MINUTES;
}

export function weekWarnings(sessions: TrainingSession[], today: string): TrainingWarning[] {
  if (sessions.length === 0) return [];
  const active = sessions.filter((s) => s.kind !== "rest" && s.status !== "skipped" && s.status !== "sick");
  const warnings: TrainingWarning[] = [];
  const dayOf = (kind: SessionKind) => active.filter((s) => s.kind === kind).map((s) => s.date);
  const hard = active.filter((s) => HARD_KINDS.includes(s.kind)).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < hard.length; i++) {
    if (daysBetween(hard[i - 1]!.date, hard[i]!.date) < 2) {
      warnings.push({ message: `${hard[i - 1]!.title} and ${hard[i]!.title} are less than 48 hours apart.` });
    }
  }
  for (const long of dayOf("long")) {
    for (const session of hard.filter((s) => s.date === addDays(long, 1))) {
      warnings.push({ message: `${session.title} is the day after the long run.` });
    }
  }
  const longs = dayOf("long").sort();
  for (let i = 1; i < longs.length; i++) {
    if (daysBetween(longs[i - 1]!, longs[i]!) === 1) warnings.push({ message: "Two long runs on consecutive days." });
  }
  const monday = sessions[0] ? startOfWeek(sessions[0].date) : startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  if (!days.some((day) => !active.some((s) => s.date === day))) warnings.push({ message: "This week has no full rest day." });
  const fit = fitWarning(sessions, active, days, today);
  if (fit) warnings.push(fit);
  return warnings;
}

function checkEntry(entry: TemplateEntry): TemplateEntry {
  if (!Number.isInteger(entry.day) || entry.day < 0 || entry.day > 6) fail(400, "Invalid day");
  if (!sessionKinds.includes(entry.kind)) fail(400, "Invalid session");
  if (entry.kind === "rest") return { day: entry.day, kind: entry.kind };
  const { minMinutes, maxMinutes } = entry;
  const valid = (minutes: number | undefined) => minutes === undefined || (Number.isInteger(minutes) && minutes > 0);
  if (!valid(minMinutes) || !valid(maxMinutes)) fail(400, "Invalid minutes");
  if (minMinutes !== undefined && maxMinutes !== undefined && maxMinutes < minMinutes) fail(400, "Invalid minutes");
  return {
    day: entry.day,
    kind: entry.kind,
    ...(minMinutes === undefined ? {} : { minMinutes }),
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
  };
}

function fitWarning(sessions: TrainingSession[], active: TrainingSession[], days: string[], today: string): TrainingWarning | undefined {
  const remainingDays = days.filter((day) => day >= today);
  const sickDays = new Set(sessions.filter((s) => s.status === "sick").map((s) => s.date));
  const freeDays = remainingDays.filter((day) => !sickDays.has(day)).length;
  const restTaken = days.some((day) => day < today && !active.some((s) => s.date === day) && !sickDays.has(day));
  const remaining = active.filter((s) => s.date >= today && s.status === "planned");
  const needed = remaining.length + (restTaken ? 0 : 1);
  if (needed <= freeDays || remainingDays.length === 0) return undefined;
  const drop = DROP_ORDER.flatMap((kind) => remaining.filter((s) => s.kind === kind))[0];
  if (!drop) return { message: "This week has more sessions left than free days. Pick what to skip." };
  return {
    message: `This week has more sessions left than free days. Skip the ${drop.title.toLowerCase()} first.`,
    skipSessionId: drop.id,
  };
}

function ensureWeek(ctx: Ctx, monday: string): void {
  const exists = ctx.db.query("SELECT 1 FROM training_sessions WHERE week_start = ? LIMIT 1").get(monday);
  if (exists) return;
  const now = isoNow(ctx);
  const insert = ctx.db.query(
    `INSERT INTO training_sessions (id, week_start, date, kind, min_minutes, max_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ctx.db.transaction(() => {
    for (const entry of trainingTemplate(ctx)) {
      insert.run(ctx.newId(), monday, addDays(monday, entry.day), entry.kind, entry.minMinutes ?? null, entry.maxMinutes ?? null, now, now);
    }
  })();
}

function weekSessions(ctx: Ctx, monday: string): TrainingSession[] {
  return ctx.db
    .query<Row, [string]>("SELECT * FROM training_sessions WHERE week_start = ? ORDER BY date, created_at")
    .all(monday)
    .map(toSession);
}

function getSession(ctx: Ctx, id: string): TrainingSession {
  const row = ctx.db.query<Row, [string]>("SELECT * FROM training_sessions WHERE id = ?").get(id);
  return row ? toSession(row) : fail(404, "Training session not found");
}

function toSession(row: Row): TrainingSession {
  const kind = row.kind as SessionKind;
  const travel = flag(row.travel);
  return {
    id: String(row.id),
    date: String(row.date),
    kind,
    title: kind === "strength" && travel ? "Bodyweight strength" : TITLES[kind],
    minMinutes: row.min_minutes === null ? undefined : Number(row.min_minutes),
    maxMinutes: row.max_minutes === null ? undefined : Number(row.max_minutes),
    status: row.status as SessionStatus,
    travel,
    note: text(row.note),
  };
}
