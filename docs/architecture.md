# Hum architecture (proposal)

Status: agreed with Marion on 2026-10-17, with option (a) for all six decisions below. Step 1 is built.

## Overview

One Bun process does everything:

- serves the PWA (Bun's built-in HTML bundler compiles the TypeScript and CSS),
- serves a JSON API under `/api`,
- talks to SQLite through `bun:sqlite`,
- calls Claude and Whisper with plain `fetch`.

```
iPhone / Mac PWA ──┐
iOS Shortcut ──────┼──> Bun.serve ──> domain functions ──> SQLite (one file)
MCP (step 5) ──────┘          │
                              └──> ai/ (Claude, Whisper) ── only place with outbound AI calls
```

Every outside effect (clock, Claude, Whisper, Todoist, ID generation) is passed in as a function. Tests swap in fakes, so `bun test` never hits the network.

## Data model

All IDs are random text IDs. Dates are ISO strings. Day-level dates (`YYYY-MM-DD`) are in the device's time zone, sent by the client.

### themes
| column | notes |
|---|---|
| id, name, color, sort_order | |
| archived_at | themes are archived, not deleted |

A new install is seeded with Work, Personal and Exercise (Marion's install has Accounto, Code Blossom, hvnly, Personal, Exercise). `is_accounto` is a flag on the theme, so the "AI never acts for Accounto" rule follows the theme even if it is renamed.

### projects
| column | notes |
|---|---|
| id, theme_id, name, sort_order | project always belongs to a theme |
| archived_at | |

### tasks
| column | notes |
|---|---|
| id, title, notes | |
| parent_id | set only for subtasks. A subtask's parent may not itself have a parent. |
| theme_id, project_id | both optional. A task in the inbox may have neither. |
| status | `inbox`, `open`, `done`, `dropped` |
| essential | only ever set by Marion |
| priority | `high`, `normal`, `low`, default `normal` |
| size, size_confirmed | `S`, `M`, `L`. AI may suggest (`size_confirmed = false`). |
| deadline | optional date |
| recurrence | JSON, see below. Empty for one-off tasks. |
| labels | JSON array of strings (from Todoist, editable) |
| source, source_ref | `quick_add`, `voice`, `shortcut`, `todoist`, `gmail`, `mcp`; ref = Todoist ID, mail ID, etc. |
| postpone_count | used in step 3 |
| created_at, updated_at, done_at, dropped_at | `created_at` drives "time waiting" |

The inbox is simply `status = 'inbox'`. Sorting a task means giving it a theme (and optionally project, priority, size) and setting `status = 'open'`.

Dropped tasks keep their row (`status = 'dropped'`). That is the archive. Nothing is hard-deleted.

### recurrence (JSON on the task)
```ts
type Recurrence =
  | { kind: "count"; times: number; per: "week" | "month" }          // default: N times, any day
  | { kind: "weekdays"; days: Weekday[] }                             // only on request
  | { kind: "every"; interval: number; unit: "day" | "week" | "month" } // from Todoist
  | { kind: "unparsed"; text: string }                                // Todoist string Hum could not read; task lands in inbox
```
A recurring task stays one row and stays `open`. Each tick-off writes a row to `completions`. "Is it still due this period?" = completions in the current week/month < `times`.

### completions
`id, task_id, completed_on (date), completed_at, actual_minutes?`. Used for recurring tasks now, and for learning actual durations later.

### captures
Audit log of every capture: `id, source, raw_text, transcript?, ai_output (JSON), created_at`. Lets Marion (and us) see why the AI filed something where it did.

### auth
- `passkeys`: `id (credential id), public_key, sign_count, created_at, label`
- `sessions`: `token_hash, expires_at` (HTTP-only cookie)
- `api_tokens`: `token_hash, label, created_at, last_used_at` for the iOS Shortcut and later the MCP server. Shown once, stored hashed.

### Later steps (tables added when the step is built, listed here so the shape is clear)
- `day_plans` (step 2): `date, energy (high|normal|lower|sick), energy_note, budgets (JSON theme_id -> minutes), created_at, replanned_at`
- `day_plan_items` (step 2): `date, task_id, theme_id, sort_order, reason`
- `calendar_title_rules` (step 2): `title, theme_id`, for events Marion tags once
- `postponements` (step 3): `task_id, date, reason, note`
- `learnings` (step 3/6): `id, text, created_at, updated_at`
- `training_sessions` (step 4), `gmail_accounts` (step 5)

## API shape

JSON over HTTP. Session cookie for the PWA, bearer token for Shortcut and MCP.

```
POST /api/auth/register/options|verify    first passkey needs HUM_SETUP_TOKEN
POST /api/auth/login/options|verify
POST /api/auth/logout

GET|POST         /api/themes        PATCH /api/themes/:id
GET|POST         /api/projects      PATCH /api/projects/:id
GET              /api/tasks?status=inbox|open|done|dropped&theme=&project=
POST             /api/tasks                       manual create, no AI
PATCH            /api/tasks/:id                   edit, sort out of inbox, move
POST             /api/tasks/:id/complete
POST             /api/tasks/:id/drop | /restore

POST /api/capture          { text }            quick add, AI structures it
POST /api/capture/voice    multipart audio     Whisper, then same as /capture
POST /api/shortcut/capture bearer token, { text } or audio

GET  /api/import/todoist/preview    reads Todoist with TODOIST_API_TOKEN, proposes mapping
POST /api/import/todoist            runs it once with the confirmed mapping

GET|POST|DELETE /api/tokens         manage Shortcut/MCP tokens
```

## Where AI calls happen

Only in `src/ai/`. Domain code calls a function like `structureCapture(text, context)` and never builds prompts itself.

**Step 1: capture structuring.** Input: transcript or typed text, plus the current themes, projects and today's date. Claude returns structured tasks through a tool schema: title, theme, project, size suggestion, deadline, recurrence, subtasks, and a per-task `confident` flag.

Server-side rules, enforced in code and not only in the prompt:
- No theme, unknown theme, or `confident = false` -> `status = 'inbox'`, theme cleared.
- `essential` and `priority` are only set if the words explicitly say so ("this is essential", "high priority"). Otherwise defaults.
- Deadlines only when a date is actually mentioned. No invented urgency.
- Size is always stored as a suggestion (`size_confirmed = false`).

Default model: `claude-sonnet-5-5`, overridable by env (`HUM_CAPTURE_MODEL`). Planning in step 2 may use `claude-opus-5-5`.

**Voice:** audio goes to OpenAI Whisper, the transcript goes into the same capture function. For the iOS Shortcut, the cheapest path is iOS "Dictate Text" on the phone and posting text, so Whisper is only used for in-app recording (and as an optional audio path for the Shortcut).

## PWA structure

```
web/
  index.html            app shell
  app.ts                router (hash-based), boot, auth check
  api.ts                typed fetch wrapper
  views/
    inbox.ts            sort items: theme, project, priority, size
    themes.ts           theme -> projects -> tasks -> subtasks
    task.ts             task detail sheet
    today.ts            step 1: essentials + deadlines only (no plan yet)
    settings.ts         themes, passkeys, Shortcut tokens, Todoist import
  components/
    quick-add.ts        always-visible text field + mic button
  styles.css
  manifest.webmanifest
  sw.js                 installable now; offline queue later (nice to have)
```

Mobile-first layout, works on Mac too. Bottom tab bar: Today, Inbox, Themes, Settings. The quick-add bar sits above it on every screen.

## Code layout

```
src/
  server.ts             entry: reads env, opens DB, builds deps, starts Bun.serve
  app.ts                createApp(deps) -> route table
  config.ts             env parsing
  db/                   open.ts, migrations/*.sql, migrate.ts, rows.ts (NULL -> undefined)
  themes/ projects/ tasks/ recurrence/
  capture/              capture.ts (text + voice), rules.ts (inbox fallback)
  ai/                   claude.ts, whisper.ts, prompts/
  auth/                 webauthn.ts, cbor.ts, sessions.ts, tokens.ts
  import/               todoist.ts, todoist-recurrence.ts
web/                    PWA (above)
```

Tests are colocated as `*.test.ts`. HTTP tests call `createApp(fakeDeps).fetch(new Request(...))` against an in-memory SQLite.

## Configuration (env)

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TODOIST_API_TOKEN` (import only), `HUM_SETUP_TOKEN` (first passkey only), `HUM_ORIGIN` (for WebAuthn, e.g. `http://localhost:3000`), `HUM_DB_PATH`, `HUM_CAPTURE_MODEL`. A `.env.example` lists them without values. Bun loads `.env` automatically.

## Decisions for Marion

Recommended option first.

1. **Passkeys.** (a) Write WebAuthn verification with built-ins (`crypto.subtle` plus a small CBOR reader, ES256 and RS256 only, about 250 lines with tests). (b) Add `@simplewebauthn/server` (well-tested, pulls in a few transitive deps).
2. **Claude and OpenAI calls.** (a) Plain `fetch`, no SDKs. (b) Add `@anthropic-ai/sdk` and `openai`.
3. **Frontend.** (a) Vanilla TypeScript with a few small render helpers. (b) Add Preact (about 4 KB) for components.
4. **Todoist due dates.** Todoist forced a date on everything, so most due dates are not real. (a) Import Todoist's `deadline` field as the deadline, drop plain due dates, keep recurrences. (b) Import due dates as deadlines too. (c) Show both in the import preview and let Marion decide per task.
5. **Priority.** (a) Three levels: high, normal, low. Todoist p1 -> high, p2/p3 -> normal, p4 (Todoist default) -> normal. (b) Keep Todoist's four levels.
6. **Todoist projects.** The import preview shows each Todoist project and lets Marion map it to a theme, a theme + project, or the inbox. Names that match a theme are pre-selected.
