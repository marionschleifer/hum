import type { CalendarEvent } from "../src/calendar/calendar.ts";
import type { CaptureResult } from "../src/capture/capture.ts";
import type { Answer, EveningItem, EveningView, WrapUpResult } from "../src/evening/evening.ts";
import type { Suggestion } from "../src/evening/suggestions.ts";
import type { Learning } from "../src/learnings/learnings.ts";
import type { DayPlanView, ThemePlanView, TodayView } from "../src/planning/dayplans.ts";
import type { Project } from "../src/projects/projects.ts";
import type { Task } from "../src/tasks/tasks.ts";
import type { Theme } from "../src/themes/themes.ts";
import type { TemplateEntry, TrainingSession, TrainingWeek } from "../src/training/training.ts";
import { today } from "./dom.ts";

export type { Answer, EveningItem, EveningView, Learning, Suggestion, TemplateEntry, TrainingSession, TrainingWeek, WrapUpResult };
export type TrainingTemplate = { template: TemplateEntry[]; tenK: TemplateEntry[] };
export type { CalendarEvent, DayPlanView, Project, Task, Theme, ThemePlanView, TodayView };
export type CaptureResponse = CaptureResult & { message: string };

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const response = await fetch(path, init);
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.status === 401 && !path.startsWith("/api/auth")) {
    window.dispatchEvent(new Event("hum:logged-out"));
  }
  if (!response.ok) throw new Error((data as { error?: string } | undefined)?.error ?? `Request failed (${response.status})`);
  return data as T;
}

export const tasksApi = {
  list: (params: Record<string, string>) =>
    api<Task[]>("GET", `/api/tasks?${new URLSearchParams({ today: today(), ...params })}`),
  get: (id: string) => api<Task & { subtasks: Task[] }>("GET", `/api/tasks/${id}?today=${today()}`),
  create: (input: Record<string, unknown>) => api<Task>("POST", "/api/tasks", input),
  update: (id: string, patch: Record<string, unknown>) => api<Task>("PATCH", `/api/tasks/${id}`, patch),
  complete: (id: string, on = today()) => api<Task>("POST", `/api/tasks/${id}/complete`, { today: on }),
  reopen: (id: string, on = today()) => api<Task>("POST", `/api/tasks/${id}/reopen`, { today: on }),
  drop: (id: string) => api<Task>("POST", `/api/tasks/${id}/drop`),
  restore: (id: string) => api<Task>("POST", `/api/tasks/${id}/restore`),
  pickToday: (id: string, pick: boolean, themeId?: string) =>
    api<Task>("POST", `/api/tasks/${id}/today`, { today: today(), pick, themeId }),
  tomorrow: (id: string) => api<{ task: Task; noBuffer: boolean }>("POST", `/api/tasks/${id}/tomorrow`, { today: today() }),
  firstStep: (id: string, title: string) => api<Task>("POST", `/api/tasks/${id}/first-step`, { today: today(), title }),
  giveTime: (id: string, minutes: number, from?: string) =>
    api<Task>("POST", `/api/tasks/${id}/give-time`, { today: today(), minutes, from }),
  moveDeadline: (id: string, deadline: string) => api<Task>("POST", `/api/tasks/${id}/move-deadline`, { today: today(), deadline }),
  letGo: (id: string) => api<Task>("POST", `/api/tasks/${id}/let-go`, { today: today() }),
  moveAtRisk: (moves: { taskId: string; day: string }[]) => api<Task[]>("POST", "/api/at-risk/move", { today: today(), moves }),
};


export const planApi = {
  today: () =>
    api<TodayView>(
      "GET",
      `/api/today?${new URLSearchParams({ today: today(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
    ),
  make: (input: { energy: string; energyNote?: string; budgets: Record<string, number> }) =>
    api<TodayView>("POST", "/api/plan", {
      ...input,
      today: today(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  parse: (text: string) =>
    api<{ budgets: Record<string, number>; energy?: string; note?: string }>("POST", "/api/plan/parse", { text }),
  tagTitle: (title: string, themeId: string) => api("POST", "/api/calendar/rules", { title, themeId }),
  hideEvent: (event: Pick<CalendarEvent, "id" | "title" | "start">) =>
    api("POST", "/api/calendar/hidden", { id: event.id, title: event.title, start: event.start }),
  hiddenEvents: () => api<{ id: string; title: string; start: string }[]>("GET", "/api/calendar/hidden"),
  unhideEvent: (id: string) => api("DELETE", `/api/calendar/hidden/${encodeURIComponent(id)}`),
};


export const eveningApi = {
  view: (date: string) => api<EveningView>("GET", `/api/evening?date=${date}`),
  pending: () => api<{ date?: string }>("GET", `/api/evening/pending?today=${today()}`),
  wrapUp: (date: string, answers: Answer[]) => api<WrapUpResult>("POST", "/api/evening", { date, answers }),
  suggestions: () => api<Suggestion[]>("GET", "/api/suggestions"),
  apply: (id: string) => api<Task>("POST", `/api/suggestions/${id}/apply`, { today: today() }),
  dismiss: (id: string) => api("POST", `/api/suggestions/${id}/dismiss`),
  learnings: () => api<Learning[]>("GET", "/api/learnings"),
  addLearning: (text: string) => api<Learning>("POST", "/api/learnings", { text }),
  updateLearning: (id: string, text: string) => api<Learning>("PATCH", `/api/learnings/${id}`, { text }),
  deleteLearning: (id: string) => api("DELETE", `/api/learnings/${id}`),
  transcribe: (audio: Blob) => {
    const form = new FormData();
    form.append("audio", audio, "voice");
    return api<{ text: string }>("POST", "/api/transcribe", form);
  },
};

export const trainingApi = {
  week: (date: string) => api<TrainingWeek>("GET", `/api/training/week?date=${date}&today=${today()}`),
  move: (id: string, date: string) => api<TrainingWeek>("POST", `/api/training/sessions/${id}/move`, { date, today: today() }),
  update: (id: string, patch: { status?: TrainingSession["status"]; travel?: boolean; note?: string }) =>
    api<TrainingSession>("PATCH", `/api/training/sessions/${id}`, patch),
  template: () => api<TrainingTemplate>("GET", "/api/training/template"),
  saveTemplate: (template: TemplateEntry[]) => api<TrainingTemplate>("PUT", "/api/training/template", { template }),
};
