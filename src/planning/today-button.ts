import type { Task } from "../tasks/tasks.ts";

export function showsTodayButton(task: Pick<Task, "id" | "firstOn" | "deadline">, today: string, plannedToday: ReadonlySet<string>): boolean {
  if (task.firstOn === today) return true;
  return !plannedToday.has(task.id) && !isDue(task, today);
}

function isDue(task: Pick<Task, "deadline">, today: string): boolean {
  return task.deadline !== undefined && task.deadline <= today;
}
