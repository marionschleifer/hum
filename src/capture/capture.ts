import type { StructureCapture, Transcribe } from "../ai/types.ts";
import { fail, isoNow, type Ctx } from "../context.ts";
import { listProjects } from "../projects/projects.ts";
import { listThemes } from "../themes/themes.ts";
import { createTask, type Task, type TaskSource } from "../tasks/tasks.ts";
import { fallbackTask, planTasks, type PlannedTask } from "./rules.ts";

export type CaptureDeps = { ctx: Ctx; structure?: StructureCapture; transcribe?: Transcribe };
export type CaptureRequest = { source: TaskSource; today: string };
export type CaptureResult = { captureId: string; transcript: string; tasks: Task[]; usedFallback: boolean };

export async function captureText(deps: CaptureDeps, text: string, request: CaptureRequest): Promise<CaptureResult> {
  const note = text.trim();
  if (!note) fail(400, "Nothing to capture");
  const { ctx } = deps;
  const themes = listThemes(ctx);
  const projects = listProjects(ctx);
  const structured = await structureSafely(deps, note, request.today);
  const planned = planTasks(structured.output, note, themes, projects);
  const usedFallback = planned.length === 0;
  const captureId = ctx.newId();
  const tasks = ctx.db.transaction(() => {
    ctx.db
      .query("INSERT INTO captures (id, source, raw_text, ai_output, error, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        captureId,
        request.source,
        note,
        structured.output === undefined ? null : JSON.stringify(structured.output),
        structured.error ?? null,
        isoNow(ctx),
      );
    return (usedFallback ? [fallbackTask(note)] : planned).map((task) => saveTask(ctx, task, request.source));
  })();
  return { captureId, transcript: note, tasks, usedFallback };
}

export async function captureAudio(deps: CaptureDeps, audio: Blob, request: CaptureRequest): Promise<CaptureResult> {
  if (!deps.transcribe) fail(503, "Voice capture needs OPENAI_API_KEY");
  if (audio.size === 0) fail(400, "The recording is empty");
  const transcript = await deps.transcribe(audio);
  if (!transcript) fail(422, "Could not hear anything in the recording");
  return captureText(deps, transcript, request);
}

export function describeCapture(result: CaptureResult, themeName: (id: string) => string | undefined): string {
  const topLevel = result.tasks.filter((task) => !task.parentId);
  const counts = new Map<string, number>();
  for (const task of topLevel) {
    const place = task.status === "inbox" ? "the inbox" : (themeName(task.themeId!) ?? "a theme");
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  const places = [...counts.entries()].map(([place, n]) => `${n} to ${place}`).join(", ");
  return `Added ${topLevel.length} ${topLevel.length === 1 ? "task" : "tasks"}: ${places}.`;
}

async function structureSafely(
  deps: CaptureDeps,
  note: string,
  today: string,
): Promise<{ output?: unknown; error?: string }> {
  if (!deps.structure) return { error: "ANTHROPIC_API_KEY is not set" };
  const themes = listThemes(deps.ctx);
  const themeNames = new Map(themes.map((theme) => [theme.id, theme.name]));
  try {
    const output = await deps.structure(note, {
      today,
      weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      themes: themes.map((theme) => ({ name: theme.name, isAccounto: theme.isAccounto })),
      projects: listProjects(deps.ctx).map((project) => ({ name: project.name, theme: themeNames.get(project.themeId) ?? "" })),
    });
    return { output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function saveTask(ctx: Ctx, planned: PlannedTask, source: TaskSource): Task {
  const { subtasks, ...input } = planned;
  const task = createTask(ctx, { ...input, source });
  for (const title of subtasks) createTask(ctx, { title, parentId: task.id, source });
  return task;
}
