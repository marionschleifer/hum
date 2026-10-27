import type { FindLearning, SuggestForTasks } from "./ai/evening.ts";
import type { ChoosePlan, ParseBudgets } from "./ai/planning.ts";
import type { StructureCapture, Transcribe } from "./ai/types.ts";
import { sha256Hex } from "./auth/encoding.ts";
import {
  createApiToken,
  createSession,
  endSession,
  hasValidApiToken,
  hasValidSession,
  listApiTokens,
  revokeApiToken,
  sessionCookie,
} from "./auth/sessions.ts";
import {
  listPasskeys,
  loginOptions,
  registrationOptions,
  verifyLogin,
  verifyRegistration,
  type AuthenticationResponse,
  type RegistrationResponse,
} from "./auth/webauthn.ts";
import {
  calendarSettings,
  hideEvent,
  listCalendars,
  listHiddenEvents,
  saveCalendarSettings,
  setTitleRule,
  unhideEvent,
  type CalendarSource,
} from "./calendar/calendar.ts";
import { captureAudio, captureText, describeCapture, type CaptureResult } from "./capture/capture.ts";
import { fail, isHttpError, type Ctx } from "./context.ts";
import { eveningView, pendingEvening, wrapUpDay, type Answer } from "./evening/evening.ts";
import { recordTimeSpent, weekSummary } from "./timespent/timespent.ts";
import { applySuggestion, dismissSuggestion, listPendingSuggestions } from "./evening/suggestions.ts";
import {
  authorizationUrl,
  completeAuthorization,
  connectedAccounts,
  disconnectAccount,
  type GoogleApi,
  type GoogleOAuthConfig,
} from "./google/google.ts";
import { createRouter, json, readJson, type Handler, type Route } from "./http/router.ts";
import { previewImport, runImport, type ImportTarget, type TodoistData } from "./import/todoist.ts";
import { addLearning, deleteLearning, listLearnings, updateLearning } from "./learnings/learnings.ts";
import { giveTimeToday, letGo, moveAtRisk, moveDeadline, scheduleForTomorrow, splitFirstStep } from "./planning/at-risk.ts";
import { makeDayPlan, parseMorningNote, parseTimeSpent, pickForToday, todayView, type PlanRequest } from "./planning/dayplans.ts";
import { createProject, listProjects, updateProject, type ProjectInput, type ProjectPatch } from "./projects/projects.ts";
import {
  completeTask,
  createTask,
  dropTask,
  getTask,
  listTasks,
  reopenTask,
  restoreTask,
  taskStatuses,
  updateTask,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
} from "./tasks/tasks.ts";
import {
  addSession,
  moveSession,
  setTrainingTemplate,
  TEN_K_WEEK,
  trainingTemplate,
  trainingWeek,
  updateSession,
  type SessionKind,
  type SessionStatus,
  type TemplateEntry,
} from "./training/training.ts";
import { createTheme, getTheme, listThemes, updateTheme, type ThemeInput, type ThemePatch } from "./themes/themes.ts";

export type AppDeps = {
  ctx: Ctx;
  config: { origin: string; rpId: string; setupToken?: string };
  structure?: StructureCapture;
  transcribe?: Transcribe;
  fetchTodoist?: () => Promise<TodoistData>;
  google?: { oauth: GoogleOAuthConfig; api: GoogleApi; fetch?: typeof fetch };
  choosePlan?: ChoosePlan;
  parseBudgets?: ParseBudgets;
  suggest?: SuggestForTasks;
  findLearning?: FindLearning;
  log?: (message: string, error: unknown) => void;
};

export function createApp(deps: AppDeps): { fetch: (request: Request) => Promise<Response | undefined> } {
  const route = createRouter([...authRoutes(deps), ...dataRoutes(deps), ...captureRoutes(deps), ...settingsRoutes(deps), ...calendarRoutes(deps), ...planRoutes(deps), ...eveningRoutes(deps), ...trainingRoutes(deps)]);
  return {
    fetch: async (request) => {
      try {
        return await route(request);
      } catch (error) {
        if (isHttpError(error)) return json({ error: error.message }, error.status);
        (deps.log ?? console.error)(`${request.method} ${new URL(request.url).pathname} failed`, error);
        return json({ error: "Something went wrong" }, 500);
      }
    },
  };
}

function authRoutes(deps: AppDeps): Route[] {
  const { ctx, config } = deps;
  const secure = config.origin.startsWith("https://");
  const mayRegister = (request: Request, setupToken: string | undefined) =>
    hasValidSession(ctx, request) ||
    (config.setupToken !== undefined && setupToken !== undefined && sha256Hex(setupToken) === sha256Hex(config.setupToken));
  const withNewSession = (body: unknown) => {
    const { token, maxAgeSeconds } = createSession(ctx);
    return json(body, 200, { "set-cookie": sessionCookie(token, maxAgeSeconds, secure) });
  };
  return [
    route("GET", "/api/auth/status", (request) =>
      json({ loggedIn: hasValidSession(ctx, request), hasPasskey: listPasskeys(ctx).length > 0 }),
    ),
    route("POST", "/api/auth/register/options", async (request) => {
      const body = await readJson<{ setupToken?: string }>(request);
      if (!mayRegister(request, body.setupToken)) fail(401, "Setup token required");
      return json(registrationOptions(ctx, config));
    }),
    route("POST", "/api/auth/register/verify", async (request) => {
      const body = await readJson<{ setupToken?: string; label?: string; credential: RegistrationResponse }>(request);
      if (!mayRegister(request, body.setupToken)) fail(401, "Setup token required");
      const passkey = await verifyRegistration(ctx, config, body.credential, body.label ?? "Passkey");
      return withNewSession({ passkey });
    }),
    route("POST", "/api/auth/login/options", () => json(loginOptions(ctx, config))),
    route("POST", "/api/auth/login/verify", async (request) => {
      const body = await readJson<{ credential: AuthenticationResponse }>(request);
      await verifyLogin(ctx, config, body.credential);
      return withNewSession({ ok: true });
    }),
    route("POST", "/api/auth/logout", (request) => {
      endSession(ctx, request);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0, secure) });
    }),
  ];
}

function dataRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  return [
    guard("GET", "/api/themes", (request) =>
      json(listThemes(ctx, { includeArchived: query(request, "archived") === "1" })),
    ),
    guard("POST", "/api/themes", async (request) => json(createTheme(ctx, await readJson<ThemeInput>(request)), 201)),
    guard("PATCH", "/api/themes/:id", async (request, { id }) =>
      json(updateTheme(ctx, id!, await readJson<ThemePatch>(request))),
    ),
    guard("GET", "/api/projects", (request) =>
      json(listProjects(ctx, { themeId: query(request, "theme"), includeArchived: query(request, "archived") === "1" })),
    ),
    guard("POST", "/api/projects", async (request) =>
      json(createProject(ctx, await readJson<ProjectInput>(request)), 201),
    ),
    guard("PATCH", "/api/projects/:id", async (request, { id }) =>
      json(updateProject(ctx, id!, await readJson<ProjectPatch>(request))),
    ),
    guard("GET", "/api/tasks", (request) => {
      const status = query(request, "status")?.split(",").filter(Boolean);
      if (status?.some((s) => !taskStatuses.includes(s as TaskStatus))) fail(400, "Invalid status");
      const essential = query(request, "essential");
      const tasks = listTasks(
        ctx,
        {
          status: status as TaskStatus[] | undefined,
          themeId: query(request, "theme"),
          projectId: query(request, "project"),
          parentId: query(request, "parent"),
          essential: essential === undefined ? undefined : essential === "1",
        },
        todayOr(ctx, query(request, "today")),
      );
      return json(tasks);
    }),
    guard("POST", "/api/tasks", async (request) => {
      const body = await readJson<Omit<TaskInput, "source">>(request);
      return json(createTask(ctx, { ...body, source: "manual" }), 201);
    }),
    guard("GET", "/api/tasks/:id", (request, { id }) => {
      const task = getTask(ctx, id!) ?? fail(404, "Task not found");
      return json({ ...task, subtasks: listTasks(ctx, { parentId: task.id }, todayOr(ctx, query(request, "today"))) });
    }),
    guard("PATCH", "/api/tasks/:id", async (request, { id }) => json(updateTask(ctx, id!, await readJson<TaskPatch>(request)))),
    guard("POST", "/api/tasks/:id/complete", async (request, { id }) =>
      json(completeTask(ctx, id!, todayOr(ctx, (await optionalJson<{ today?: string }>(request)).today))),
    ),
    guard("POST", "/api/tasks/:id/reopen", async (request, { id }) =>
      json(reopenTask(ctx, id!, todayOr(ctx, (await optionalJson<{ today?: string }>(request)).today))),
    ),
    guard("POST", "/api/tasks/:id/drop", (_request, { id }) => json(dropTask(ctx, id!))),
    guard("POST", "/api/tasks/:id/restore", (_request, { id }) => json(restoreTask(ctx, id!))),
  ];
}

function captureRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  const respond = (result: CaptureResult) =>
    json({ ...result, message: describeCapture(result, (id) => getTheme(ctx, id)?.name) }, 201);
  return [
    guard("POST", "/api/capture", async (request) => {
      const body = await readJson<{ text?: string; today?: string }>(request);
      return respond(await captureText(deps, body.text ?? "", { source: "quick_add", today: todayOr(ctx, body.today) }));
    }),
    guard("POST", "/api/capture/voice", async (request) => {
      const { audio, today } = await readAudio(request);
      return respond(await captureAudio(deps, audio, { source: "voice", today: todayOr(ctx, today) }));
    }),
    route("POST", "/api/shortcut/capture", tokenCapture("shortcut")),
    route("POST", "/api/cli/capture", tokenCapture("cli")),
  ];

  function tokenCapture(source: "shortcut" | "cli"): Handler {
    return async (request) => {
      if (!hasValidApiToken(ctx, request)) fail(401, "Invalid token");
      const isForm = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
      if (isForm) {
        const { audio, today } = await readAudio(request);
        return respond(await captureAudio(deps, audio, { source, today: todayOr(ctx, today) }));
      }
      const body = await readJson<{ text?: string; today?: string }>(request);
      return respond(await captureText(deps, body.text ?? "", { source, today: todayOr(ctx, body.today) }));
    };
  }
}

function settingsRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  const todoist = () => deps.fetchTodoist ?? fail(503, "Set TODOIST_API_TOKEN to import from Todoist");
  return [
    guard("GET", "/api/passkeys", () => json(listPasskeys(ctx))),
    guard("GET", "/api/tokens", () => json(listApiTokens(ctx))),
    guard("POST", "/api/tokens", async (request) => {
      const body = await readJson<{ label?: string }>(request);
      return json(createApiToken(ctx, body.label ?? ""), 201);
    }),
    guard("DELETE", "/api/tokens/:id", (_request, { id }) => {
      revokeApiToken(ctx, id!);
      return json({ ok: true });
    }),
    guard("GET", "/api/import/todoist/preview", async () => json(previewImport(ctx, await todoist()()))),
    guard("POST", "/api/import/todoist", async (request) => {
      const body = await readJson<{ mapping?: Record<string, ImportTarget> }>(request);
      return json(runImport(ctx, await todoist()(), body.mapping ?? {}));
    }),
  ];
}

function calendarRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  const google = () => deps.google ?? fail(503, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Google Calendar");
  const account = () => calendarSettings(ctx).account ?? fail(409, "Google Calendar is not connected");
  return [
    guard("GET", "/api/google/status", () =>
      json({ configured: deps.google !== undefined, accounts: connectedAccounts(ctx), settings: calendarSettings(ctx) }),
    ),
    guard("GET", "/api/google/connect", () => Response.redirect(authorizationUrl(ctx, google().oauth), 302)),
    guard("GET", "/api/google/callback", async (request) => {
      const params = new URL(request.url).searchParams;
      try {
        const email = await completeAuthorization(
          ctx,
          google().oauth,
          { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined, error: params.get("error") ?? undefined },
          deps.google?.fetch,
        );
        const current = calendarSettings(ctx);
        saveCalendarSettings(ctx, { account: email, mainCalendarId: current.mainCalendarId ?? email });
        return Response.redirect(`${deps.config.origin}/#/settings`, 302);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.redirect(`${deps.config.origin}/#/settings?calendarError=${encodeURIComponent(message)}`, 302);
      }
    }),
    guard("DELETE", "/api/google/accounts/:email", (_request, { email }) => {
      disconnectAccount(ctx, email!);
      if (calendarSettings(ctx).account === email) saveCalendarSettings(ctx, { account: "" });
      return json({ ok: true });
    }),
    guard("GET", "/api/calendar/calendars", async () => json(await listCalendars(google().api, account()))),
    guard("PUT", "/api/calendar/settings", async (request) => {
      const body = await readJson<{ mainCalendarId?: string; sources?: CalendarSource[] }>(request);
      if (body.sources !== undefined && !Array.isArray(body.sources)) fail(400, "Which calendars?");
      return json(saveCalendarSettings(ctx, { mainCalendarId: body.mainCalendarId, sources: body.sources }));
    }),
    guard("GET", "/api/calendar/hidden", () => json(listHiddenEvents(ctx))),
    guard("POST", "/api/calendar/hidden", async (request) => {
      const body = await readJson<{ id?: string; title?: string; start?: string }>(request);
      hideEvent(ctx, { id: body.id ?? "", title: body.title ?? "", start: body.start ?? "" });
      return json({ ok: true }, 201);
    }),
    guard("DELETE", "/api/calendar/hidden/:id", (_request, { id }) => {
      unhideEvent(ctx, id!);
      return json({ ok: true });
    }),
    guard("POST", "/api/calendar/rules", async (request) => {
      const body = await readJson<{ title?: string; themeId?: string }>(request);
      setTitleRule(ctx, body.title ?? "", body.themeId || undefined);
      return json({ ok: true });
    }),
  ];
}

function planRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  const planDeps = () => ({ ctx, google: deps.google?.api, choosePlan: deps.choosePlan, parseBudgets: deps.parseBudgets, log: deps.log });
  return [
    guard("GET", "/api/today", async (request) =>
      json(await todayView(planDeps(), todayOr(ctx, query(request, "today")), query(request, "tz") ?? "UTC")),
    ),
    guard("POST", "/api/plan", async (request) => {
      const body = await readJson<Partial<PlanRequest>>(request);
      return json(
        await makeDayPlan(planDeps(), {
          today: todayOr(ctx, body.today),
          timeZone: body.timeZone ?? "UTC",
          energy: body.energy ?? "normal",
          energyNote: body.energyNote,
          budgets: body.budgets ?? {},
          openWork: body.openWork ?? {},
        }),
      );
    }),
    guard("POST", "/api/tasks/:id/today", async (request, { id }) => {
      const body = await readJson<{ today?: string; pick?: boolean; themeId?: string }>(request);
      return json(pickForToday(ctx, id!, todayOr(ctx, body.today), { pick: body.pick !== false, themeId: body.themeId || undefined }));
    }),
    guard("POST", "/api/tasks/:id/tomorrow", async (request, { id }) =>
      json(scheduleForTomorrow(ctx, id!, todayOr(ctx, (await optionalJson<{ today?: string }>(request)).today))),
    ),
    guard("POST", "/api/tasks/:id/first-step", async (request, { id }) => {
      const body = await readJson<{ today?: string; title?: string }>(request);
      return json(splitFirstStep(ctx, id!, todayOr(ctx, body.today), body.title ?? ""), 201);
    }),
    guard("POST", "/api/tasks/:id/give-time", async (request, { id }) => {
      const body = await readJson<{ today?: string; minutes?: number; from?: string }>(request);
      return json(giveTimeToday(ctx, id!, todayOr(ctx, body.today), Number(body.minutes), body.from || undefined));
    }),
    guard("POST", "/api/tasks/:id/move-deadline", async (request, { id }) => {
      const body = await readJson<{ today?: string; deadline?: string }>(request);
      return json(moveDeadline(ctx, id!, todayOr(ctx, body.today), body.deadline ?? ""));
    }),
    guard("POST", "/api/tasks/:id/let-go", async (request, { id }) =>
      json(letGo(ctx, id!, todayOr(ctx, (await optionalJson<{ today?: string }>(request)).today))),
    ),
    guard("POST", "/api/at-risk/move", async (request) => {
      const body = await readJson<{ today?: string; moves?: { taskId: string; day: string }[] }>(request);
      return json(moveAtRisk(ctx, todayOr(ctx, body.today), body.moves ?? []));
    }),
    guard("POST", "/api/plan/parse", async (request) => {
      const body = await readJson<{ text?: string }>(request);
      return json(await parseMorningNote(planDeps(), body.text ?? ""));
    }),
  ];
}

function eveningRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  const eveningDeps = () => ({ ctx, suggest: deps.suggest, findLearning: deps.findLearning, log: deps.log });
  return [
    guard("GET", "/api/evening", (request) => json(eveningView(ctx, todayOr(ctx, query(request, "date"))))),
    guard("GET", "/api/evening/pending", (request) => json({ date: pendingEvening(ctx, todayOr(ctx, query(request, "today"))) })),
    guard("POST", "/api/evening", async (request) => {
      const body = await readJson<{ date?: string; answers?: Answer[]; timeSpent?: Record<string, number> }>(request);
      if (!body.date) fail(400, "Which day is this for?");
      return json(await wrapUpDay(eveningDeps(), body.date, Array.isArray(body.answers) ? body.answers : [], body.timeSpent));
    }),
    guard("PUT", "/api/evening/time", async (request) => {
      const body = await readJson<{ date?: string; timeSpent?: Record<string, number> }>(request);
      if (!body.date) fail(400, "Which day is this for?");
      if (!body.timeSpent || typeof body.timeSpent !== "object") fail(400, "How much time did you spend?");
      return json({ timeSpent: recordTimeSpent(ctx, body.date, body.timeSpent) });
    }),
    guard("POST", "/api/evening/time/parse", async (request) => {
      const body = await readJson<{ text?: string }>(request);
      return json({ timeSpent: await parseTimeSpent({ ctx, parseBudgets: deps.parseBudgets }, body.text ?? "") });
    }),
    guard("GET", "/api/week", (request) => json(weekSummary(ctx, todayOr(ctx, query(request, "date"))))),
    guard("GET", "/api/suggestions", () => json(listPendingSuggestions(ctx))),
    guard("POST", "/api/suggestions/:id/apply", async (request, { id }) =>
      json(applySuggestion(ctx, id!, todayOr(ctx, (await optionalJson<{ today?: string }>(request)).today))),
    ),
    guard("POST", "/api/suggestions/:id/dismiss", (_request, { id }) => {
      dismissSuggestion(ctx, id!);
      return json({ ok: true });
    }),
    guard("GET", "/api/learnings", () => json(listLearnings(ctx))),
    guard("POST", "/api/learnings", async (request) => {
      const body = await readJson<{ text?: string }>(request);
      return json(addLearning(ctx, body.text ?? "", "manual"), 201);
    }),
    guard("PATCH", "/api/learnings/:id", async (request, { id }) => {
      const body = await readJson<{ text?: string }>(request);
      return json(updateLearning(ctx, id!, body.text ?? ""));
    }),
    guard("DELETE", "/api/learnings/:id", (_request, { id }) => {
      deleteLearning(ctx, id!);
      return json({ ok: true });
    }),
    guard("POST", "/api/transcribe", async (request) => {
      if (!deps.transcribe) fail(503, "Voice needs OPENAI_API_KEY");
      const { audio } = await readAudio(request);
      if (audio.size === 0) fail(400, "The recording is empty");
      return json({ text: await deps.transcribe(audio) });
    }),
  ];
}

function trainingRoutes(deps: AppDeps): Route[] {
  const { ctx } = deps;
  const guard = sessionGuard(deps);
  return [
    guard("GET", "/api/training/week", (request) => {
      const today = todayOr(ctx, query(request, "today"));
      return json(trainingWeek(ctx, query(request, "date") ?? today, today));
    }),
    guard("POST", "/api/training/sessions/:id/move", async (request, { id }) => {
      const body = await readJson<{ date?: string; today?: string }>(request);
      const sessions = moveSession(ctx, id!, body.date ?? fail(400, "Which day?"));
      return json(trainingWeek(ctx, sessions[0]!.date, todayOr(ctx, body.today)));
    }),
    guard("PATCH", "/api/training/sessions/:id", async (request, { id }) => {
      const body = await readJson<{ status?: SessionStatus; travel?: boolean; note?: string; kind?: SessionKind }>(request);
      return json(updateSession(ctx, id!, body));
    }),
    guard("POST", "/api/training/sessions", async (request) => {
      const body = await readJson<{ date?: string; kind?: SessionKind }>(request);
      if (!body.date) fail(400, "Which day?");
      return json(addSession(ctx, body.date, body.kind ?? fail(400, "Which session?")), 201);
    }),
    guard("GET", "/api/training/template", () => json({ template: trainingTemplate(ctx), tenK: TEN_K_WEEK })),
    guard("PUT", "/api/training/template", async (request) => {
      const body = await readJson<{ template?: TemplateEntry[] }>(request);
      if (!Array.isArray(body.template)) fail(400, "Which sessions?");
      return json({ template: setTrainingTemplate(ctx, body.template), tenK: TEN_K_WEEK });
    }),
  ];
}

function sessionGuard(deps: AppDeps) {
  return (method: string, path: string, handler: Handler): Route =>
    route(method, path, (request, params) => {
      if (!hasValidSession(deps.ctx, request)) fail(401, "Not logged in");
      const origin = request.headers.get("origin");
      if (method !== "GET" && origin && origin !== deps.config.origin) fail(403, "Cross-origin request blocked");
      return handler(request, params);
    });
}

function route(method: string, path: string, handler: Handler): Route {
  return { method, path, handler };
}

function query(request: Request, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined;
}

export function todayOr(ctx: Ctx, value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return ctx.now().toLocaleDateString("en-CA");
}

async function optionalJson<T extends object>(request: Request): Promise<Partial<T>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    return fail(400, "Invalid JSON");
  }
}

async function readAudio(request: Request): Promise<{ audio: Blob; today?: string }> {
  const form = await request.formData().catch(() => fail(400, "Expected a form upload"));
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) fail(400, "Missing audio");
  const today = form.get("today");
  return { audio, today: typeof today === "string" ? today : undefined };
}
