import { api } from "./api.ts";
import { quickAdd } from "./components/quick-add.ts";
import { h, mount, toast } from "./dom.ts";
import { loadReference, store } from "./state.ts";
import { renderArchive } from "./views/archive.ts";
import { renderEvening } from "./views/evening.ts";
import { renderInbox } from "./views/inbox.ts";
import { renderLogin } from "./views/login.ts";
import { renderMorning } from "./views/morning.ts";
import { renderSettings } from "./views/settings.ts";
import { renderTasks, renderTheme } from "./views/themes.ts";
import { renderToday } from "./views/today.ts";
import { renderWeek } from "./views/week.ts";

const root = document.getElementById("app")!;
const tabs = [
  { hash: "#/today", label: "Today" },
  { hash: "#/inbox", label: "Inbox" },
  { hash: "#/tasks", label: "Tasks" },
  { hash: "#/week", label: "Week" },
  { hash: "#/settings", label: "Settings" },
];

void boot();

async function boot(): Promise<void> {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  window.addEventListener("hum:logged-out", () => void boot());
  const status = await api<{ loggedIn: boolean; hasPasskey: boolean }>("GET", "/api/auth/status");
  if (!status.loggedIn) {
    renderLogin(root, status.hasPasskey, () => void boot());
    return;
  }
  await loadReference();
  const main = h("main", { class: "shell" });
  const nav = h("nav", { class: "tabs" });
  mount(root, main, h("div", { class: "dock" }, h("div", { class: "dock-inner" }, quickAdd(), nav)));
  store.rerender = async () => {
    renderTabs(nav);
    await renderRoute(main);
  };
  window.onhashchange = () => void store.rerender();
  if (!location.hash) location.hash = "#/today";
  await store.rerender();
}

async function renderRoute(main: HTMLElement): Promise<void> {
  const [, page, id] = location.hash.split("?")[0]!.split("/");
  try {
    if (page === "inbox") await renderInbox(main);
    else if (page === "tasks" || page === "themes") await renderTasks(main);
    else if (page === "theme" && id) await renderTheme(main, id);
    else if (page === "settings") await renderSettings(main);
    else if (page === "archive") await renderArchive(main);
    else if (page === "week") await renderWeek(main, id);
    else if (page === "morning") await renderMorning(main, id);
    else if (page === "evening") await renderEvening(main, id, location.hash.includes("then=morning"));
    else await renderToday(main);
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

function renderTabs(nav: HTMLElement): void {
  const hash = location.hash.split("?")[0]!;
  const current = hash.startsWith("#/theme") || hash.startsWith("#/tasks")
    ? "#/tasks"
    : hash.startsWith("#/archive")
      ? "#/settings"
      : hash.startsWith("#/week")
        ? "#/week"
        : hash.startsWith("#/morning") || hash.startsWith("#/evening")
          ? "#/today"
          : hash;
  mount(
    nav,
    tabs.map((tab) =>
      h(
        "a",
        { href: tab.hash, "aria-current": tab.hash === current ? "page" : undefined },
        tab.label,
        tab.hash === "#/inbox" && store.inboxCount > 0 ? h("span", { class: "badge" }, String(store.inboxCount)) : undefined,
      ),
    ),
  );
}
