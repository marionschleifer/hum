import { planApi, type CalendarEvent, type TodayView } from "../api.ts";
import { formatMinutes, formatTime, h, toast } from "../dom.ts";
import { refresh, store, themeById } from "../state.ts";

export function meetingRows(events: CalendarEvent[]): HTMLElement[] {
  return events.map((event) =>
    h(
      "div",
      { class: "task", style: "cursor:default" },
      h("span", { class: "muted", style: "width:92px;flex:none;font-size:14px" }, event.allDay ? "All day" : `${formatTime(event.start)}-${formatTime(event.end)}`),
      h(
        "div",
        { class: "body" },
        h("div", { class: "title" }, event.title),
        event.themeSource === "unknown" ? themeQuestion(event) : themeLabel(event),
      ),
      h(
        "button",
        { type: "button", class: "link-btn", style: "flex:none;padding:0 4px", "aria-label": `Hide ${event.title}`, onclick: () => hide(event) },
        "Hide",
      ),
    ),
  );
}

async function hide(event: CalendarEvent): Promise<void> {
  try {
    await planApi.hideEvent(event);
    toast(`Hid "${event.title}". Settings lists hidden events.`);
    await refresh();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

export function calendarNotice(view: TodayView): HTMLElement | undefined {
  if (view.calendarError) return h("div", { class: "card panel muted" }, `Calendar unavailable: ${view.calendarError}`);
  if (!view.connected) {
    return h("div", { class: "card panel muted" }, "Calendar not connected. ", h("a", { href: "#/settings" }, "Connect it in Settings"), ".");
  }
  return undefined;
}

function themeLabel(event: CalendarEvent): HTMLElement | undefined {
  const theme = themeById(event.themeId);
  if (!theme || !event.blocking) return undefined;
  return h("div", { class: "meta" }, h("span", { class: "chip" }, h("span", { class: "dot", style: `background:${theme.color}` }), theme.name, ` ${formatMinutes(event.minutes)}`));
}

function themeQuestion(event: CalendarEvent): HTMLElement {
  const answer = async (themeId: string, label: string) => {
    try {
      await planApi.tagTitle(event.title, themeId);
      toast(`"${event.title}" is ${label} from now on`);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  return h(
    "div",
    { class: "sort-row" },
    h("span", { class: "muted", style: "font-size:13px;align-self:center" }, "Which theme?"),
    store.themes.map((theme) =>
      h("button", { type: "button", class: "chip", onclick: () => answer(theme.id, theme.name) }, h("span", { class: "dot", style: `background:${theme.color}` }), theme.name),
    ),
    h("button", { type: "button", class: "chip", onclick: () => answer("", "not a theme") }, "None"),
  );
}
