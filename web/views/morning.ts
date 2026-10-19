import { eveningApi, planApi, type TodayView } from "../api.ts";
import { meetingRows, calendarNotice } from "../components/calendar.ts";
import { taskList } from "../components/task-row.ts";
import { formatMinutes, h, mount, toast } from "../dom.ts";
import { store } from "../state.ts";
import { renderInbox } from "./inbox.ts";

type Energy = "high" | "normal" | "lower" | "sick";
const STEP_MINUTES = 30;

export async function renderMorning(root: HTMLElement, step: string | undefined): Promise<void> {
  if (step === "calendar") return renderCalendarStep(root);
  if (step === "budgets" || step === "replan") return renderBudgetStep(root, step === "replan");
  return renderInboxStep(root);
}

async function renderInboxStep(root: HTMLElement): Promise<void> {
  const pending = await eveningApi.pending();
  if (pending.date) {
    location.hash = `#/evening/${pending.date}?then=morning`;
    return;
  }
  if (store.inboxCount === 0) {
    location.hash = "#/morning/calendar";
    return;
  }
  const inbox = h("div");
  await renderInbox(inbox);
  mount(
    root,
    stepHeader(1, "Sort your inbox", "Unsorted items are not planned."),
    inbox,
    nav(h("a", { class: "btn", href: "#/morning/calendar" }, "Skip"), h("a", { class: "btn primary", href: "#/morning/calendar" }, "Next")),
  );
}

async function renderCalendarStep(root: HTMLElement): Promise<void> {
  const view = await planApi.today();
  mount(
    root,
    stepHeader(2, "Your day", "Meetings count against their theme's budget."),
    calendarNotice(view),
    h("h2", {}, "Calendar"),
    view.meetings.length ? h("div", { class: "card" }, meetingRows(view.meetings)) : h("div", { class: "card empty" }, "No meetings today."),
    view.training.length ? [h("h2", {}, "Training"), h("div", { class: "card panel" }, view.training.map((e) => h("div", {}, e.title)))] : undefined,
    h("h2", {}, "Due and overdue"),
    taskList(view.due, { showTheme: true, empty: "Nothing due today." }),
    nav(h("a", { class: "btn", href: "#/morning" }, "Back"), h("a", { class: "btn primary", href: "#/morning/budgets" }, "Next")),
  );
}

async function renderBudgetStep(root: HTMLElement, replan: boolean): Promise<void> {
  const view = await planApi.today();
  const draft = initialDraft(view, replan);
  const rows = h("div", { class: "card" });
  const energyRow = h("div");
  const note = h("textarea", { "aria-label": "Anything else about today", placeholder: "Anything else about today? (optional)" }, draft.note);
  const said = h("input", { type: "text", placeholder: budgetExample(store.themes), "aria-label": "Describe your budgets" });

  const renderRows = () =>
    mount(
      rows,
      store.themes.map((theme) => {
        const minutes = draft.budgets[theme.id] ?? 0;
        const meetings = view.meetings.filter((e) => e.themeId === theme.id && e.blocking).reduce((sum, e) => sum + e.minutes, 0);
        const change = (delta: number) => {
          draft.budgets[theme.id] = Math.max(0, minutes + delta);
          renderRows();
        };
        return h(
          "div",
          { class: "task budget-row", style: "cursor:default;align-items:center" },
          h("span", { class: "dot", style: `background:${theme.color}` }),
          h("div", { class: "body" }, theme.name, meetings ? h("div", { class: "meta" }, `${formatMinutes(meetings)} of meetings`) : undefined),
          h("button", { type: "button", class: "icon-btn", "aria-label": `Less time for ${theme.name}`, onclick: () => change(-STEP_MINUTES) }, "−"),
          h("span", { class: "budget-value" }, minutes ? formatMinutes(minutes) : "0"),
          h("button", { type: "button", class: "icon-btn", "aria-label": `More time for ${theme.name}`, onclick: () => change(STEP_MINUTES) }, "+"),
        );
      }),
    );

  const renderEnergy = () =>
    mount(
      energyRow,
      h(
        "div",
        { class: "segmented", role: "group", "aria-label": "Energy" },
        (["high", "normal", "lower"] as const).map((level) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": draft.energy === level ? "true" : "false",
              onclick: () => {
                draft.energy = level;
                renderEnergy();
              },
            },
            level.charAt(0).toUpperCase() + level.slice(1),
          ),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "link-btn",
          onclick: () => {
            draft.energy = draft.energy === "sick" ? "normal" : "sick";
            renderEnergy();
          },
        },
        draft.energy === "sick" ? "Sick today (only essentials). Tap to undo." : "Sick today",
      ),
    );

  const fillFromText = async () => {
    if (!said.value.trim()) return;
    try {
      const parsed = await planApi.parse(said.value);
      Object.assign(draft.budgets, parsed.budgets);
      if (parsed.energy) draft.energy = parsed.energy as Energy;
      if (parsed.note) note.value = [note.value, parsed.note].filter(Boolean).join("\n");
      renderRows();
      renderEnergy();
      toast("Filled in. Check and adjust.");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const submit = async (button: HTMLButtonElement) => {
    button.disabled = true;
    button.textContent = "Planning...";
    try {
      await planApi.make({ energy: draft.energy, energyNote: note.value, budgets: draft.budgets });
      location.hash = "#/today";
    } catch (error) {
      toast((error as Error).message, "error");
      button.disabled = false;
      button.textContent = replan ? "Re-plan" : "Make my plan";
    }
  };

  renderRows();
  renderEnergy();
  const makeButton = h("button", { type: "button", class: "btn primary" }, replan ? "Re-plan" : "Make my plan");
  makeButton.addEventListener("click", () => submit(makeButton));
  mount(
    root,
    replan ? stepHeader(undefined, "Re-plan", "Budgets now show what is left of today.") : stepHeader(3, "Time and energy", "No defaults. Every day starts blank."),
    h(
      "form",
      { class: "row", style: "flex-wrap:nowrap;margin-bottom:12px", onsubmit: (event: Event) => (event.preventDefault(), void fillFromText()) },
      said,
      h("button", { type: "submit", class: "btn" }, "Fill in"),
    ),
    rows,
    h("h2", {}, "Energy"),
    energyRow,
    h("h2", {}, "Notes"),
    note,
    nav(h("a", { class: "btn", href: replan ? "#/today" : "#/morning/calendar" }, "Back"), makeButton),
  );
}

function initialDraft(view: TodayView, replan: boolean): { budgets: Record<string, number>; energy: Energy; note: string } {
  if (!replan || !view.plan) return { budgets: {}, energy: "normal", note: "" };
  const budgets: Record<string, number> = {};
  for (const theme of view.plan.themes) {
    const done = theme.items.filter((item) => item.doneToday).reduce((sum, item) => sum + item.minutes, 0);
    budgets[theme.themeId] = Math.max(0, theme.budget - done);
  }
  return { budgets, energy: view.plan.energy, note: view.plan.energyNote ?? "" };
}

function stepHeader(step: number | undefined, title: string, hint: string): HTMLElement {
  return h(
    "header",
    { class: "page", style: "display:block" },
    step ? h("div", { class: "muted", style: "font-size:13px" }, `Morning, step ${step} of 3`) : undefined,
    h("h1", {}, title),
    h("p", { class: "muted", style: "margin:4px 0 0" }, hint),
  );
}

function nav(...buttons: HTMLElement[]): HTMLElement {
  return h("div", { class: "row", style: "justify-content:space-between;margin-top:20px" }, buttons);
}

function budgetExample(themes: { name: string }[]): string {
  const [first, second] = themes.map((theme) => theme.name);
  const parts = [first && `3h ${first}`, second && `1h ${second}`, "feeling slow"].filter(Boolean);
  return `Or say it: ${parts.join(", ")}`;
}
