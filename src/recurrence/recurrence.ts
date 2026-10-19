import { fail } from "../context.ts";

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof weekdays)[number];

export type Recurrence =
  | { kind: "count"; times: number; per: "week" | "month" }
  | { kind: "weekdays"; days: Weekday[] }
  | { kind: "every"; interval: number; unit: "day" | "week" | "month" }
  | { kind: "monthly"; day: number }
  | { kind: "monthly"; workday: number }
  | { kind: "unparsed"; text: string };

export type PeriodProgress = { done: number; target: number; periodStart: string };

export function parseRecurrence(value: unknown): Recurrence {
  const r = (value ?? {}) as Record<string, unknown>;
  switch (r.kind) {
    case "count":
      if (!isPositiveInt(r.times) || (r.per !== "week" && r.per !== "month")) break;
      return { kind: "count", times: r.times, per: r.per };
    case "weekdays": {
      const days = Array.isArray(r.days) ? r.days : [];
      if (days.length === 0 || !days.every((d) => weekdays.includes(d))) break;
      return { kind: "weekdays", days: weekdays.filter((d) => days.includes(d)) };
    }
    case "every":
      if (!isPositiveInt(r.interval) || !["day", "week", "month"].includes(String(r.unit))) break;
      return { kind: "every", interval: r.interval, unit: r.unit as "day" | "week" | "month" };
    case "monthly":
      if (r.day !== undefined && r.workday === undefined && validMonthPosition(r.day, 31)) return { kind: "monthly", day: r.day };
      if (r.workday !== undefined && r.day === undefined && validMonthPosition(r.workday, 5)) return { kind: "monthly", workday: r.workday };
      break;
    case "unparsed":
      if (typeof r.text !== "string" || r.text.trim() === "") break;
      return { kind: "unparsed", text: r.text.trim() };
  }
  return fail(400, "Invalid recurrence");
}

export function describeRecurrence(recurrence: Recurrence): string {
  switch (recurrence.kind) {
    case "count":
      return `${timesWord(recurrence.times)} a ${recurrence.per}`;
    case "weekdays":
      return `Every ${recurrence.days.map(capitalize).join(", ")}`;
    case "every":
      return recurrence.interval === 1
        ? `Every ${recurrence.unit}`
        : `Every ${recurrence.interval} ${recurrence.unit}s`;
    case "monthly":
      return describeMonthly(recurrence);
    case "unparsed":
      return `Unclear: "${recurrence.text}"`;
  }
}

export function monthlyOccurrence(recurrence: Extract<Recurrence, { kind: "monthly" }>, year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if ("day" in recurrence) return isoDay(year, month, recurrence.day === -1 ? last : Math.min(recurrence.day, last));
  const workdays = Array.from({ length: last }, (_, i) => i + 1).filter((d) => {
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  });
  const day = recurrence.workday === -1 ? workdays.at(-1)! : workdays[Math.min(recurrence.workday, workdays.length) - 1]!;
  return isoDay(year, month, day);
}

export function currentMonthlyOccurrence(recurrence: Extract<Recurrence, { kind: "monthly" }>, today: string): string {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const thisMonth = monthlyOccurrence(recurrence, year, month);
  if (thisMonth <= today) return thisMonth;
  return month === 1 ? monthlyOccurrence(recurrence, year - 1, 12) : monthlyOccurrence(recurrence, year, month - 1);
}

export function nextMonthlyOccurrence(recurrence: Extract<Recurrence, { kind: "monthly" }>, after: string): string {
  const [year, month] = after.split("-").map(Number) as [number, number];
  const thisMonth = monthlyOccurrence(recurrence, year, month);
  if (thisMonth > after) return thisMonth;
  return month === 12 ? monthlyOccurrence(recurrence, year + 1, 1) : monthlyOccurrence(recurrence, year, month + 1);
}

export function periodProgress(
  recurrence: Recurrence,
  completedOn: string[],
  today: string,
): PeriodProgress | undefined {
  if (recurrence.kind !== "count") return undefined;
  const periodStart = recurrence.per === "week" ? startOfWeek(today) : `${today.slice(0, 7)}-01`;
  const done = completedOn.filter((day) => day >= periodStart && day <= today).length;
  return { done, target: recurrence.times, periodStart };
}

export function startOfWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function describeMonthly(recurrence: Extract<Recurrence, { kind: "monthly" }>): string {
  if ("day" in recurrence) return recurrence.day === -1 ? "Last day of the month" : `Every ${ordinal(recurrence.day)} of the month`;
  const position = recurrence.workday === -1 ? "Last" : capitalize(ORDINAL_WORDS[recurrence.workday - 1]!);
  return `${position} working day of the month`;
}

const ORDINAL_WORDS = ["first", "second", "third", "fourth", "fifth"];

function ordinal(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

function validMonthPosition(value: unknown, max: number): value is number {
  return value === -1 || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max);
}

function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timesWord(times: number): string {
  if (times === 1) return "Once";
  if (times === 2) return "Twice";
  return `${times} times`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}
