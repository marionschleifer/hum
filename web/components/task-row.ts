import { showsTodayButton } from "../../src/planning/today-button.ts";
import { describeRecurrence } from "../../src/recurrence/recurrence.ts";
import { tasksApi, type Task } from "../api.ts";
import { formatDay, h, toast, today } from "../dom.ts";
import { projectById, refresh, themeById } from "../state.ts";
import { openTaskSheet } from "./task-sheet.ts";

type RowOptions = {
  sub?: boolean;
  showTheme?: boolean;
  extra?: Node;
  done?: boolean;
  hideMeta?: boolean;
  on?: string;
  todayToggle?: boolean;
  plannedToday?: ReadonlySet<string>;
  onToday?: () => void;
};

export function taskList(tasks: Task[], options: { showTheme?: boolean; empty?: string; todayToggle?: boolean; plannedToday?: ReadonlySet<string> } = {}): HTMLElement {
  const topLevel = tasks.filter((task) => !task.parentId || !tasks.some((t) => t.id === task.parentId));
  if (topLevel.length === 0) return h("div", { class: "card" }, h("div", { class: "empty" }, options.empty ?? "Nothing here."));
  return h(
    "div",
    { class: "card" },
    topLevel.flatMap((task) => [
      taskRow(task, { showTheme: options.showTheme, todayToggle: options.todayToggle, plannedToday: options.plannedToday }),
      ...tasks.filter((t) => t.parentId === task.id).map((sub) => taskRow(sub, { sub: true })),
    ]),
  );
}

export function taskRow(task: Task, options: RowOptions = {}): HTMLElement {
  const finished = options.done ?? task.status === "done";
  const checkbox = h("input", {
    type: "checkbox",
    class: "check",
    checked: finished,
    "aria-label": finished ? `Reopen ${task.title}` : `Complete ${task.title}`,
    onclick: (event: Event) => event.stopPropagation(),
    onchange: async () => {
      try {
        const updated = finished ? await tasksApi.reopen(task.id, options.on) : await tasksApi.complete(task.id, options.on);
        if (updated.progress) toast(`${updated.title}: ${updated.progress.done} of ${updated.progress.target} done`);
        await refresh();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    },
  });
  return h(
    "div",
    {
      class: `task ${options.sub ? "sub" : ""} ${finished ? "done" : ""}`,
      onclick: () => openTaskSheet(task.id),
    },
    checkbox,
    h("div", { class: "body" }, h("div", { class: "title" }, task.title, repeatSign(task)), options.hideMeta ? undefined : meta(task, options), options.extra),
    (options.todayToggle || options.onToday) && !options.sub && !task.parentId && !finished && (!options.plannedToday || showsTodayButton(task, today(), options.plannedToday))
      ? todayButton(task, options.onToday)
      : undefined,
  );
}

export function todayButton(task: Task, onToday?: () => void): HTMLElement {
  const picked = task.firstOn === today();
  return h(
    "button",
    {
      type: "button",
      class: `today-btn ${picked ? "picked" : ""}`,
      "aria-pressed": picked ? "true" : "false",
      "aria-label": picked ? `Remove ${task.title} from today` : `Do ${task.title} today`,
      onclick: async (event: Event) => {
        event.stopPropagation();
        if (onToday && !picked) return onToday();
        try {
          await tasksApi.pickToday(task.id, !picked);
          toast(picked ? "Removed from today" : "Added to today");
          await refresh();
        } catch (error) {
          toast((error as Error).message, "error");
        }
      },
    },
    picked ? "Today ✓" : "Today",
  );
}

function repeatSign(task: Task): HTMLElement | undefined {
  if (!task.recurrence) return undefined;
  const label = `Repeats: ${describeRecurrence(task.recurrence)}`;
  return h("span", { class: "repeat-sign", title: label, "aria-label": label, role: "img" }, "↻");
}

function meta(task: Task, options: RowOptions): HTMLElement | undefined {
  const theme = themeById(task.themeId);
  const parts = [
    options.showTheme && theme ? h("span", { class: "chip" }, h("span", { class: "dot", style: `background:${theme.color}` }), theme.name) : undefined,
    options.showTheme && task.projectId ? h("span", {}, projectById(task.projectId)?.name ?? "") : undefined,
    task.essential ? h("span", { class: "chip" }, "Essential") : undefined,
    task.priority !== "normal" ? h("span", {}, task.priority === "high" ? "High priority" : "Low priority") : undefined,
    task.deadline ? h("span", {}, `Due ${formatDay(task.deadline)}`) : undefined,
    task.notBefore && task.notBefore > today() ? h("span", {}, `Snoozed until ${formatDay(task.notBefore)}`) : undefined,
    task.firstOn && task.firstOn > today() ? h("span", { class: "chip" }, firstLabel(task.firstOn)) : undefined,
    task.size ? h("span", {}, task.sizeConfirmed ? task.size : `${task.size}?`) : undefined,
    task.recurrence ? h("span", {}, describeRecurrence(task.recurrence)) : undefined,
    task.progress ? h("span", {}, `${task.progress.done}/${task.progress.target} this ${task.recurrence?.kind === "count" ? task.recurrence.per : "period"}`) : undefined,
  ].filter((part) => part !== undefined);
  return parts.length ? h("div", { class: "meta" }, parts) : undefined;
}

function firstLabel(day: string): string {
  const label = formatDay(day);
  return label === "Today" || label === "Tomorrow" ? `First thing ${label.toLowerCase()}` : `First thing on ${label}`;
}
