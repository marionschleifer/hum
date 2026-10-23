import { trainingApi, type TrainingSession, type TrainingWeek } from "../api.ts";
import { h, mount, toast, today } from "../dom.ts";
import { refresh } from "../state.ts";
import { openSheet } from "./sheet.ts";

const STATUS_LABELS: Record<TrainingSession["status"], string> = {
  planned: "Planned",
  done: "Done",
  skipped: "Skipped",
  sick: "Sick",
};

const KIND_LABELS: Record<TrainingSession["kind"], string> = {
  strength: "Strength",
  intervals: "Intervals",
  easy: "Easy run",
  tempo: "Tempo run",
  long: "Long run",
  rest: "Rest day",
};

export function trainingSection(week: TrainingWeek): HTMLElement | undefined {
  if (week.sessions.length === 0) return undefined;
  const container = h("section");
  const render = (current: TrainingWeek) =>
    mount(
      container,
      h(
        "div",
        { class: "row", style: "justify-content:space-between;margin:24px 0 8px" },
        h("h2", { style: "margin:0" }, weekLabel(current.monday)),
        h(
          "div",
          { class: "row" },
          h("button", { type: "button", class: "btn small", "aria-label": "Previous week", onclick: () => load(shift(current.monday, -7)) }, "‹"),
          h("button", { type: "button", class: "btn small", "aria-label": "Next week", onclick: () => load(shift(current.monday, 7)) }, "›"),
        ),
      ),
      strip(current),
      current.warnings.map((warning) =>
        h(
          "div",
          { class: "card panel warning", style: "margin-top:8px;display:grid;gap:8px" },
          h("span", {}, warning.message),
          warning.skipSessionId
            ? h(
                "button",
                {
                  type: "button",
                  class: "btn small",
                  style: "justify-self:start",
                  onclick: () => change(() => trainingApi.update(warning.skipSessionId!, { status: "skipped" }), "Skipped"),
                },
                "Skip it",
              )
            : undefined,
        ),
      ),
    );
  const load = async (date: string) => {
    try {
      render(await trainingApi.week(date));
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  render(week);
  return container;
}

export function sessionRows(sessions: TrainingSession[]): HTMLElement[] {
  return sessions.map((session) =>
    h(
      "div",
      { class: "task", style: "cursor:pointer", onclick: () => openTrainingDay(session.date, sessions) },
      h("span", { class: "muted", style: "width:92px;flex:none;font-size:14px" }, "Training"),
      h("div", { class: "body" }, h("div", { class: `title ${session.status === "done" ? "struck" : ""}` }, session.title), sessionMeta(session)),
      session.kind !== "rest" && session.status === "planned"
        ? h(
            "button",
            {
              type: "button",
              class: "today-btn",
              onclick: (event: Event) => {
                event.stopPropagation();
                void change(() => trainingApi.update(session.id, { status: "done" }), "Nice work");
              },
            },
            "Done",
          )
        : undefined,
    ),
  );
}

function strip(week: TrainingWeek): HTMLElement {
  return h(
    "div",
    { class: "card strip" },
    Array.from({ length: 7 }, (_, i) => {
      const day = shift(week.monday, i);
      const sessions = week.sessions.filter((s) => s.date === day);
      return h(
        "button",
        { type: "button", class: `strip-day ${day === today() ? "today" : ""}`, onclick: () => openTrainingDay(day, week.sessions) },
        h("div", { class: "strip-label" }, new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })),
        sessions.length
          ? sessions.map((s) =>
              h(
                "div",
                { class: `strip-session ${s.status}` },
                s.title,
                s.kind === "rest" ? undefined : h("span", { class: "muted" }, s.status === "planned" ? range(s) : STATUS_LABELS[s.status]),
              ),
            )
          : h("div", { class: "strip-session muted" }, "Nothing"),
      );
    }),
  );
}

function openTrainingDay(day: string, weekSessions: TrainingSession[]): void {
  const monday = mondayOf(day);
  const sessions = weekSessions.filter((s) => s.date === day);
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  openSheet(label, (close) => {
    const act = (action: () => Promise<unknown>, message: string) => async () => {
      try {
        await action();
        toast(message);
        close();
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    return h(
      "div",
      { class: "sheet-body", style: "display:grid;gap:16px" },
      h("h2", { style: "margin:0;text-transform:none;font-size:20px;color:var(--text);letter-spacing:0" }, label),
      sessions.length === 0
        ? [
            h("p", { class: "muted", style: "margin:0" }, "Nothing planned this day."),
            kindChips("Add", (kind) => act(() => trainingApi.add(day, kind), "Added")),
          ]
        : undefined,
      sessions.map((session) =>
        h(
          "div",
          { class: "card panel", style: "display:grid;gap:12px" },
          h("div", {}, h("strong", {}, session.title), " ", h("span", { class: "muted" }, range(session))),
          session.kind === "rest"
            ? undefined
            : h(
                "div",
                { class: "segmented", role: "group", "aria-label": "Status" },
                (["planned", "done", "skipped", "sick"] as const).map((status) =>
                  h(
                    "button",
                    {
                      type: "button",
                      "aria-pressed": session.status === status ? "true" : "false",
                      onclick: act(() => trainingApi.update(session.id, { status }), STATUS_LABELS[status]),
                    },
                    STATUS_LABELS[status],
                  ),
                ),
              ),
          session.kind === "strength"
            ? h(
                "label",
                { class: "row", style: "flex-wrap:nowrap" },
                h("input", {
                  type: "checkbox",
                  checked: session.travel,
                  onchange: act(() => trainingApi.update(session.id, { travel: !session.travel }), session.travel ? "Back to the gym" : "Bodyweight session"),
                }),
                h("span", {}, "Travelling: bodyweight or hotel strength"),
              )
            : undefined,
          kindChips(
            "Change to",
            (kind) => act(() => trainingApi.update(session.id, { kind }), kind === "rest" ? "Now a rest day" : `Now ${KIND_LABELS[kind].toLowerCase()}`),
            session.kind,
          ),
          session.status === "planned"
            ? h(
                "div",
                { style: "display:grid;gap:6px" },
                h("span", { class: "muted", style: "font-size:13px" }, "Swap with"),
                h(
                  "div",
                  { class: "row" },
                  Array.from({ length: 7 }, (_, i) => shift(monday, i))
                    .filter((d) => d !== day)
                    .map((d) =>
                      h(
                        "button",
                        { type: "button", class: "chip", onclick: act(() => trainingApi.move(session.id, d), "Moved") },
                        new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }),
                      ),
                    ),
                ),
              )
            : undefined,
        ),
      ),
      h("button", { type: "button", class: "btn", onclick: close }, "Close"),
    );
  });
}

function kindChips(
  label: string,
  onPick: (kind: TrainingSession["kind"]) => () => Promise<void>,
  current?: TrainingSession["kind"],
): HTMLElement {
  return h(
    "div",
    { style: "display:grid;gap:6px" },
    h("span", { class: "muted", style: "font-size:13px" }, label),
    h(
      "div",
      { class: "row" },
      (Object.keys(KIND_LABELS) as TrainingSession["kind"][])
        .filter((kind) => kind !== current)
        .map((kind) => h("button", { type: "button", class: "chip", onclick: onPick(kind) }, KIND_LABELS[kind])),
    ),
  );
}

async function change(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
    toast(message);
    await refresh();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

function sessionMeta(session: TrainingSession): HTMLElement | undefined {
  const parts = [session.kind === "rest" ? undefined : range(session), session.status !== "planned" ? STATUS_LABELS[session.status] : undefined].filter(Boolean);
  return parts.length ? h("div", { class: "meta" }, parts.join(" · ")) : undefined;
}

function range(session: TrainingSession): string {
  const { minMinutes: min, maxMinutes: max } = session;
  if (session.kind === "rest" || !min) return "";
  if (!max) return `${min}+ min`;
  return max === min ? `${min} min` : `${min}-${max} min`;
}

function weekLabel(monday: string): string {
  const thisMonday = mondayOf(today());
  if (monday === thisMonday) return "Training this week";
  if (monday === shift(thisMonday, 7)) return "Training next week";
  if (monday === shift(thisMonday, -7)) return "Training last week";
  return `Training, week of ${new Date(`${monday}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
