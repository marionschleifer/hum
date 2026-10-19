import { eveningApi, type Answer, type EveningItem, type Suggestion, type WrapUpResult } from "../api.ts";
import { recordButton } from "../components/recorder.ts";
import { suggestionCards } from "../components/suggestions.ts";
import { taskList, taskRow } from "../components/task-row.ts";
import { formatMinutes, h, mount, toast, today } from "../dom.ts";
import { refresh, themeById } from "../state.ts";

type Reason = Answer["reason"];

const REASONS: { reason: Reason; label: string }[] = [
  { reason: "no_time", label: "No time" },
  { reason: "blocked", label: "Blocked" },
  { reason: "didnt_want", label: "Didn't want to" },
  { reason: "not_relevant", label: "No longer relevant" },
];

const drafts = new Map<string, Map<string, { reason?: Reason; note: string }>>();
const results = new Map<string, WrapUpResult>();

export async function renderEvening(root: HTMLElement, date: string | undefined, thenMorning: boolean): Promise<void> {
  const day = date ?? today();
  const result = results.get(day);
  if (result) return renderResult(root, day, result, await eveningApi.suggestions(), thenMorning);
  const view = await eveningApi.view(day);
  const title = day === today() ? "Evening" : `Wrapping up ${new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" })}`;
  if (!view.hasPlan || view.wrappedUpAt) {
    const suggestions = await eveningApi.suggestions();
    mount(
      root,
      header(title, view.wrappedUpAt ? "This day is wrapped up." : "There was no plan for this day."),
      view.doneUnplanned.length || view.items.some((i) => i.doneToday)
        ? [h("h2", {}, "Done"), taskList([...view.items.filter((i) => i.doneToday).map((i) => i.task), ...view.doneUnplanned])]
        : undefined,
      suggestionCards(suggestions),
      thenMorning ? continueButton() : undefined,
    );
    return;
  }
  const answers = drafts.get(day) ?? new Map();
  drafts.set(day, answers);
  const done = view.items.filter((item) => item.doneToday);
  const open = view.items.filter((item) => !item.doneToday && item.task.status === "open");
  const finish = h("button", { type: "button", class: "btn primary" }, "Finish the day");
  finish.addEventListener("click", async () => {
    finish.disabled = true;
    finish.textContent = "Wrapping up...";
    try {
      const payload = open.map((item) => {
        const answer = answers.get(item.task.id);
        const note = answer?.note.trim() || undefined;
        return { taskId: item.task.id, reason: answer?.reason ?? "other", note } satisfies Answer;
      });
      results.set(day, await eveningApi.wrapUp(day, payload));
      drafts.delete(day);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
      finish.disabled = false;
      finish.textContent = "Finish the day";
    }
  });
  mount(
    root,
    header(title, open.length ? "Tick off what you did. For the rest, a quick why." : "Tick off what you did."),
    h("h2", {}, "Planned"),
    h(
      "div",
      { class: "card" },
      view.items.length ? [...done, ...open].map((item) => eveningRow(item, answers, day)) : h("div", { class: "empty" }, "Nothing was planned."),
    ),
    view.doneUnplanned.length ? [h("h2", {}, "Also done"), taskList(view.doneUnplanned)] : undefined,
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:20px" }, finish),
  );
}

function eveningRow(item: EveningItem, answers: Map<string, { reason?: Reason; note: string }>, day: string): HTMLElement {
  const theme = themeById(item.themeId);
  const meta = h(
    "div",
    { class: "meta" },
    theme ? h("span", { class: "chip" }, h("span", { class: "dot", style: `background:${theme.color}` }), theme.name) : undefined,
    h("span", {}, formatMinutes(item.minutes)),
  );
  if (item.doneToday) return taskRow(item.task, { done: true, hideMeta: true, extra: meta, on: day });
  const answer = answers.get(item.task.id) ?? { note: "" };
  answers.set(item.task.id, answer);
  const chips = h("div", { class: "sort-row" });
  const renderChips = () =>
    mount(
      chips,
      REASONS.map(({ reason, label }) =>
        h(
          "button",
          {
            type: "button",
            class: `chip ${answer.reason === reason ? "selected" : ""}`,
            "aria-pressed": answer.reason === reason ? "true" : "false",
            onclick: () => {
              answer.reason = answer.reason === reason ? undefined : reason;
              renderChips();
            },
          },
          label,
        ),
      ),
    );
  renderChips();
  const note = h("input", { type: "text", value: answer.note, placeholder: "Or in your own words", "aria-label": `Why ${item.task.title} didn't happen` });
  note.addEventListener("input", () => {
    answer.note = note.value;
    if (note.value.trim() && !answer.reason) {
      answer.reason = "other";
      renderChips();
    }
  });
  const mic = recordButton("Say why", async (audio) => {
    try {
      const { text } = await eveningApi.transcribe(audio);
      note.value = [note.value, text].filter(Boolean).join(" ");
      answer.note = note.value;
      if (!answer.reason) answer.reason = "other";
    } catch (error) {
      toast((error as Error).message, "error");
    }
  });
  return taskRow(item.task, {
    hideMeta: true,
    on: day,
    extra: h(
      "div",
      { onclick: (event: Event) => event.stopPropagation() },
      meta,
      chips,
      h("div", { class: "row", style: "flex-wrap:nowrap;margin-top:8px" }, note, mic),
    ),
  });
}

function renderResult(root: HTMLElement, day: string, result: WrapUpResult, suggestions: Suggestion[], thenMorning: boolean): void {
  const parts = [
    result.postponed ? `${result.postponed} moved on` : undefined,
    result.dropped ? `${result.dropped} dropped to the archive` : undefined,
  ].filter(Boolean);
  mount(
    root,
    header("Day wrapped up", parts.length ? `${parts.join(", ")}.` : "Everything planned got done."),
    result.learning
      ? h("div", { class: "card panel", style: "margin-bottom:12px" }, h("strong", {}, "Hum noticed: "), result.learning.text, h("div", { class: "muted", style: "font-size:13px;margin-top:6px" }, "Edit or delete it under Settings, Learnings."))
      : undefined,
    suggestionCards(suggestions),
    thenMorning ? continueButton() : h("a", { class: "btn", href: "#/today", onclick: () => results.delete(day) }, "Back to Today"),
  );
}

function header(title: string, hint: string): HTMLElement {
  return h("header", { class: "page", style: "display:block" }, h("h1", {}, title), h("p", { class: "muted", style: "margin:4px 0 0" }, hint));
}

function continueButton(): HTMLElement {
  return h("a", { class: "btn primary", href: "#/morning" }, "Now plan today");
}
