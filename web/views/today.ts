import { eveningApi, planApi, tasksApi, type DayPlanView, type ThemePlanView, type TodayView } from "../api.ts";
import { atRiskBox } from "../components/at-risk.ts";
import { calendarNotice, meetingRows } from "../components/calendar.ts";
import { suggestionCards } from "../components/suggestions.ts";
import { taskList, taskRow } from "../components/task-row.ts";
import { sessionRows, trainingSection } from "../components/training.ts";
import { openTaskSheet } from "../components/task-sheet.ts";
import { formatMinutes, h, mount, today } from "../dom.ts";
import { themeById } from "../state.ts";

const DEADLINE_WINDOW_DAYS = 7;

export async function renderToday(root: HTMLElement): Promise<void> {
  const [view, suggestions] = await Promise.all([planApi.today(), eveningApi.suggestions()]);
  mount(
    root,
    h(
      "header",
      { class: "page" },
      h("h1", {}, "Today"),
      h("span", { class: "muted" }, new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })),
    ),
    suggestionCards(suggestions),
    view.plan ? planned(view, view.plan) : unplanned(view),
  );
}

function planned(view: TodayView, plan: DayPlanView): HTMLElement[] {
  const unknown = view.meetings.filter((event) => event.themeSource === "unknown");
  const active = plan.themes.filter((theme) => theme.budget > 0 || theme.items.length > 0 || theme.meetingMinutes > 0);
  return [
    h(
      "div",
      { class: "row", style: "justify-content:space-between;margin-bottom:12px" },
      h("span", { class: "muted" }, `Energy: ${plan.energy}${plan.replannedAt ? ", re-planned" : ""}`),
      plan.wrappedUpAt
        ? h("span", { class: "muted" }, "Day wrapped up")
        : h(
            "div",
            { class: "row" },
            h("a", { class: "btn small", href: "#/morning/replan" }, "Re-plan"),
            h("a", { class: "btn small primary", href: "#/evening" }, "Wrap up the day"),
          ),
    ),
    plan.aiNote ? h("div", { class: "card panel" }, plan.aiNote) : undefined,
    atRiskBox(view),
    calendarNotice(view),
    unknown.length ? [h("h2", {}, "New in your calendar"), h("div", { class: "card" }, meetingRows(unknown))] : undefined,
    active.length ? active.map((theme) => themeCard(theme, view)) : h("div", { class: "card empty" }, "No time planned for any theme."),
    trainingSection(view.week),
  ].flat().filter((part): part is HTMLElement => part !== undefined);
}

function themeCard(plan: ThemePlanView, view: TodayView): HTMLElement {
  const theme = themeById(plan.themeId);
  const meetings = view.meetings.filter((event) => event.themeId === plan.themeId && event.blocking);
  const training = plan.themeId === "exercise" ? view.training : [];
  const used = plan.items.filter((item) => !item.overBudget).reduce((sum, item) => sum + item.minutes, 0);
  const summary = [
    `${formatMinutes(plan.budget)} budget`,
    plan.meetingMinutes ? `${formatMinutes(plan.meetingMinutes)} meetings` : undefined,
    plan.trainingMinutes ? `${formatMinutes(plan.trainingMinutes)} training` : undefined,
    plan.openMinutes ? `${formatMinutes(plan.openMinutes)} open work` : undefined,
    `${formatMinutes(used)} of ${formatMinutes(plan.available)} for tasks`,
  ].filter(Boolean);
  return h(
    "section",
    {},
    h("h2", { class: "theme-heading" }, h("span", { class: "dot", style: `background:${theme?.color ?? "#888"}` }), theme?.name ?? plan.themeId),
    h("div", { class: "muted", style: "font-size:13px;margin:-4px 0 8px" }, summary.join(" · ")),
    h(
      "div",
      { class: "card" },
      meetingRows(meetings),
      sessionRows(training),
      plan.openMinutes
        ? h("div", { class: "task", style: "cursor:default" }, h("div", { class: "body" }, "Open work", h("div", { class: "meta" }, `${formatMinutes(plan.openMinutes)} for email and other work that isn't a todo`)))
        : undefined,
      plan.items.map((item) =>
        taskRow(item.task, {
          done: item.doneToday,
          hideMeta: true,
          extra: h(
            "div",
            { class: "meta" },
            h("span", {}, item.sizeAssumed ? `${formatMinutes(item.minutes)}?` : formatMinutes(item.minutes)),
            item.reason ? h("span", {}, item.reason) : undefined,
            item.overBudget ? h("span", { class: "chip" }, "Over budget") : undefined,
          ),
        }),
      ),
      plan.items.length === 0 && meetings.length === 0 && training.length === 0 && !plan.openMinutes && !plan.tooBig
        ? h("div", { class: "empty" }, "Nothing planned here.")
        : undefined,
      plan.tooBig
        ? h(
            "div",
            { class: "task muted", style: "font-size:14px", onclick: () => openTaskSheet(plan.tooBig!.task.id) },
            `Next up, but too big for today: ${plan.tooBig.task.title} (${formatMinutes(plan.tooBig.minutes)}). Break it down or give ${theme?.name ?? "this theme"} more time.`,
          )
        : undefined,
    ),
  );
}

function unplanned(view: TodayView): HTMLElement[] {
  return [
    h(
      "div",
      { class: "card panel", style: "display:grid;gap:12px" },
      h("div", {}, view.week.sessions.length ? "No plan yet. Here are your essentials, deadlines and training." : "No plan yet. Here are your essentials and deadlines."),
      h("a", { class: "btn primary", href: "#/morning", style: "text-align:center;text-decoration:none" }, "Plan my day"),
    ),
    calendarNotice(view),
    view.meetings.length ? [h("h2", {}, "Calendar"), h("div", { class: "card" }, meetingRows(view.meetings))] : undefined,
    view.training.length ? [h("h2", {}, "Training today"), h("div", { class: "card" }, sessionRows(view.training))] : undefined,
    essentialsAndDeadlines(),
    trainingSection(view.week),
  ].flat().filter((part): part is HTMLElement => part !== undefined);
}

function essentialsAndDeadlines(): HTMLElement {
  const container = h("div");
  void tasksApi.list({ status: "open" }).then((open) => {
    const horizon = addDays(today(), DEADLINE_WINDOW_DAYS);
    const picked = open.filter((task) => !task.parentId && task.firstOn === today());
    mount(
      container,
      picked.length ? [h("h2", {}, "Picked for today"), taskList(picked, { showTheme: true, todayToggle: true })] : undefined,
      h("h2", {}, "Essentials"),
      taskList(open.filter((task) => task.essential && task.firstOn !== today()), { showTheme: true, empty: "Nothing flagged as essential.", todayToggle: true }),
      h("h2", {}, `Deadlines in the next ${DEADLINE_WINDOW_DAYS} days`),
      taskList(
        open.filter((task) => !task.essential && task.firstOn !== today() && task.deadline && task.deadline <= horizon),
        { showTheme: true, empty: "No deadlines coming up.", todayToggle: true },
      ),
    );
  });
  return container;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
