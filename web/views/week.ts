import { addDays } from "../../src/calendar/time.ts";
import { eveningApi, type WeekSummary } from "../api.ts";
import { formatMinutes, h, mount, today } from "../dom.ts";
import { store } from "../state.ts";

export async function renderWeek(root: HTMLElement, date: string | undefined): Promise<void> {
  const week = await eveningApi.week(date ?? today());
  const themes = week.totals.filter((total) => total.budget > 0 || total.spent > 0);
  mount(
    root,
    h(
      "header",
      { class: "page" },
      h("h1", {}, weekTitle(week.monday)),
      h(
        "div",
        { class: "row" },
        h("a", { class: "btn small", href: `#/week/${addDays(week.monday, -7)}`, "aria-label": "Previous week" }, "‹"),
        h("a", { class: "btn small", href: `#/week/${addDays(week.monday, 7)}`, "aria-label": "Next week" }, "›"),
      ),
    ),
    themes.length ? themes.map((total) => themeCard(week, total)) : h("div", { class: "card empty" }, "No plans this week."),
  );
}

function themeCard(week: WeekSummary, total: WeekSummary["totals"][number]): HTMLElement {
  const theme = store.themes.find((t) => t.id === total.themeId);
  const summary = total.recordedDays
    ? `${formatMinutes(total.spent)} spent of ${formatMinutes(total.budgetOnRecordedDays)} budgeted on ${total.recordedDays} recorded ${total.recordedDays === 1 ? "day" : "days"}. ${difference(total.spent - total.budgetOnRecordedDays)}`
    : "No time recorded yet.";
  return h(
    "section",
    {},
    h("h2", { class: "theme-heading" }, h("span", { class: "dot", style: `background:${theme?.color ?? "#888"}` }), theme?.name ?? total.themeId),
    h(
      "div",
      { class: "card panel" },
      h("div", {}, summary),
      h("div", { class: "muted", style: "font-size:13px;margin:4px 0 8px" }, `Budget for the whole week: ${formatMinutes(total.budget)}`),
      week.days.flatMap((day) => {
        const time = day.themes.find((t) => t.themeId === total.themeId);
        if (!day.planned || !time || (time.budget === 0 && !time.spent)) return [];
        const spent = time.spent === undefined ? "not recorded" : `${formatMinutes(time.spent)} spent`;
        return [
          h(
            "div",
            { class: "week-day" },
            h("span", {}, weekday(day.date)),
            h("span", { class: time.spent === undefined ? "muted" : "" }, `${formatMinutes(time.budget)} budget, ${spent}`),
          ),
        ];
      }),
    ),
  );
}

function difference(minutes: number): string {
  if (minutes === 0) return "Right on budget.";
  return minutes > 0 ? `${formatMinutes(minutes)} over.` : `${formatMinutes(-minutes)} under.`;
}

function weekTitle(monday: string): string {
  return `Week of ${new Date(`${monday}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

function weekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}
