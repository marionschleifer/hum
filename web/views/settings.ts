import type { ImportPreview, ImportSummary, ImportTarget } from "../../src/import/todoist.ts";
import { api, eveningApi, planApi, trainingApi, type TemplateEntry, type Theme } from "../api.ts";
import { h, mount, toast } from "../dom.ts";
import { registerPasskey } from "../passkey.ts";
import { refresh, store } from "../state.ts";

type ApiToken = { id: string; label: string; createdAt: string; lastUsedAt?: string };

export async function renderSettings(root: HTMLElement): Promise<void> {
  const [passkeys, tokens] = await Promise.all([
    api<{ id: string; label: string; createdAt: string }[]>("GET", "/api/passkeys"),
    api<ApiToken[]>("GET", "/api/tokens"),
  ]);
  mount(
    root,
    h("header", { class: "page" }, h("h1", {}, "Settings")),
    h("h2", {}, "Themes"),
    themesSection(),
    h("h2", {}, "Calendar"),
    calendarSection(),
    h("h2", {}, "Training week"),
    trainingTemplateSection(),
    h("h2", {}, "Learnings"),
    learningsSection(),
    h("h2", {}, "iOS Shortcut"),
    shortcutSection(tokens),
    h("h2", {}, "Passkeys"),
    h(
      "div",
      { class: "card panel" },
      passkeys.map((p) => h("div", {}, `${p.label} `, h("span", { class: "muted" }, `added ${p.createdAt.slice(0, 10)}`))),
      h(
        "button",
        {
          class: "btn small",
          style: "margin-top:10px",
          onclick: async () => {
            try {
              await registerPasskey(prompt("Name for this passkey", "Mac") ?? "Passkey");
              toast("Passkey added");
              await refresh();
            } catch (error) {
              toast((error as Error).message, "error");
            }
          },
        },
        "Add a passkey",
      ),
    ),
    h("h2", {}, "Todoist"),
    todoistSection(),
    h("h2", {}, "More"),
    h(
      "div",
      { class: "row" },
      h("a", { class: "btn", href: "#/archive" }, "Archive"),
      h(
        "button",
        {
          class: "btn",
          onclick: async () => {
            await api("POST", "/api/auth/logout");
            location.reload();
          },
        },
        "Sign out",
      ),
    ),
  );
}

type GoogleStatus = {
  configured: boolean;
  accounts: { email: string; connectedAt: string }[];
  settings: { account?: string; mainCalendarId?: string };
};

function calendarSection(): HTMLElement {
  const container = h("div", { class: "card panel", style: "display:grid;gap:12px" }, h("span", { class: "muted" }, "Loading..."));
  const error = new URLSearchParams(location.hash.split("?")[1] ?? "").get("calendarError");
  void (async () => {
    try {
      const status = await api<GoogleStatus>("GET", "/api/google/status");
      if (!status.configured) {
        mount(container, h("p", { style: "margin:0" }, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart Hum to connect Google Calendar."));
        return;
      }
      const account = status.settings.account;
      if (!account) {
        mount(
          container,
          error ? h("p", { style: "margin:0;color:var(--danger)" }, error) : undefined,
          h("p", { style: "margin:0" }, "Hum reads your calendar, read-only, to count meetings against theme budgets."),
          h("a", { class: "btn primary", href: "/api/google/connect", style: "text-align:center;text-decoration:none" }, "Connect Google Calendar"),
        );
        return;
      }
      const calendars = await api<{ id: string; summary: string; primary: boolean }[]>("GET", "/api/calendar/calendars");
      const picker = (label: string, field: "mainCalendarId") => {
        const select = h(
          "select",
          { "aria-label": label },
          h("option", { value: "" }, "None"),
          calendars.map((c) => h("option", { value: c.id, selected: status.settings[field] === c.id }, c.summary)),
        );
        select.addEventListener("change", async () => {
          await api("PUT", "/api/calendar/settings", { [field]: select.value });
          toast("Saved");
        });
        return h("label", { class: "field", style: "margin:0" }, h("span", {}, label), select);
      };
      mount(
        container,
        h("div", {}, "Connected as ", h("strong", {}, account)),
        picker("Meetings and events", "mainCalendarId"),
        hiddenEventsList(),
        h(
          "button",
          {
            class: "btn small danger",
            style: "justify-self:start",
            onclick: async () => {
              if (!confirm("Disconnect Google Calendar?")) return;
              await api("DELETE", `/api/google/accounts/${encodeURIComponent(account)}`);
              await refresh();
            },
          },
          "Disconnect",
        ),
      );
    } catch (failure) {
      mount(container, h("p", { style: "margin:0;color:var(--danger)" }, (failure as Error).message));
    }
  })();
  return container;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SESSION_LABELS: Record<TemplateEntry["kind"], string> = {
  strength: "Strength",
  intervals: "Intervals",
  easy: "Easy run",
  tempo: "Tempo run",
  long: "Long run",
  rest: "Rest",
};

function trainingTemplateSection(): HTMLElement {
  const container = h("div", { class: "card panel", style: "display:grid;gap:10px" });
  const render = (template: TemplateEntry[], tenK: TemplateEntry[]) => {
    const rows = WEEKDAYS.map((day, index) => templateRow(day, template.find((entry) => entry.day === index)));
    const save = async (entries: TemplateEntry[]) => {
      try {
        const saved = await trainingApi.saveTemplate(entries);
        toast(saved.template.length ? "Training week saved" : "Training is off");
        render(saved.template, saved.tenK);
      } catch (error) {
        toast((error as Error).message, "error");
      }
    };
    mount(
      container,
      h(
        "p",
        { class: "muted", style: "margin:0" },
        "Hum fills each new week from this and counts the minimum minutes against the Exercise budget. Weeks already shown keep their sessions. Leave every day empty to turn training off.",
      ),
      rows.map((row) => row.element),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          { type: "button", class: "btn small primary", onclick: () => save(rows.flatMap((row, index) => row.read(index))) },
          "Save",
        ),
        h(
          "button",
          { type: "button", class: "btn small", onclick: () => confirm("Replace this week with the 10k running week?") && save(tenK) },
          "Use the 10k running week",
        ),
      ),
    );
  };
  void trainingApi.template().then(({ template, tenK }) => render(template, tenK));
  return container;
}

function templateRow(day: string, entry: TemplateEntry | undefined) {
  const kind = h(
    "select",
    { "aria-label": `${day} session` },
    h("option", { value: "" }, "Nothing"),
    Object.entries(SESSION_LABELS).map(([value, label]) => h("option", { value, selected: entry?.kind === value }, label)),
  );
  const minutes = (label: string, value: number | undefined) =>
    h("input", { type: "number", min: 1, inputmode: "numeric", placeholder: label, "aria-label": `${day} ${label}`, value, style: "width:5em" });
  const min = minutes("min", entry?.minMinutes);
  const max = minutes("max", entry?.maxMinutes);
  const number = (input: HTMLInputElement) => (input.value.trim() === "" ? undefined : Number(input.value));
  return {
    element: h("div", { class: "row", style: "flex-wrap:nowrap" }, h("span", { style: "flex:1" }, day), kind, min, max),
    read: (index: number): TemplateEntry[] =>
      kind.value === ""
        ? []
        : [{ day: index, kind: kind.value as TemplateEntry["kind"], minMinutes: number(min), maxMinutes: number(max) }],
  };
}

function learningsSection(): HTMLElement {
  const container = h("div", { class: "card panel", style: "display:grid;gap:10px" });
  const input = h("input", { type: "text", placeholder: "Add a note about how your days go", "aria-label": "New learning" });
  void eveningApi.learnings().then((learnings) =>
    mount(
      container,
      h("p", { class: "muted", style: "margin:0" }, "Plain notes Hum uses to adjust its suggestions. They never act on their own."),
      learnings.map((learning) =>
        h(
          "div",
          { class: "row", style: "flex-wrap:nowrap;align-items:flex-start" },
          h("span", { style: "flex:1" }, learning.text),
          h(
            "button",
            {
              class: "btn small",
              onclick: async () => {
                const text = prompt("Edit learning", learning.text)?.trim();
                if (!text || text === learning.text) return;
                await eveningApi.updateLearning(learning.id, text);
                await refresh();
              },
            },
            "Edit",
          ),
          h(
            "button",
            {
              class: "btn small danger",
              onclick: async () => {
                if (!confirm("Delete this learning?")) return;
                await eveningApi.deleteLearning(learning.id);
                await refresh();
              },
            },
            "Delete",
          ),
        ),
      ),
      h(
        "form",
        {
          class: "row",
          style: "flex-wrap:nowrap",
          onsubmit: async (event: Event) => {
            event.preventDefault();
            if (!input.value.trim()) return;
            await eveningApi.addLearning(input.value);
            await refresh();
          },
        },
        input,
        h("button", { type: "submit", class: "btn" }, "Add"),
      ),
    ),
  );
  return container;
}

function hiddenEventsList(): HTMLElement {
  const container = h("div");
  void planApi.hiddenEvents().then((events) =>
    mount(
      container,
      events.length
        ? h(
            "details",
            {},
            h("summary", { class: "muted" }, `Hidden events (${events.length})`),
            events.map((event) =>
              h(
                "div",
                { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;margin-top:8px" },
                h("span", {}, event.title, h("span", { class: "muted" }, ` ${event.start.slice(0, 10)}`)),
                h(
                  "button",
                  {
                    class: "btn small",
                    onclick: async () => {
                      await planApi.unhideEvent(event.id);
                      await refresh();
                    },
                  },
                  "Show again",
                ),
              ),
            ),
          )
        : undefined,
    ),
  );
  return container;
}

function themesSection(): HTMLElement {
  const name = h("input", { type: "text", placeholder: "New theme", "aria-label": "New theme name" });
  return h(
    "div",
    { class: "card panel", style: "display:grid;gap:10px" },
    store.themes.map(themeRow),
    h(
      "form",
      {
        class: "row",
        style: "flex-wrap:nowrap",
        onsubmit: async (event: Event) => {
          event.preventDefault();
          if (!name.value.trim()) return;
          await api("POST", "/api/themes", { name: name.value, color: "#8a8a8a" });
          await refresh();
        },
      },
      name,
      h("button", { type: "submit", class: "btn" }, "Add"),
    ),
  );
}

function themeRow(theme: Theme): HTMLElement {
  const save = (patch: Record<string, unknown>) => async () => {
    try {
      await api("PATCH", `/api/themes/${theme.id}`, patch);
      await refresh();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const color = h("input", { type: "color", value: theme.color, "aria-label": `${theme.name} color`, style: "width:44px;height:36px;border:none;background:none" });
  color.addEventListener("change", () => save({ color: color.value })());
  return h(
    "div",
    { class: "row", style: "flex-wrap:nowrap" },
    color,
    h("span", { style: "flex:1" }, theme.name, theme.isAccounto ? h("span", { class: "muted" }, " (scheduling only)") : undefined),
    h(
      "button",
      {
        class: "btn small",
        onclick: () => {
          const next = prompt("Rename theme", theme.name)?.trim();
          if (next && next !== theme.name) void save({ name: next })();
        },
      },
      "Rename",
    ),
    h(
      "button",
      { class: "btn small", onclick: () => confirm(`Archive ${theme.name}? Its tasks stay.`) && save({ archived: true })() },
      "Archive",
    ),
  );
}

function shortcutSection(tokens: ApiToken[]): HTMLElement {
  const output = h("div");
  return h(
    "div",
    { class: "card panel" },
    h("p", { style: "margin-top:0" }, "Lets \"Hey Siri, Hum\" add tasks. The Shortcut needs its own token."),
    tokens.map((token) =>
      h(
        "div",
        { class: "row", style: "justify-content:space-between" },
        h("span", {}, token.label, h("span", { class: "muted" }, token.lastUsedAt ? ` used ${token.lastUsedAt.slice(0, 10)}` : " never used")),
        h(
          "button",
          {
            class: "btn small danger",
            onclick: async () => {
              if (!confirm(`Revoke ${token.label}?`)) return;
              await api("DELETE", `/api/tokens/${token.id}`);
              await refresh();
            },
          },
          "Revoke",
        ),
      ),
    ),
    h(
      "button",
      {
        class: "btn small",
        style: "margin-top:10px",
        onclick: async () => {
          const label = prompt("Label", "iPhone Shortcut")?.trim();
          if (!label) return;
          const { token } = await api<{ token: string }>("POST", "/api/tokens", { label });
          mount(output, shortcutGuide(token));
        },
      },
      "Create Shortcut token",
    ),
    output,
  );
}

function shortcutGuide(token: string): HTMLElement {
  return h(
    "div",
    { style: "margin-top:12px" },
    h("p", {}, "Copy this token now. Hum only shows it once."),
    h("div", { class: "secret" }, token),
    h(
      "ol",
      { class: "steps" },
      h("li", {}, "In the Shortcuts app, create a shortcut named \"Hum\"."),
      h("li", {}, "Add \"Dictate Text\" (stop listening: after pause)."),
      h("li", {}, `Add "Get Contents of URL": ${location.origin}/api/shortcut/capture, method POST.`),
      h("li", {}, "Headers: Authorization = Bearer followed by a space and the token above."),
      h("li", {}, "Request body JSON: text = Dictated Text, today = Current Date formatted as yyyy-MM-dd."),
      h("li", {}, "Add \"Get Dictionary Value\" for key message, then \"Speak Text\" or \"Show Result\"."),
    ),
  );
}

function todoistSection(): HTMLElement {
  const container = h("div", { class: "card panel" });
  const start = h(
    "button",
    {
      class: "btn small",
      onclick: async () => {
        try {
          const preview = await api<ImportPreview>("GET", "/api/import/todoist/preview");
          mount(container, importForm(preview, container));
        } catch (error) {
          toast((error as Error).message, "error");
        }
      },
    },
    "Load from Todoist",
  );
  mount(container, h("p", { style: "margin-top:0" }, "One-time import of active tasks, projects, labels and recurrences."), start);
  return container;
}

function importForm(preview: ImportPreview, container: HTMLElement): HTMLElement {
  if (preview.alreadyImported) return h("p", { style: "margin:0" }, "Todoist was already imported.");
  const selects = new Map<string, { select: HTMLSelectElement; project: HTMLInputElement }>();
  const rows = preview.projects.map((project) => {
    const select = h(
      "select",
      { "aria-label": `Where ${project.path} goes` },
      h("option", { value: "inbox" }, "Inbox"),
      h("option", { value: "skip" }, "Skip"),
      store.themes.map((theme) => h("option", { value: `theme:${theme.id}` }, theme.name)),
      store.themes.map((theme) => h("option", { value: `project:${theme.id}` }, `${theme.name}, as a project`)),
    );
    const projectName = h("input", {
      type: "text",
      "aria-label": "Project name",
      value: project.suggestion.kind === "project" ? project.suggestion.projectName : project.name,
    });
    select.value = targetValue(project.suggestion);
    const syncName = () => (projectName.style.display = select.value.startsWith("project:") ? "" : "none");
    select.addEventListener("change", syncName);
    syncName();
    selects.set(project.id, { select, project: projectName });
    return h(
      "div",
      { class: "field" },
      h("span", {}, `${project.path} (${project.taskCount})`),
      select,
      projectName,
    );
  });
  return h(
    "div",
    {},
    h("p", { style: "margin-top:0" }, `${preview.taskCount} active tasks. Due dates are dropped, deadlines and recurrences kept.`),
    preview.unclearRecurrences.length
      ? h("p", { class: "muted" }, `These repeats land in the inbox for you to fix: ${preview.unclearRecurrences.join(", ")}`)
      : undefined,
    rows,
    h(
      "button",
      {
        class: "btn primary",
        onclick: async () => {
          const mapping: Record<string, ImportTarget> = {};
          for (const [id, { select, project }] of selects) mapping[id] = readTarget(select.value, project.value);
          try {
            const summary = await api<ImportSummary>("POST", "/api/import/todoist", { mapping });
            mount(
              container,
              h("p", { style: "margin:0" }, `Imported ${summary.tasks} tasks and ${summary.subtasks} subtasks. ${summary.inInbox} wait in the inbox.`),
            );
            await refresh();
          } catch (error) {
            toast((error as Error).message, "error");
          }
        },
      },
      "Import",
    ),
  );
}

function targetValue(target: ImportTarget): string {
  if (target.kind === "theme") return `theme:${target.themeId}`;
  if (target.kind === "project") return `project:${target.themeId}`;
  return target.kind;
}

function readTarget(value: string, projectName: string): ImportTarget {
  const [kind, themeId] = value.split(":");
  if (kind === "theme") return { kind: "theme", themeId: themeId! };
  if (kind === "project") return { kind: "project", themeId: themeId!, projectName };
  return { kind: kind === "skip" ? "skip" : "inbox" };
}
