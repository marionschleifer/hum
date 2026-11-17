import type { CalendarEvent } from "../calendar/calendar.ts";
import { sessionMinutes, type TrainingSession } from "../training/training.ts";

const LEARNING_THEME_ID = "learning";
const EXERCISE_THEME_ID = "exercise";
const LEARNING_MINUTES = 60;

type PlanInputs = { themeIds: string[]; meetings: CalendarEvent[]; training: TrainingSession[] };

export function defaultBudgets(input: PlanInputs): Record<string, number> {
  const budgets = plannedMinutes(input);
  if (input.themeIds.includes(LEARNING_THEME_ID)) budgets[LEARNING_THEME_ID] = (budgets[LEARNING_THEME_ID] ?? 0) + LEARNING_MINUTES;
  return budgets;
}

export function plannedMinutes(input: PlanInputs): Record<string, number> {
  const planned: Record<string, number> = {};
  const add = (themeId: string, minutes: number) => {
    if (minutes > 0 && input.themeIds.includes(themeId)) planned[themeId] = (planned[themeId] ?? 0) + minutes;
  };
  for (const meeting of input.meetings) if (meeting.blocking && meeting.themeId) add(meeting.themeId, meeting.minutes);
  add(EXERCISE_THEME_ID, input.training.reduce((sum, session) => sum + sessionMinutes(session), 0));
  return planned;
}

export function openWorkFor(input: {
  budgets: Record<string, number>;
  planned: Record<string, number>;
  chosen: Record<string, number>;
}): Record<string, number> {
  const open: Record<string, number> = {};
  for (const [themeId, budget] of Object.entries(input.budgets)) {
    const chosen = input.chosen[themeId];
    const minutes = chosen === undefined ? budget - (input.planned[themeId] ?? 0) : Math.min(budget, chosen);
    if (minutes > 0) open[themeId] = minutes;
  }
  return open;
}
