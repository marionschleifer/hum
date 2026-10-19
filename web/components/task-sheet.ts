import { weekdays, type Recurrence, type Weekday } from "../../src/recurrence/recurrence.ts";
import { api, tasksApi, type Project, type Task } from "../api.ts";
import { h, mount, toast } from "../dom.ts";
import { store } from "../state.ts";
import { openSheet } from "./sheet.ts";
import { taskRow } from "./task-row.ts";

type RecurrenceMode = "none" | "count" | "weekdays" | "monthday" | "monthworkday" | "keep";

export async function openTaskSheet(id: string): Promise<void> {
  const task = await tasksApi.get(id).catch((error: Error) => toast(error.message, "error"));
  if (!task) return;
  openSheet(task.title, (close) => taskForm(task, close));
}

function taskForm(task: Task & { subtasks: Task[] }, close: () => void): HTMLElement {
  const isSub = Boolean(task.parentId);
  const draft = {
    priority: task.priority,
    deadlineFixed: task.deadlineFixed ? "fixed" : "soft",
    stakes: task.stakes ?? "",
    size: task.size ?? "",
    sizeTouched: false,
    recurrenceMode: initialMode(task.recurrence),
    days: new Set<Weekday>(task.recurrence?.kind === "weekdays" ? task.recurrence.days : []),
  };

  const title = h("input", { type: "text", value: task.title, required: true, "aria-label": "Title" });
  const notes = h("textarea", { "aria-label": "Notes", placeholder: "Notes" }, task.notes ?? "");
  const theme = h(
    "select",
    { "aria-label": "Theme" },
    h("option", { value: "" }, "Inbox (no theme)"),
    store.themes.map((t) => h("option", { value: t.id, selected: t.id === task.themeId }, t.name)),
  );
  const project = h("select", { "aria-label": "Project" });
  const fillProjects = (selected?: string) =>
    mount(
      project,
      h("option", { value: "" }, "No project"),
      store.projects
        .filter((p) => p.themeId === theme.value)
        .map((p) => h("option", { value: p.id, selected: p.id === selected }, p.name)),
      theme.value ? h("option", { value: "__new" }, "New project...") : undefined,
    );
  fillProjects(task.projectId);
  theme.addEventListener("change", () => fillProjects());
  project.addEventListener("change", async () => {
    if (project.value !== "__new") return;
    const name = prompt("Project name")?.trim();
    if (!name) return fillProjects();
    const created = await api<Project>("POST", "/api/projects", { themeId: theme.value, name });
    store.projects.push(created);
    fillProjects(created.id);
  });

  const deadline = h("input", { type: "date", value: task.deadline ?? "", "aria-label": "Deadline" });
  const notBefore = h("input", { type: "date", value: task.notBefore ?? "", "aria-label": "Snooze until" });
  const essential = h("input", { type: "checkbox", checked: task.essential });
  const labels = h("input", { type: "text", value: task.labels.join(", "), placeholder: "comma, separated" });

  const times = h("input", {
    type: "number",
    min: 1,
    value: task.recurrence?.kind === "count" ? task.recurrence.times : 1,
    "aria-label": "Times",
    style: "width:80px",
  });
  const per = h(
    "select",
    { "aria-label": "Per", style: "width:auto" },
    h("option", { value: "week", selected: task.recurrence?.kind === "count" && task.recurrence.per === "week" }, "per week"),
    h("option", { value: "month", selected: task.recurrence?.kind === "count" && task.recurrence.per === "month" }, "per month"),
  );
  const monthDay = h(
    "select",
    { "aria-label": "Day of the month", style: "width:auto" },
    Array.from({ length: 31 }, (_, i) => i + 1).map((d) =>
      h("option", { value: d, selected: task.recurrence?.kind === "monthly" && "day" in task.recurrence && task.recurrence.day === d }, String(d)),
    ),
    h("option", { value: -1, selected: task.recurrence?.kind === "monthly" && "day" in task.recurrence && task.recurrence.day === -1 }, "Last day"),
  );
  const monthWorkday = h(
    "select",
    { "aria-label": "Which working day", style: "width:auto" },
    [
      [1, "First"],
      [2, "Second"],
      [3, "Third"],
      [4, "Fourth"],
      [-1, "Last"],
    ].map(([value, label]) =>
      h(
        "option",
        { value, selected: task.recurrence?.kind === "monthly" && "workday" in task.recurrence && task.recurrence.workday === value },
        String(label),
      ),
    ),
  );
  const recurrenceDetail = h("div");
  const renderRecurrence = () =>
    mount(
      recurrenceDetail,
      draft.recurrenceMode === "count" ? h("div", { class: "row" }, times, h("span", {}, "times"), per) : undefined,
      draft.recurrenceMode === "monthday" ? h("div", { class: "row" }, h("span", {}, "Every"), monthDay, h("span", {}, "of the month")) : undefined,
      draft.recurrenceMode === "monthworkday" ? h("div", { class: "row" }, monthWorkday, h("span", {}, "working day of the month")) : undefined,
      draft.recurrenceMode === "weekdays"
        ? h(
            "div",
            { class: "row" },
            weekdays.map((day) =>
              h(
                "button",
                {
                  type: "button",
                  class: "chip",
                  "aria-pressed": draft.days.has(day) ? "true" : "false",
                  style: draft.days.has(day) ? "background:var(--accent);color:var(--accent-text)" : undefined,
                  onclick: () => {
                    if (draft.days.has(day)) draft.days.delete(day);
                    else draft.days.add(day);
                    renderRecurrence();
                  },
                },
                day[0]!.toUpperCase() + day.slice(1),
              ),
            ),
          )
        : undefined,
      draft.recurrenceMode === "keep" && task.recurrence?.kind === "unparsed"
        ? h("p", { class: "muted" }, `Todoist said "${task.recurrence.text}". Pick a rule Hum understands.`)
        : undefined,
    );
  renderRecurrence();
  const recurrenceMode = h(
    "select",
    {
      "aria-label": "Repeats",
      onchange: (event: Event) => {
        draft.recurrenceMode = (event.target as HTMLSelectElement).value as RecurrenceMode;
        renderRecurrence();
      },
    },
    task.recurrence?.kind === "unparsed" || task.recurrence?.kind === "every"
      ? h("option", { value: "keep", selected: true }, "Keep as is")
      : undefined,
    h("option", { value: "none", selected: draft.recurrenceMode === "none" }, "Does not repeat"),
    h("option", { value: "count", selected: draft.recurrenceMode === "count" }, "N times, any day"),
    h("option", { value: "weekdays", selected: draft.recurrenceMode === "weekdays" }, "On fixed days"),
    h("option", { value: "monthday", selected: draft.recurrenceMode === "monthday" }, "Monthly on a date"),
    h("option", { value: "monthworkday", selected: draft.recurrenceMode === "monthworkday" }, "Monthly on a working day"),
  );

  const subtaskInput = h("input", { type: "text", placeholder: "Add a subtask", "aria-label": "New subtask" });
  const subtaskList = h("div", { class: "card" }, task.subtasks.map((sub) => taskRow(sub, { sub: false })));

  const save = async (event: Event) => {
    event.preventDefault();
    const patch: Record<string, unknown> = {
      title: title.value,
      notes: notes.value,
      priority: draft.priority,
      deadline: deadline.value,
      deadlineFixed: draft.deadlineFixed === "fixed",
      stakes: draft.stakes,
      notBefore: notBefore.value,
      essential: essential.checked,
      labels: labels.value.split(",").map((l) => l.trim()).filter(Boolean),
    };
    if (draft.sizeTouched) patch.size = draft.size;
    const recurrence = readRecurrence(draft.recurrenceMode, {
      times: Number(times.value),
      per: per.value,
      days: draft.days,
      monthDay: Number(monthDay.value),
      monthWorkday: Number(monthWorkday.value),
    });
    if (recurrence !== undefined) patch.recurrence = recurrence;
    if (!isSub) {
      patch.themeId = theme.value;
      patch.projectId = project.value === "__new" ? "" : project.value;
    }
    try {
      await tasksApi.update(task.id, patch);
      close();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  return h(
    "form",
    { onsubmit: save },
    field("Title", title),
    !isSub && field("Theme", theme),
    !isSub && field("Project", project),
    field("Priority", segmented(["high", "normal", "low"], () => draft.priority, (v) => (draft.priority = v as Task["priority"]))),
    field(
      task.size && !task.sizeConfirmed ? `Size (suggested ${task.size}, tap to confirm)` : "Size",
      segmented(["S", "M", "L", ""], () => draft.size, (v) => Object.assign(draft, { size: v, sizeTouched: true }), { "": "None" }),
    ),
    field("Deadline", deadline),
    field("Deadline type", segmented(["soft", "fixed"], () => draft.deadlineFixed, (v) => (draft.deadlineFixed = v))),
    field("Stakes", segmented(["high", "", "low"], () => draft.stakes, (v) => (draft.stakes = v as Task["stakes"] | ""), { "": "Normal" })),
    field("Snooze until (not planned before this day)", notBefore),
    h("label", { class: "row", style: "margin-bottom:14px;flex-wrap:nowrap" }, essential, h("span", {}, "Essential")),
    field("Repeats", h("div", { style: "display:grid;gap:8px" }, recurrenceMode, recurrenceDetail)),
    field("Notes", notes),
    field("Labels", labels),
    !isSub &&
      field(
        "Subtasks",
        h(
          "div",
          { style: "display:grid;gap:8px" },
          task.subtasks.length ? subtaskList : undefined,
          h(
            "div",
            { class: "row" },
            subtaskInput,
            h(
              "button",
              {
                type: "button",
                class: "btn small",
                onclick: async () => {
                  if (!subtaskInput.value.trim()) return;
                  const sub = await tasksApi.create({ title: subtaskInput.value, parentId: task.id });
                  subtaskInput.value = "";
                  subtaskList.append(taskRow(sub));
                  if (!subtaskList.isConnected) subtaskInput.parentElement!.before(subtaskList);
                },
              },
              "Add",
            ),
          ),
        ),
      ),
    h(
      "div",
      { class: "row", style: "justify-content:space-between;margin-top:8px" },
      task.status === "dropped"
        ? h("button", { type: "button", class: "btn", onclick: async () => (await tasksApi.restore(task.id), close()) }, "Restore")
        : h(
            "button",
            {
              type: "button",
              class: "btn danger",
              onclick: async () => {
                await tasksApi.drop(task.id);
                toast("Moved to the archive");
                close();
              },
            },
            "Drop",
          ),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "btn", onclick: () => close() }, "Cancel"),
        h("button", { type: "submit", class: "btn primary" }, "Save"),
      ),
    ),
  );
}

function field(label: string, control: Node): HTMLElement {
  return h("label", { class: "field" }, h("span", {}, label), control);
}

function segmented(
  values: string[],
  get: () => string,
  set: (value: string) => void,
  labels: Record<string, string> = {},
): HTMLElement {
  const container = h("div", { class: "segmented", role: "group" });
  const render = () =>
    mount(
      container,
      values.map((value) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": get() === value ? "true" : "false",
            onclick: () => {
              set(value);
              render();
            },
          },
          labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1),
        ),
      ),
    );
  render();
  return container;
}

function initialMode(recurrence: Recurrence | undefined): RecurrenceMode {
  if (!recurrence) return "none";
  if (recurrence.kind === "count" || recurrence.kind === "weekdays") return recurrence.kind;
  if (recurrence.kind === "monthly") return "day" in recurrence ? "monthday" : "monthworkday";
  return "keep";
}

type RecurrenceFields = { times: number; per: string; days: Set<Weekday>; monthDay: number; monthWorkday: number };

function readRecurrence(mode: RecurrenceMode, fields: RecurrenceFields): Recurrence | "" | undefined {
  switch (mode) {
    case "keep":
      return undefined;
    case "none":
      return "";
    case "count":
      return { kind: "count", times: Math.max(1, Math.round(fields.times) || 1), per: fields.per as "week" | "month" };
    case "monthday":
      return { kind: "monthly", day: fields.monthDay };
    case "monthworkday":
      return { kind: "monthly", workday: fields.monthWorkday };
    case "weekdays":
      return { kind: "weekdays", days: weekdays.filter((day) => fields.days.has(day)) };
  }
}
