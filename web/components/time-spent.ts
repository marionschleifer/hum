import { eveningApi, type EveningView } from "../api.ts";
import { formatMinutes, h, mount, toast } from "../dom.ts";
import { store } from "../state.ts";
import { recordButton } from "./recorder.ts";

const STEP_MINUTES = 15;

export function timeSpentBlock(time: EveningView["time"], values: Record<string, number>): HTMLElement {
  for (const theme of time.themes) values[theme.themeId] ??= time.spent?.[theme.themeId] ?? theme.budget;
  const rows = h("div", { class: "card" });
  const said = h("input", { type: "text", placeholder: timeExample(), "aria-label": "Describe your time" });
  const renderRows = () =>
    mount(
      rows,
      time.themes.map((theme) => {
        const info = store.themes.find((t) => t.id === theme.themeId);
        const minutes = values[theme.themeId] ?? 0;
        const change = (delta: number) => {
          values[theme.themeId] = Math.max(0, minutes + delta);
          renderRows();
        };
        return h(
          "div",
          { class: "task budget-row", style: "cursor:default;align-items:center" },
          h("span", { class: "dot", style: `background:${info?.color ?? "#888"}` }),
          h("div", { class: "body" }, info?.name ?? theme.themeId, h("div", { class: "meta" }, budgetText(theme.budget, theme.openMinutes))),
          h("button", { type: "button", class: "icon-btn", "aria-label": `Less time for ${info?.name}`, onclick: () => change(-STEP_MINUTES) }, "−"),
          h("span", { class: "budget-value" }, minutes ? formatMinutes(minutes) : "0"),
          h("button", { type: "button", class: "icon-btn", "aria-label": `More time for ${info?.name}`, onclick: () => change(STEP_MINUTES) }, "+"),
        );
      }),
    );
  const fill = async (text: string) => {
    if (!text.trim()) return;
    try {
      Object.assign(values, (await eveningApi.parseTime(text)).timeSpent);
      renderRows();
      toast("Filled in. Check and adjust.");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const mic = recordButton("Say how much time", async (audio) => {
    try {
      const { text } = await eveningApi.transcribe(audio);
      said.value = text;
      await fill(text);
    } catch (error) {
      toast((error as Error).message, "error");
    }
  });
  renderRows();
  return h(
    "div",
    {},
    h(
      "form",
      { class: "row", style: "flex-wrap:nowrap;margin-bottom:12px", onsubmit: (event: Event) => (event.preventDefault(), void fill(said.value)) },
      said,
      mic,
      h("button", { type: "submit", class: "btn" }, "Fill in"),
    ),
    rows,
  );
}

function budgetText(budget: number, open: number): string {
  if (!budget) return "No budget";
  return open ? `Budget ${formatMinutes(budget)}, ${formatMinutes(open)} open` : `Budget ${formatMinutes(budget)}`;
}

function timeExample(): string {
  const [first, second] = store.themes.map((theme) => theme.name);
  const parts = [first && `5½h ${first}`, second && `nothing for ${second}`].filter(Boolean);
  return parts.length ? `Or say it: ${parts.join(", ")}` : "Or say it";
}
