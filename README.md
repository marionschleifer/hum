# Hum

A personal planner that fills the time budgets you set each morning, instead of forcing every task onto a date.

- What it should do: [SPEC.md](SPEC.md)
- How it is built: [docs/architecture.md](docs/architecture.md)
- Conventions for contributors and AI agents: [CLAUDE.md](CLAUDE.md)

## Status

v1 steps 1 and 2 are built:

- Step 1: themes, projects, tasks with one level of subtasks, the inbox, quick add, voice capture, the iOS Shortcut endpoint, passkey login and a one-time Todoist import.
- Step 2: morning planning with read-only Google Calendar, per-theme budgets, energy, Claude-assisted plans, deadline warnings and a weekly training strip ([docs/step-2-morning-planning.md](docs/step-2-morning-planning.md)).
- Step 3: evening wrap-up with reasons for undone tasks, suggestions after three postponements, snooze and do-first, rollover of a skipped evening, and learnings ([docs/step-3-evening.md](docs/step-3-evening.md)).

- Step 4: the training week lives in Hum, filled from a template you set under Settings (a 10k running week is ready to use), with moves, statuses, travel strength and rule warnings.

Gmail capture and the MCP server (step 5) are next.

## Running your own copy

Hum is single user. Anyone who wants it runs their own copy with their own keys and data. A new install starts with the themes Work, Personal and Exercise and no training week; change both under Settings. Rules that only matter for Accounto (the AI schedules those tasks but never adds advice or steps) are only sent to the AI when a theme is flagged as Accounto, which a new install never is.

## Run it locally

You need [Bun](https://bun.sh) 1.4 (the version is pinned in `.tool-versions`).

```bash
cp .env.example .env
```

Fill in `.env`. At minimum set `HUM_SETUP_TOKEN` to any long random string. Set `HUM_OWNER_NAME` to your first name so the AI can use it; without it the prompts speak of "the user". For the calendar, create a Google OAuth web client with the `calendar.readonly` scope and the redirect URI `http://localhost:3000/api/google/callback`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Without `ANTHROPIC_API_KEY` every capture lands in the inbox unstructured, and without `OPENAI_API_KEY` voice capture is off. Everything else still works.

```bash
bun run dev
```

Open http://localhost:3000, enter the setup token and create a passkey. Later devices sign in with the same passkey (iCloud Keychain syncs it) or add their own under Settings.

```bash
bun test
```

Tests never call the network. Claude, Whisper and Todoist are passed in as functions and replaced with fakes.

## Hosting

Hum runs on Fly.io as the app `hum-marion` in Frankfurt (one always-on 256 MB machine, a 1 GB volume at `/data`, about USD 3 a month). Config is in `fly.toml` and `Dockerfile`.

```bash
fly deploy -a hum-marion
```

Secrets come from `.env` and are never committed:

```bash
grep -E '^(HUM_SETUP_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=.+' .env | fly secrets import -a hum-marion
```

Fly snapshots the volume daily. Passkeys are bound to the address, so each address needs its own passkey (created with the setup token). The Google OAuth client needs `https://hum-marion.fly.dev/api/google/callback` as an extra redirect URI.

## How capture works

1. Text comes from quick add, the in-app mic (transcribed by Whisper) or the iOS Shortcut.
2. Claude turns it into tasks with a strict JSON schema.
3. Code then applies the safety rules: no theme or any doubt means inbox, `essential` and priority only when the words say so, deadlines only when a date is mentioned, sizes are always just suggestions.
4. If the AI call fails, the raw text is saved as one inbox task. Nothing is lost. Every capture is logged in the `captures` table.

## iOS Shortcut

Create a token under Settings, iOS Shortcut. The app shows the steps. The Shortcut posts to `/api/shortcut/capture` with `Authorization: Bearer <token>` and either JSON (`{ "text": "...", "today": "2026-10-17" }`) or a form upload with an `audio` file. The response has a `message` field for Siri to read out.

## Adding tasks from other folders

Sessions elsewhere (for example in `~/accounto`) add tasks without touching Hum's code:

```bash
bun run --cwd ~/hum add "Build workflow x for customer y"
```

It needs `HUM_API_TOKEN` in `~/hum/.env` (create a token under Settings) and Hum running at `HUM_URL`.

## Todoist import

Set `TODOIST_API_TOKEN`, then Settings, Todoist, Load from Todoist. Map each Todoist project to a theme, a theme plus project, the inbox, or skip. Plain due dates are dropped on purpose, deadlines and recurrences are kept, and repeats Hum cannot read land in the inbox for you to fix. The import runs once.

## Layout

```
src/        server: domain modules, auth, capture, import, HTTP
web/        the PWA, vanilla TypeScript bundled by Bun
test/       shared test helpers (fake passkey authenticator, test context)
docs/       architecture and next steps
```

## License

MIT, see [LICENSE](LICENSE).
