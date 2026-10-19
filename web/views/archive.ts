import { tasksApi } from "../api.ts";
import { taskList } from "../components/task-row.ts";
import { h, mount } from "../dom.ts";

export async function renderArchive(root: HTMLElement): Promise<void> {
  const dropped = await tasksApi.list({ status: "dropped" });
  mount(
    root,
    h("header", { class: "page" }, h("h1", {}, "Archive"), h("a", { href: "#/settings", class: "muted" }, "Settings")),
    h("p", { class: "muted" }, "Dropped tasks live here. Nothing is ever deleted. Open one to restore it."),
    taskList(dropped, { showTheme: true, empty: "Nothing dropped yet." }),
  );
}
