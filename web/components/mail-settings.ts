import { api, type Theme } from "../api.ts";
import { formatDay, h, mount, toast } from "../dom.ts";
import { store } from "../state.ts";

type MailAccount = { email: string; themeId?: string };
type MailStatus = {
  configured: boolean;
  judging: boolean;
  settings: { accounts: MailAccount[]; important: string[]; stakes: string };
  lastRun?: { at: string; accounts: { email: string; checked: number; created: number; closed: number; error?: string }[] };
};

export function mailSection(): HTMLElement {
  const container = h("div", { class: "card panel", style: "display:grid;gap:12px" }, h("span", { class: "muted" }, "Loading..."));
  const load = async () => {
    try {
      render(container, await api<MailStatus>("GET", "/api/mail"), load);
    } catch (error) {
      mount(container, h("p", { style: "margin:0;color:var(--danger)" }, (error as Error).message));
    }
  };
  void load();
  return container;
}

function render(container: HTMLElement, status: MailStatus, reload: () => Promise<void>): void {
  if (!status.configured) {
    mount(container, h("p", { style: "margin:0" }, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Gmail."));
    return;
  }
  const save = async (patch: Partial<MailStatus["settings"]>, message = "Saved") => {
    try {
      await api("PUT", "/api/mail/settings", patch);
      toast(message);
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const accounts = status.settings.accounts;
  mount(
    container,
    h(
      "p",
      { class: "muted", style: "margin:0;font-size:13px" },
      "Once a day Hum looks at your Gmail, read-only. A mail you sent that has waited 10 days for an answer, or a high-stakes mail you have not answered after 2 days, becomes a task. It closes itself when the thread moves on.",
    ),
    status.judging ? undefined : h("p", { style: "margin:0" }, "Without ANTHROPIC_API_KEY only mails from your Always important list become tasks."),
    accounts.map((account) => accountRow(account, accounts, save, reload)),
    h("a", { class: "btn", href: "/api/google/connect?purpose=mail", style: "text-align:center;text-decoration:none" }, accounts.length ? "Connect another Gmail account" : "Connect Gmail"),
    textSetting(
      "What counts as high stakes for you",
      "For example: career, funding or donations, partnerships",
      status.settings.stakes,
      (value) => save({ stakes: value }),
    ),
    textSetting(
      "Always important (one per line: an address, @domain or a name)",
      "anna@funder.org\n@partner.org\nKilian",
      status.settings.important.join("\n"),
      (value) => save({ important: value.split("\n") }),
    ),
    lastRunLine(status.lastRun, reload),
  );
}

function accountRow(
  account: MailAccount,
  accounts: MailAccount[],
  save: (patch: { accounts: MailAccount[] }) => Promise<void>,
  reload: () => Promise<void>,
): HTMLElement {
  const theme = h(
    "select",
    { "aria-label": `Theme for tasks from ${account.email}` },
    h("option", { value: "" }, "Inbox"),
    store.themes.map((t: Theme) => h("option", { value: t.id, selected: account.themeId === t.id }, t.name)),
  );
  theme.addEventListener("change", () =>
    save({ accounts: accounts.map((a) => (a.email === account.email ? { email: a.email, themeId: theme.value || undefined } : a)) }),
  );
  return h(
    "div",
    { style: "display:grid;gap:6px" },
    h("strong", { style: "overflow-wrap:anywhere;font-weight:600" }, account.email),
    h(
      "div",
      { class: "row", style: "flex-wrap:nowrap;align-items:center" },
      h("span", { class: "muted", style: "font-size:13px;flex:none" }, "Tasks go to"),
      theme,
      h(
        "button",
        {
          type: "button",
          class: "btn small",
          onclick: async () => {
            if (!confirm(`Stop checking ${account.email}?`)) return;
            await api("DELETE", `/api/mail/accounts/${encodeURIComponent(account.email)}`);
            await reload();
          },
        },
        "Remove",
      ),
    ),
  );
}

function textSetting(label: string, placeholder: string, value: string, onSave: (value: string) => Promise<void>): HTMLElement {
  const area = h("textarea", { placeholder, "aria-label": label, rows: 3 }, value);
  const button = h("button", { type: "button", class: "btn small", style: "justify-self:start", onclick: () => onSave(area.value) }, "Save");
  return h("label", { class: "field", style: "margin:0;display:grid;gap:6px" }, h("span", {}, label), area, button);
}

function lastRunLine(run: MailStatus["lastRun"], reload: () => Promise<void>): HTMLElement {
  const check = h("button", { type: "button", class: "btn small" }, "Check now");
  check.addEventListener("click", async () => {
    check.disabled = true;
    check.textContent = "Checking...";
    try {
      await api("POST", "/api/mail/check", {});
      await reload();
    } catch (error) {
      toast((error as Error).message, "error");
      check.disabled = false;
      check.textContent = "Check now";
    }
  });
  const summary = run
    ? [
        h("div", { class: "muted", style: "font-size:13px" }, `Last check: ${formatDay(run.at.slice(0, 10))}, ${new Date(run.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`),
        run.accounts.map((a) =>
          h(
            "div",
            { style: `font-size:13px;${a.error ? "color:var(--danger)" : ""}` },
            a.error ? `${a.email}: ${a.error}` : `${a.email}: ${a.created} new, ${a.closed} closed, ${a.checked} looked at`,
          ),
        ),
      ]
    : h("div", { class: "muted", style: "font-size:13px" }, "Not checked yet.");
  return h("div", { style: "display:grid;gap:4px" }, summary, h("div", {}, check));
}
