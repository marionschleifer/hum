import { tasksApi, type TodayView } from "../api.ts";
import { formatDay, formatMinutes, h, mount, toast, today } from "../dom.ts";
import { refresh, themeById } from "../state.ts";
import { openSheet } from "./sheet.ts";

type Warning = TodayView["warnings"][number];
type SickMove = NonNullable<TodayView["sickMoves"]>[number];

export function atRiskBox(view: TodayView): HTMLElement | undefined {
  if (view.warnings.length === 0) return undefined;
  return h(
    "div",
    { class: "card panel warning at-risk" },
    h("strong", {}, "Deadlines at risk"),
    view.sickMoves
      ? h(
          "button",
          { type: "button", class: "btn primary small", onclick: () => openSickPreview(view.sickMoves!) },
          "Move everything at risk to when I'm better",
        )
      : undefined,
    view.warnings.map((warning) => atRiskItem(warning, view)),
  );
}

function atRiskItem(warning: Warning, view: TodayView): HTMLElement {
  const noBuffer = warning.deadline <= addDays(today(), 1);
  const sick = view.plan?.energy === "sick";
  return h(
    "div",
    { class: "at-risk-item" },
    h(
      "div",
      {},
      warning.stakes ? h("span", { class: `chip stakes-${warning.stakes}` }, warning.stakes === "high" ? "High stakes" : "Low stakes") : undefined,
      warning.stakes ? " " : undefined,
      h("strong", {}, warning.title),
      " ",
      warning.detail,
    ),
    h(
      "div",
      { class: "row", style: "flex-wrap:nowrap" },
      h(
        "button",
        {
          type: "button",
          class: "btn small",
          style: "flex-shrink:0",
          onclick: act(() => tasksApi.tomorrow(warning.taskId), noBuffer ? "Scheduled for tomorrow. No buffer left." : "Scheduled for tomorrow."),
        },
        "Schedule for tomorrow",
      ),
      h("span", { class: "muted small-note" }, [fitText(warning.fit), noBuffer ? "No buffer left: tomorrow is the deadline." : undefined].filter(Boolean).join(" ")),
    ),
    h(
      "div",
      { class: "row" },
      sick ? undefined : h("button", { type: "button", class: "btn small", onclick: () => openGiveTime(warning, view) }, "Give it time today"),
      h("button", { type: "button", class: "btn small", onclick: () => openFirstStep(warning) }, "Do a smaller version"),
      warning.deadlineFixed ? undefined : h("button", { type: "button", class: "btn small", onclick: () => openMoveDeadline(warning) }, "Move the deadline"),
      h("button", { type: "button", class: "btn small", onclick: () => openLetGo(warning) }, "Let it go"),
    ),
  );
}

function fitText(fit: Warning["fit"]): string {
  if (fit.usual === undefined) return `Needs about ${formatMinutes(fit.needed)}. No usual time for this theme yet.`;
  const free = `${formatMinutes(fit.free!)} free of the usual ${formatMinutes(fit.usual)}`;
  return fit.fits ? `Fits tomorrow: ${free}, needs ${formatMinutes(fit.needed)}.` : `Tight tomorrow: ${free}, needs ${formatMinutes(fit.needed)}.`;
}

function openGiveTime(warning: Warning, view: TodayView): void {
  const budgets = view.plan?.budgets ?? {};
  const draft = { minutes: 15 };
  openSheet("Give it time today", (close) => {
    const from = h("select", { "aria-label": "Take the time from" });
    const fillSources = () =>
      mount(
        from,
        h("option", { value: "" }, "Free time"),
        Object.entries(budgets)
          .filter(([themeId, minutes]) => themeId !== warning.themeId && minutes >= draft.minutes)
          .map(([themeId, minutes]) => h("option", { value: themeId }, `${themeById(themeId)?.name ?? themeId} (${formatMinutes(minutes)} today)`)),
      );
    const amounts = h("div", { class: "segmented", role: "group", "aria-label": "Minutes" });
    const renderAmounts = () =>
      mount(
        amounts,
        [15, 30].map((minutes) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": draft.minutes === minutes ? "true" : "false",
              onclick: () => {
                draft.minutes = minutes;
                renderAmounts();
                fillSources();
              },
            },
            `${minutes} min`,
          ),
        ),
      );
    renderAmounts();
    fillSources();
    const submit = async (event: Event) => {
      event.preventDefault();
      try {
        await tasksApi.giveTime(warning.taskId, draft.minutes, from.value || undefined);
        toast(`Added ${draft.minutes} minutes to ${themeById(warning.themeId)?.name ?? "this theme"} today.`);
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "form",
      { style: "display:grid;gap:16px", onsubmit: submit },
      sheetTitle("Give it time today"),
      h("p", { class: "muted", style: "margin:0" }, `Adds a slot to ${themeById(warning.themeId)?.name ?? "this theme"} and puts this task in today's plan.`),
      h("label", { class: "field" }, h("span", {}, "How long"), amounts),
      h("label", { class: "field" }, h("span", {}, "Take the time from"), from),
      buttons("Give it time", close),
    );
  });
}

function openMoveDeadline(warning: Warning): void {
  openSheet("Move the deadline", (close) => {
    const input = h("input", { type: "date", value: addDays(warning.deadline < today() ? today() : warning.deadline, 3), min: addDays(today(), 1), "aria-label": "New deadline" });
    const submit = async (event: Event) => {
      event.preventDefault();
      try {
        await tasksApi.moveDeadline(warning.taskId, input.value);
        toast(`Deadline moved to ${formatDay(input.value)}.`);
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "form",
      { style: "display:grid;gap:16px", onsubmit: submit },
      sheetTitle("Move the deadline"),
      h("p", { class: "muted", style: "margin:0" }, `Currently due ${formatDay(warning.deadline)}. Only for soft deadlines you set yourself.`),
      h("label", { class: "field" }, h("span", {}, "New deadline"), input),
      buttons("Move it", close),
    );
  });
}

function openLetGo(warning: Warning): void {
  openSheet("Let it go", (close) => {
    const submit = async (event: Event) => {
      event.preventDefault();
      try {
        await tasksApi.letGo(warning.taskId);
        toast("Let go. No more warnings for this deadline.");
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "form",
      { style: "display:grid;gap:16px", onsubmit: submit },
      sheetTitle("Let it go"),
      h("p", { style: "margin:0" }, h("strong", {}, warning.title), ` stays on your list, but Hum stops warning about the deadline on ${formatDay(warning.deadline)} and remembers that you skipped it on purpose.`),
      buttons("Let it go", close),
    );
  });
}

function buttons(label: string, close: () => void): HTMLElement {
  return h(
    "div",
    { class: "row" },
    h("button", { type: "submit", class: "btn primary" }, label),
    h("button", { type: "button", class: "btn", onclick: close }, "Cancel"),
  );
}

function openFirstStep(warning: Warning): void {
  openSheet("Do a smaller version", (close) => {
    const input = h("input", { type: "text", value: `First 15 minutes: ${warning.title}`, "aria-label": "First step" });
    const submit = async (event: Event) => {
      event.preventDefault();
      try {
        await tasksApi.firstStep(warning.taskId, input.value);
        toast("Added a 15 minute first step for today.");
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "form",
      { style: "display:grid;gap:16px", onsubmit: submit },
      sheetTitle("Do a smaller version"),
      h("p", { class: "muted", style: "margin:0" }, "Split off a tiny first step as its own 15 minute task for today. The full task keeps its deadline."),
      h("label", { class: "field" }, h("span", {}, "First step"), input),
      h(
        "div",
        { class: "row" },
        h("button", { type: "submit", class: "btn primary" }, "Add for today"),
        h("button", { type: "button", class: "btn", onclick: close }, "Cancel"),
      ),
    );
  });
}

function openSickPreview(moves: SickMove[]): void {
  openSheet("Move to when I'm better", (close) => {
    const accept = async () => {
      try {
        await tasksApi.moveAtRisk(moves.map(({ taskId, day }) => ({ taskId, day })));
        toast(moves.length === 1 ? "Moved 1 task." : `Moved ${moves.length} tasks.`);
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "div",
      { class: "sheet-body", style: "display:grid;gap:16px" },
      sheetTitle("Move to when I'm better"),
      h("p", { class: "muted", style: "margin:0" }, "Each task moves to the day before its deadline, and never earlier than tomorrow. Nothing changes until you accept."),
      h(
        "div",
        { class: "card" },
        moves.map((move) =>
          h(
            "div",
            { class: "task", style: "display:grid;gap:2px" },
            h("strong", {}, move.title),
            h(
              "div",
              { class: "meta" },
              h("span", {}, themeById(move.themeId)?.name ?? ""),
              h("span", {}, `Lands ${formatDay(move.day)}`),
              h("span", {}, `Due ${formatDay(move.deadline)}`),
              move.noBuffer ? h("span", { class: "chip" }, "No buffer") : undefined,
            ),
          ),
        ),
      ),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "btn primary", onclick: accept }, "Move them"),
        h("button", { type: "button", class: "btn", onclick: close }, "Keep as is"),
      ),
    );
  });
}

function act(action: () => Promise<unknown>, message: string): () => Promise<void> {
  return async () => {
    try {
      await action();
      toast(message);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
}

function sheetTitle(text: string): HTMLElement {
  return h("h2", { style: "margin:0;text-transform:none;font-size:20px;color:var(--text);letter-spacing:0" }, text);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
