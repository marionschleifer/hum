import type { StructuredTask } from "../ai/types.ts";
import type { Project } from "../projects/projects.ts";
import { parseRecurrence, type Recurrence } from "../recurrence/recurrence.ts";
import { normalizeName, type Theme } from "../themes/themes.ts";
import { checkDate, priorities, sizes, type Priority, type Size, type TaskInput } from "../tasks/tasks.ts";

export type PlannedTask = Omit<TaskInput, "source"> & { subtasks: string[] };

export function planTasks(raw: unknown, note: string, themes: Theme[], projects: Project[]): PlannedTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const task = readStructuredTask(item);
    return task ? [planTask(task, note, themes, projects)] : [];
  });
}

export function planTask(task: StructuredTask, note: string, themes: Theme[], projects: Project[]): PlannedTask {
  const theme = task.confident && task.theme ? themes.find((t) => normalizeName(t.name) === normalizeName(task.theme!)) : undefined;
  const project =
    theme && task.project
      ? projects.find((p) => p.themeId === theme.id && normalizeName(p.name) === normalizeName(task.project!))
      : undefined;
  const unmatchedProject = task.project && !project ? `Project mentioned: ${task.project}` : undefined;
  return {
    title: task.title,
    notes: [task.notes, unmatchedProject].filter(Boolean).join("\n") || undefined,
    themeId: theme?.id,
    projectId: project?.id,
    essential: task.essential === true && mentionsEssential(note),
    priority: task.priority && task.priority !== "normal" && mentionsPriority(note) ? task.priority : "normal",
    size: task.size,
    sizeConfirmed: false,
    deadline: task.deadline && mentionsDate(note) ? task.deadline : undefined,
    recurrence: task.recurrence && allowedRecurrence(task.recurrence, note) ? task.recurrence : undefined,
    subtasks: task.subtasks,
  };
}

export function fallbackTask(note: string): PlannedTask {
  const clean = note.trim().replace(/\s+/g, " ");
  const title = clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
  return { title, notes: clean.length > 120 ? note.trim() : undefined, subtasks: [] };
}

function readStructuredTask(item: unknown): StructuredTask | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const value = item as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) return undefined;
  return {
    title,
    notes: optionalString(value.notes),
    theme: optionalString(value.theme),
    project: optionalString(value.project),
    confident: value.confident === true,
    size: sizes.includes(value.size as Size) ? (value.size as Size) : undefined,
    deadline: validDate(value.deadline),
    essential: value.essential === true,
    priority: priorities.includes(value.priority as Priority) ? (value.priority as Priority) : undefined,
    recurrence: validRecurrence(value.recurrence),
    subtasks: Array.isArray(value.subtasks)
      ? value.subtasks.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()).slice(0, 20)
      : [],
  };
}

function mentionsEssential(note: string): boolean {
  return /\bessential\b/i.test(note);
}

function mentionsPriority(note: string): boolean {
  return /\b(priority|prio|urgent|urgently|asap|important|not important|whenever)\b/i.test(note);
}

function mentionsDate(note: string): boolean {
  return /\d|\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekend|month|year|january|february|march|april|may|june|july|august|september|october|november|december|deadline|due|by|until|before|end of)\b/i.test(
    note,
  );
}

function allowedRecurrence(recurrence: Recurrence, note: string): boolean {
  if (recurrence.kind === "weekdays") {
    return /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?)\b/i.test(note);
  }
  if (recurrence.kind === "monthly") return /\b(month|monthly)\b/i.test(note);
  return recurrence.kind === "count";
}

function validRecurrence(value: unknown): Recurrence | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return parseRecurrence(value);
  } catch {
    return undefined;
  }
}

function validDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return checkDate(value);
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
