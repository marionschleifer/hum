import type { CalendarEvent } from "../calendar/calendar.ts";
import { sessionMinutes, type TrainingSession } from "../training/training.ts";

const LEARNING_THEME_ID = "learning";
const EXERCISE_THEME_ID = "exercise";
const LEARNING_MINUTES = 60;

export function defaultBudgets(input: { themeIds: string[]; meetings: CalendarEvent[]; training: TrainingSession[] }): Record<string, number> {
  const budgets: Record<string, number> = {};
  const add = (themeId: string, minutes: number) => {
    if (minutes > 0 && input.themeIds.includes(themeId)) budgets[themeId] = (budgets[themeId] ?? 0) + minutes;
  };
  for (const meeting of input.meetings) if (meeting.blocking && meeting.themeId) add(meeting.themeId, meeting.minutes);
  add(EXERCISE_THEME_ID, input.training.reduce((sum, session) => sum + sessionMinutes(session), 0));
  add(LEARNING_THEME_ID, LEARNING_MINUTES);
  return budgets;
}
