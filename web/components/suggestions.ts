import { eveningApi, type Suggestion } from "../api.ts";
import { formatDay, h, toast } from "../dom.ts";
import { refresh } from "../state.ts";
import { openTaskSheet } from "./task-sheet.ts";

const ACTION_LABELS: Record<Suggestion["action"], string> = {
  do_first: "Do it first tomorrow",
  break_down: "Break it down",
  reschedule: "Snooze it",
  drop: "Drop it",
};

export function suggestionCards(suggestions: Suggestion[]): HTMLElement | undefined {
  if (suggestions.length === 0) return undefined;
  return h(
    "section",
    {},
    h("h2", {}, "Put off three times"),
    suggestions.map((suggestion) => suggestionCard(suggestion)),
  );
}

function suggestionCard(suggestion: Suggestion): HTMLElement {
  const act = (action: () => Promise<unknown>, message: string) => async () => {
    try {
      await action();
      toast(message);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const apply = async () => {
    await eveningApi.apply(suggestion.id);
    if (suggestion.action === "break_down" && !suggestion.payload.subtasks?.length) await openTaskSheet(suggestion.taskId);
  };
  return h(
    "div",
    { class: "card panel suggestion", style: "display:grid;gap:8px;margin-bottom:12px" },
    h("strong", {}, suggestion.task.title),
    h("div", {}, suggestion.reason),
    suggestion.payload.subtasks?.length
      ? h("ul", { style: "margin:0;padding-left:18px" }, suggestion.payload.subtasks.map((s) => h("li", {}, s)))
      : undefined,
    suggestion.payload.notBefore ? h("div", { class: "muted" }, `Back on your list: ${formatDay(suggestion.payload.notBefore)}`) : undefined,
    h(
      "div",
      { class: "row" },
      h("button", { type: "button", class: "btn primary small", onclick: act(apply, "Done") }, ACTION_LABELS[suggestion.action]),
      h("button", { type: "button", class: "btn small", onclick: act(() => eveningApi.dismiss(suggestion.id), "Kept as it is") }, "Keep as is"),
    ),
  );
}
