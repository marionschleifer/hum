import { tasksApi, type Task } from "../api.ts";
import { taskRow } from "../components/task-row.ts";
import { h, mount, toast } from "../dom.ts";
import { refresh, store } from "../state.ts";

export async function renderInbox(root: HTMLElement): Promise<void> {
  const tasks = (await tasksApi.list({ status: "inbox" })).filter((task) => !task.parentId);
  mount(
    root,
    h("header", { class: "page" }, h("h1", {}, "Inbox"), h("span", { class: "muted" }, `${tasks.length} to sort`)),
    tasks.length === 0
      ? h("div", { class: "card" }, h("div", { class: "empty" }, "All sorted. Unsorted items are never planned."))
      : h("div", { class: "card" }, tasks.map((task) => inboxRow(task))),
  );
}

function inboxRow(task: Task): HTMLElement {
  const state = { forToday: false };
  const buttons = h("div");
  const render = () => mount(buttons, sortButtons(task, state.forToday));
  render();
  return taskRow(task, {
    extra: buttons,
    onToday: () => {
      state.forToday = !state.forToday;
      render();
    },
  });
}

function sortButtons(task: Task, forToday: boolean): HTMLElement {
  return h(
    "div",
    { class: "sort-row", onclick: (event: Event) => event.stopPropagation() },
    forToday ? h("span", { class: "muted", style: "font-size:13px;align-self:center" }, "Today, in which theme?") : undefined,
    store.themes.map((theme) =>
      h(
        "button",
        {
          type: "button",
          class: "chip",
          onclick: async () => {
            try {
              if (forToday) await tasksApi.pickToday(task.id, true, theme.id);
              else await tasksApi.update(task.id, { themeId: theme.id });
              toast(forToday ? `Added to today in ${theme.name}` : `Moved to ${theme.name}`);
              await refresh();
            } catch (error) {
              toast((error as Error).message, "error");
            }
          },
        },
        h("span", { class: "dot", style: `background:${theme.color}` }),
        theme.name,
      ),
    ),
  );
}
