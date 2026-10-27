import { addDays } from "../calendar/time.ts";

export type DateGroup<T> = { label: string; tasks: T[] };

type Dated = { deadline?: string; parentId?: string };

const WEEK_DAYS = 7;

export function groupByDate<T extends Dated>(tasks: T[], today: string): DateGroup<T>[] {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, WEEK_DAYS);
  const groups: DateGroup<T>[] = [
    { label: "Overdue", tasks: [] },
    { label: "Today", tasks: [] },
    { label: "Tomorrow", tasks: [] },
    { label: "Next 7 days", tasks: [] },
    { label: "Later", tasks: [] },
    { label: "No deadline", tasks: [] },
  ];
  const sorted = tasks
    .filter((task) => !task.parentId)
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  for (const task of sorted) groups[groupIndex(task.deadline, today, tomorrow, weekEnd)]!.tasks.push(task);
  return groups.filter((group) => group.tasks.length > 0);
}

function groupIndex(deadline: string | undefined, today: string, tomorrow: string, weekEnd: string): number {
  if (deadline === undefined) return 5;
  if (deadline < today) return 0;
  if (deadline === today) return 1;
  if (deadline === tomorrow) return 2;
  if (deadline <= weekEnd) return 3;
  return 4;
}
