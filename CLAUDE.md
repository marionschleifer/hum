# Hum

Marion's personal AI-assisted planner. Requirements live in `SPEC.md`. Read it before changing behavior.

## Stack

- Bun + TypeScript, ES2022, ESM.
- SQLite via `bun:sqlite`.
- Claude API for planning and drafting, OpenAI Whisper for transcription.
- Prefer Bun and web built-ins. Ask Marion before adding any dependency.

## Commands

- `bun test` runs all tests.
- `bun run dev` starts the server locally.
- `fly deploy -a hum-marion` deploys to https://hum-marion.fly.dev (see README, Hosting). The live data lives on the Fly volume, not in `data/`.

## Code conventions

- Stepdown rule: abstract first, details below. Exported functions at the top of a file, helpers underneath.
- Never `null`. Use `undefined`. Convert SQLite `NULL` to `undefined` at the boundary.
- Functions over classes.
- Tests for everything. Use `describe` / `it`.
- No comments unless the code cannot say it.
- Commit after each meaningful step.

## Writing

- Plain, clear English.
- No em dashes anywhere: code, docs, UI copy, commit messages.

## Safety rules

- Secrets only in environment variables. Never commit them, never ask Marion to paste them into chat.
- Hum never sends email. Never request the Gmail send scope.
- Calendars are read-only.
- The AI never acts on anything for Accounto. It only schedules.
- Never read or investigate anything in `~/accounto`, including its Claude memory folder. Accounto sessions add tasks to Hum through `bun run add` (see SPEC.md), never the other way round.
- When the AI is unsure about a theme or priority, the task goes to the inbox unassigned.
- Ask Marion before: creating the GitHub repo, adding a dependency, choosing a host, or anything that costs money.
