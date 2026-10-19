import { api, eveningApi, tasksApi, type Project } from "../api.ts";
import { taskList } from "../components/task-row.ts";
import { h, mount, toast, today } from "../dom.ts";
import { refresh, store, themeById } from "../state.ts";

export async function renderThemes(root: HTMLElement): Promise<void> {
  const open = await tasksApi.list({ status: "open" });
  mount(
    root,
    h("header", { class: "page" }, h("h1", {}, "Themes")),
    h(
      "div",
      { class: "card theme-list" },
      store.themes.map((theme) =>
        h(
          "a",
          { href: `#/theme/${theme.id}` },
          h("span", { class: "dot", style: `background:${theme.color}` }),
          theme.name,
          h("span", { class: "count" }, String(open.filter((t) => t.themeId === theme.id && !t.parentId).length)),
        ),
      ),
    ),
  );
}

export async function renderTheme(root: HTMLElement, themeId: string): Promise<void> {
  const theme = themeById(themeId);
  if (!theme) {
    mount(root, h("p", {}, "Theme not found."));
    return;
  }
  const [tasks, day] = await Promise.all([tasksApi.list({ status: "open", theme: themeId }), eveningApi.view(today())]);
  const plannedToday = new Set(day.items.map((item) => item.task.id));
  const projects = store.projects.filter((project) => project.themeId === themeId);
  const loose = tasks.filter((task) => !task.projectId);
  mount(
    root,
    h(
      "header",
      { class: "page" },
      h("h1", {}, h("span", { class: "dot", style: `background:${theme.color};width:14px;height:14px;margin-right:10px` }), theme.name),
      h("a", { href: "#/themes", class: "muted" }, "All themes"),
    ),
    addTaskForm(themeId),
    h("h2", {}, "Tasks"),
    taskList(loose, { empty: "No open tasks outside projects.", todayToggle: true, plannedToday }),
    projects.map((project) => [
      h("h2", {}, project.name),
      taskList(
        tasks.filter((task) => task.projectId === project.id),
        { empty: "No open tasks.", todayToggle: true, plannedToday },
      ),
    ]),
    h(
      "div",
      { style: "margin-top:24px" },
      h(
        "button",
        {
          class: "btn small",
          onclick: async () => {
            const name = prompt("Project name")?.trim();
            if (!name) return;
            await api<Project>("POST", "/api/projects", { themeId, name });
            await refresh();
          },
        },
        "New project",
      ),
    ),
  );
}

function addTaskForm(themeId: string): HTMLElement {
  const input = h("input", { type: "text", placeholder: "Add a task here, no AI", "aria-label": "New task in this theme" });
  return h(
    "form",
    {
      class: "row",
      style: "flex-wrap:nowrap",
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (!input.value.trim()) return;
        try {
          await tasksApi.create({ title: input.value, themeId });
          input.value = "";
          await refresh();
        } catch (error) {
          toast((error as Error).message, "error");
        }
      },
    },
    input,
    h("button", { type: "submit", class: "btn" }, "Add"),
  );
}
