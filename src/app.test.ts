import { describe, expect, it } from "bun:test";
import { createFakeAuthenticator } from "../test/fake-authenticator.ts";
import { testCtx } from "../test/helpers.ts";
import { createApp, type AppDeps } from "./app.ts";

const origin = "http://localhost:3000";
const config = { origin, rpId: "localhost", setupToken: "let-me-in" };

function setup(overrides: Partial<AppDeps> = {}) {
  const ctx = testCtx();
  const errors: unknown[] = [];
  const app = createApp({ ctx, config, log: (_m, e) => errors.push(e), ...overrides });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
    const response = (await app.fetch(new Request(`${origin}${path}`, init)))!;
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
  };
  return { ctx, app, call, errors };
}

async function loggedIn(overrides: Partial<AppDeps> = {}) {
  const env = setup(overrides);
  const authenticator = await createFakeAuthenticator("localhost", origin);
  const options = await env.call("POST", "/api/auth/register/options", { setupToken: "let-me-in" });
  const credential = await authenticator.register(options.body.challenge);
  const verified = await env.call("POST", "/api/auth/register/verify", { setupToken: "let-me-in", label: "iPhone", credential });
  const cookie = verified.headers.get("set-cookie")!.split(";")[0]!;
  const as = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    env.call(method, path, body, { cookie, ...headers });
  return { ...env, as, authenticator, cookie };
}

describe("auth", () => {
  it("needs the setup token to register the first passkey", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/auth/register/options", {})).status).toBe(401);
    expect((await call("POST", "/api/auth/register/options", { setupToken: "wrong" })).status).toBe(401);
    expect((await call("POST", "/api/auth/register/options", { setupToken: "let-me-in" })).status).toBe(200);
  });

  it("refuses registration when no setup token is configured", async () => {
    const { call } = setup({ config: { origin, rpId: "localhost" } });
    expect((await call("POST", "/api/auth/register/options", { setupToken: "" })).status).toBe(401);
  });

  it("registers, then logs in and out with a passkey", async () => {
    const { call, as, authenticator } = await loggedIn();
    expect((await as("GET", "/api/auth/status")).body).toEqual({ loggedIn: true, hasPasskey: true });
    expect((await as("GET", "/api/passkeys")).body).toMatchObject([{ label: "iPhone" }]);

    const options = await call("POST", "/api/auth/login/options");
    const login = await call("POST", "/api/auth/login/verify", { credential: await authenticator.login(options.body.challenge) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const session = cookie.split(";")[0]!;
    expect((await call("GET", "/api/themes", undefined, { cookie: session })).status).toBe(200);

    await call("POST", "/api/auth/logout", undefined, { cookie: session });
    expect((await call("GET", "/api/themes", undefined, { cookie: session })).status).toBe(401);
  });

  it("lets a logged-in Marion add a second passkey without the setup token", async () => {
    const { as } = await loggedIn();
    expect((await as("POST", "/api/auth/register/options", {})).status).toBe(200);
  });

  it("protects data routes", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/tasks")).status).toBe(401);
    expect((await call("POST", "/api/capture", { text: "x" })).status).toBe(401);
  });

  it("blocks cross-origin writes", async () => {
    const { as } = await loggedIn();
    const response = await as("POST", "/api/tasks", { title: "x" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });
});

describe("themes, projects and tasks", () => {
  it("runs the inbox workflow over HTTP", async () => {
    const { as } = await loggedIn();
    const created = await as("POST", "/api/tasks", { title: "Call Anna" });
    expect(created).toMatchObject({ status: 201, body: { status: "inbox", source: "manual" } });
    const id = created.body.id;

    expect((await as("GET", "/api/tasks?status=inbox")).body.map((t: { id: string }) => t.id)).toEqual([id]);
    const sorted = await as("PATCH", `/api/tasks/${id}`, { themeId: "personal", size: "S" });
    expect(sorted.body).toMatchObject({ status: "open", size: "S", sizeConfirmed: true });

    await as("POST", "/api/tasks", { title: "Bring gift", parentId: id });
    expect((await as("GET", `/api/tasks/${id}`)).body.subtasks.map((t: { title: string }) => t.title)).toEqual(["Bring gift"]);

    expect((await as("POST", `/api/tasks/${id}/complete`, { today: "2026-10-17" })).body.status).toBe("done");
    expect((await as("POST", `/api/tasks/${id}/reopen`)).body.status).toBe("open");
    expect((await as("POST", `/api/tasks/${id}/drop`)).body.status).toBe("dropped");
    expect((await as("POST", `/api/tasks/${id}/restore`)).body.status).toBe("open");
  });

  it("manages themes and projects", async () => {
    const { as } = await loggedIn();
    const theme = await as("POST", "/api/themes", { name: "Garden" });
    expect(theme.status).toBe(201);
    const project = await as("POST", "/api/projects", { themeId: theme.body.id, name: "Beds" });
    expect((await as("GET", `/api/projects?theme=${theme.body.id}`)).body).toEqual([project.body]);
    await as("PATCH", `/api/themes/${theme.body.id}`, { archived: true });
    expect((await as("GET", "/api/themes")).body.map((t: { name: string }) => t.name)).not.toContain("Garden");
    expect((await as("PATCH", `/api/projects/${project.body.id}`, { name: "Raised beds" })).body.name).toBe("Raised beds");
  });

  it("returns clear errors", async () => {
    const { as } = await loggedIn();
    expect(await as("GET", "/api/tasks/nope")).toMatchObject({ status: 404, body: { error: "Task not found" } });
    expect(await as("POST", "/api/tasks", { title: "" })).toMatchObject({ status: 400, body: { error: "Title is required" } });
    expect((await as("GET", "/api/tasks?status=bogus")).status).toBe(400);
    expect((await as("DELETE", "/api/tasks")).status).toBe(405);
  });

  it("hides unexpected errors behind a 500", async () => {
    const { as, errors } = await loggedIn({
      fetchTodoist: async () => {
        throw new Error("Todoist 500: secret details");
      },
    });
    const response = await as("GET", "/api/import/todoist/preview");
    expect(response).toMatchObject({ status: 500, body: { error: "Something went wrong" } });
    expect(errors).toHaveLength(1);
  });
});

describe("capture", () => {
  const structure = async () => [{ title: "Book flights", theme: "Code Blossom", confident: true, subtasks: [] }];

  it("captures text from quick add", async () => {
    const { as } = await loggedIn({ structure });
    const response = await as("POST", "/api/capture", { text: "book flights", today: "2026-10-17" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ message: "Added 1 task: 1 to Code Blossom.", tasks: [{ source: "quick_add" }] });
  });

  it("captures voice recordings", async () => {
    const { as } = await loggedIn({ structure, transcribe: async () => "book flights" });
    const form = new FormData();
    form.append("audio", new Blob(["abc"], { type: "audio/mp4" }), "voice.m4a");
    form.append("today", "2026-10-17");
    const response = await as("POST", "/api/capture/voice", form);
    expect(response.body).toMatchObject({ transcript: "book flights", tasks: [{ source: "voice" }] });
  });

  it("accepts the iOS Shortcut with a bearer token, as text or audio", async () => {
    const { as, call } = await loggedIn({ structure, transcribe: async () => "book flights" });
    const { body } = await as("POST", "/api/tokens", { label: "Shortcut" });
    const bearer = { authorization: `Bearer ${body.token}` };

    expect((await call("POST", "/api/shortcut/capture", { text: "book flights" })).status).toBe(401);
    const text = await call("POST", "/api/shortcut/capture", { text: "book flights" }, bearer);
    expect(text).toMatchObject({ status: 201, body: { message: "Added 1 task: 1 to Code Blossom." } });

    const form = new FormData();
    form.append("audio", new Blob(["abc"]), "voice.m4a");
    const audio = await call("POST", "/api/shortcut/capture", form, bearer);
    expect(audio.body.tasks[0].source).toBe("shortcut");

    expect((await as("GET", "/api/tokens")).body).toMatchObject([{ label: "Shortcut" }]);
    await as("DELETE", `/api/tokens/${body.apiToken.id}`);
    expect((await call("POST", "/api/shortcut/capture", { text: "x" }, bearer)).status).toBe(401);
  });

  it("does not let a session cookie stand in for the Shortcut token", async () => {
    const { as } = await loggedIn({ structure });
    expect((await as("POST", "/api/shortcut/capture", { text: "x" })).status).toBe(401);
  });
});

describe("Todoist import", () => {
  const fetchTodoist = async () => ({
    projects: [{ id: "p1", name: "Personal" }],
    items: [{ id: "t1", content: "Renew passport", project_id: "p1" }],
  });

  it("previews and runs once", async () => {
    const { as } = await loggedIn({ fetchTodoist });
    const preview = await as("GET", "/api/import/todoist/preview");
    expect(preview.body.projects[0].suggestion).toEqual({ kind: "theme", themeId: "personal" });
    const mapping = { p1: preview.body.projects[0].suggestion };
    expect((await as("POST", "/api/import/todoist", { mapping })).body).toMatchObject({ tasks: 1 });
    expect((await as("POST", "/api/import/todoist", { mapping })).status).toBe(409);
  });

  it("explains when the token is missing", async () => {
    const { as } = await loggedIn();
    expect(await as("GET", "/api/import/todoist/preview")).toMatchObject({ status: 503 });
  });
});

describe("calendar and planning", () => {
  const oauth = { clientId: "id", clientSecret: "secret", redirectUri: `${origin}/api/google/callback` };
  const calendarList = { items: [{ id: "me@example.com", summary: "me@example.com", primary: true }, { id: "train", summary: "Training plan" }] };
  const googleFetch = (async (url: string) =>
    url.includes("oauth2.googleapis.com")
      ? Response.json({ access_token: "a", refresh_token: "r", scope: "https://www.googleapis.com/auth/calendar.readonly" })
      : Response.json(calendarList)) as typeof fetch;
  const api = { get: async <T>(_email: string, url: string) => (url.includes("calendarList") ? calendarList : { items: [] }) as T };
  const google = { oauth, api, fetch: googleFetch };

  it("connects Google Calendar through the consent redirect", async () => {
    const { as } = await loggedIn({ google });
    expect((await as("GET", "/api/google/status")).body).toMatchObject({ configured: true, accounts: [] });
    const connect = await as("GET", "/api/google/connect");
    expect(connect.status).toBe(302);
    const consent = new URL(connect.headers.get("location")!);
    expect(consent.hostname).toBe("accounts.google.com");

    const callback = await as("GET", `/api/google/callback?code=abc&state=${consent.searchParams.get("state")}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${origin}/#/settings`);
    expect((await as("GET", "/api/google/status")).body.settings).toEqual({ account: "me@example.com", mainCalendarId: "me@example.com" });

    expect((await as("GET", "/api/calendar/calendars")).body.map((c: { summary: string }) => c.summary)).toEqual([
      "me@example.com",
      "Training plan",
    ]);
    expect((await as("PUT", "/api/calendar/settings", { mainCalendarId: "me@example.com" })).body.mainCalendarId).toBe("me@example.com");
    expect((await as("POST", "/api/calendar/rules", { title: "Weekly sync", themeId: "accounto" })).status).toBe(200);
    expect((await as("POST", "/api/calendar/hidden", { id: "e1", title: "Geburi Vera", start: "2026-11-04" })).status).toBe(201);
    expect((await as("GET", "/api/calendar/hidden")).body).toMatchObject([{ id: "e1", title: "Geburi Vera" }]);
    expect((await as("DELETE", "/api/calendar/hidden/e1")).status).toBe(200);

    await as("DELETE", "/api/google/accounts/me@example.com");
    expect((await as("GET", "/api/google/status")).body.accounts).toEqual([]);
  });

  it("sends Google errors back to settings", async () => {
    const { as } = await loggedIn({ google });
    const callback = await as("GET", "/api/google/callback?error=access_denied");
    expect(callback.headers.get("location")).toContain("/#/settings?calendarError=");
  });

  it("explains when Google is not configured", async () => {
    const { as } = await loggedIn();
    expect((await as("GET", "/api/google/connect")).status).toBe(503);
    expect((await as("GET", "/api/google/status")).body.configured).toBe(false);
  });

  it("plans the day and shows it", async () => {
    const { as } = await loggedIn();
    await as("POST", "/api/tasks", { title: "Workflow x", themeId: "accounto", size: "M" });
    const before = await as("GET", "/api/today?today=2026-10-17&tz=Europe/Zurich");
    expect(before.body).toMatchObject({ date: "2026-10-17", connected: false });
    expect(before.body.plan).toBeUndefined();
    const plan = await as("POST", "/api/plan", {
      today: "2026-10-17",
      timeZone: "Europe/Zurich",
      energy: "normal",
      budgets: { accounto: 60 },
    });
    expect(plan.status).toBe(200);
    const accounto = plan.body.plan.themes.find((t: { themeId: string }) => t.themeId === "accounto");
    expect(accounto.items.map((i: { task: { title: string } }) => i.task.title)).toEqual(["Workflow x"]);
  });

  it("picks a task for today", async () => {
    const { as } = await loggedIn();
    const task = (await as("POST", "/api/tasks", { title: "Call the vet" })).body;
    expect((await as("POST", `/api/tasks/${task.id}/today`, { today: "2026-10-17" })).status).toBe(400);
    const picked = await as("POST", `/api/tasks/${task.id}/today`, { today: "2026-10-17", themeId: "personal" });
    expect(picked.body).toMatchObject({ firstOn: "2026-10-17", themeId: "personal" });
    expect((await as("POST", `/api/tasks/${task.id}/today`, { today: "2026-10-17", pick: false })).body.firstOn).toBeUndefined();
  });

  it("acts on deadlines at risk", async () => {
    const { as } = await loggedIn();
    const grant = (await as("POST", "/api/tasks", { title: "Grant", themeId: "personal", deadline: "2026-10-18" })).body;
    const tomorrow = await as("POST", `/api/tasks/${grant.id}/tomorrow`, { today: "2026-10-17" });
    expect(tomorrow.body).toMatchObject({ task: { firstOn: "2026-10-18" }, noBuffer: true });
    const step = await as("POST", `/api/tasks/${grant.id}/first-step`, { today: "2026-10-17", title: "Open the form" });
    expect(step).toMatchObject({ status: 201, body: { title: "Open the form", size: "S", firstOn: "2026-10-17" } });
    const moved = await as("POST", "/api/at-risk/move", { today: "2026-10-17", moves: [{ taskId: grant.id, day: "2026-10-19" }] });
    expect(moved.body).toMatchObject([{ firstOn: "2026-10-19" }]);
    expect((await as("POST", "/api/at-risk/move", { today: "2026-10-17", moves: [] })).status).toBe(400);
  });

  it("gives time, moves soft deadlines and lets deadlines go", async () => {
    const { as } = await loggedIn();
    await as("POST", "/api/plan", { today: "2026-10-17", energy: "normal", budgets: { accounto: 60 } });
    const soft = (await as("POST", "/api/tasks", { title: "Chanel", themeId: "personal", deadline: "2026-10-19", stakes: "high" })).body;
    const fixed = (await as("POST", "/api/tasks", { title: "Grant", themeId: "personal", deadline: "2026-10-18", deadlineFixed: true })).body;
    expect(soft.stakes).toBe("high");
    expect(fixed.deadlineFixed).toBe(true);
    expect((await as("POST", `/api/tasks/${fixed.id}/move-deadline`, { today: "2026-10-17", deadline: "2026-10-25" })).status).toBe(409);
    expect((await as("POST", `/api/tasks/${soft.id}/move-deadline`, { today: "2026-10-17", deadline: "2026-10-25" })).body.deadline).toBe("2026-10-25");
    expect((await as("POST", `/api/tasks/${fixed.id}/give-time`, { today: "2026-10-17", minutes: 30, from: "accounto" })).body.firstOn).toBe("2026-10-17");
    expect((await as("POST", `/api/tasks/${soft.id}/let-go`, { today: "2026-10-17" })).status).toBe(200);
    expect((await as("GET", "/api/today?today=2026-10-17&tz=UTC")).body.warnings).toEqual([]);
  });

  it("plans with open work", async () => {
    const { as } = await loggedIn();
    const view = (await as("POST", "/api/plan", { today: "2026-10-17", energy: "normal", budgets: { accounto: 120 }, openWork: { accounto: 45 } })).body;
    expect(view.plan.openWork).toEqual({ accounto: 45 });
    expect(view.plan.themes.find((t: { themeId: string }) => t.themeId === "accounto")).toMatchObject({ openMinutes: 45, available: 75 });
  });

  it("parses a spoken morning note", async () => {
    const { as } = await loggedIn({ parseBudgets: async () => ({ budgets: [{ theme: "hvnly", minutes: 90 }] }) });
    expect((await as("POST", "/api/plan/parse", { text: "hvnly an hour and a half" })).body).toEqual({ budgets: { hvnly: 90 } });
  });
});

describe("evening", () => {
  it("wraps up a planned day and handles suggestions and learnings", async () => {
    const { as } = await loggedIn();
    const task = (await as("POST", "/api/tasks", { title: "Tidy cellar", themeId: "personal", size: "S" })).body;
    const days = ["2026-10-17", "2026-10-18", "2026-10-19"];
    for (const day of days) {
      await as("POST", "/api/plan", { today: day, timeZone: "Europe/Zurich", energy: "normal", budgets: { personal: 60 } });
      expect((await as("GET", `/api/evening?date=${day}`)).body.items.map((i: { task: { id: string } }) => i.task.id)).toEqual([task.id]);
      const wrapped = await as("POST", "/api/evening", { date: day, answers: [{ taskId: task.id, reason: "no_time" }] });
      expect(wrapped.status).toBe(200);
    }
    const [suggestion] = (await as("GET", "/api/suggestions")).body;
    expect(suggestion).toMatchObject({ action: "do_first", task: { title: "Tidy cellar" } });
    expect((await as("POST", `/api/suggestions/${suggestion.id}/apply`, { today: "2026-10-20" })).body.firstOn).toBe("2026-10-20");

    const learning = (await as("POST", "/api/learnings", { text: "Cellar tasks wait for rainy days." })).body;
    expect((await as("PATCH", `/api/learnings/${learning.id}`, { text: "Cellar on rainy days." })).body.text).toBe("Cellar on rainy days.");
    expect((await as("GET", "/api/learnings")).body).toHaveLength(1);
    await as("DELETE", `/api/learnings/${learning.id}`);
    expect((await as("GET", "/api/learnings")).body).toEqual([]);
  });

  it("finds a skipped evening for the morning", async () => {
    const { as } = await loggedIn();
    await as("POST", "/api/plan", { today: "2026-10-16", timeZone: "Europe/Zurich", energy: "normal", budgets: {} });
    expect((await as("GET", "/api/evening/pending?today=2026-10-17")).body).toEqual({ date: "2026-10-16" });
    expect((await as("POST", "/api/evening", { answers: [] })).status).toBe(400);
  });

  it("transcribes voice for evening notes", async () => {
    const { as } = await loggedIn({ transcribe: async () => "waiting for the landlord" });
    const form = new FormData();
    form.append("audio", new Blob(["abc"]), "note.m4a");
    expect((await as("POST", "/api/transcribe", form)).body).toEqual({ text: "waiting for the landlord" });
  });
});

describe("training", () => {
  it("shows the week, moves sessions and updates their status", async () => {
    const { as } = await loggedIn();
    const week = (await as("GET", "/api/training/week?date=2026-10-21&today=2026-10-19")).body;
    expect(week.monday).toBe("2026-10-19");
    const intervals = week.sessions.find((s: { kind: string }) => s.kind === "intervals");
    const moved = (await as("POST", `/api/training/sessions/${intervals.id}/move`, { date: "2026-10-22", today: "2026-10-19" })).body;
    expect(moved.sessions.map((s: { date: string; title: string }) => `${s.date.slice(8)} ${s.title}`)).toContain("22 Intervals");
    expect((await as("PATCH", `/api/training/sessions/${intervals.id}`, { status: "done" })).body.status).toBe("done");
    expect((await as("POST", `/api/training/sessions/${intervals.id}/move`, {})).status).toBe(400);
  });

  it("reads and replaces the template, and offers the 10k week", async () => {
    const { as, call } = await loggedIn();
    const current = (await as("GET", "/api/training/template")).body;
    expect(current.template.map((e: { kind: string }) => e.kind)).toContain("long");
    expect(current.tenK).toEqual(current.template);
    const saved = await as("PUT", "/api/training/template", { template: [{ day: 2, kind: "easy", minMinutes: 30 }] });
    expect(saved.body.template).toEqual([{ day: 2, kind: "easy", minMinutes: 30 }]);
    expect((await as("PUT", "/api/training/template", { template: [{ day: 9, kind: "easy" }] })).status).toBe(400);
    expect((await as("PUT", "/api/training/template", {})).status).toBe(400);
    expect((await call("GET", "/api/training/template")).status).toBe(401);
  });
});
