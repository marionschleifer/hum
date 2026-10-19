# Step 3: evening wrap-up

Status: built on 2026-10-17.

## How it works

- **Evening** (`#/evening`, or "Wrap up the day" on Today): the day's planned tasks, done ones ticked. For each undone task, one tap on No time, Blocked, Didn't want to, or No longer relevant, or a few words typed or spoken. "Finish the day" records everything.
- **No longer relevant** drops the task to the archive. Other reasons count as a postponement. Unanswered tasks count as a postponement with reason "other".
- **After 3 postponements** Hum suggests one of: do it first tomorrow, break it down, snooze it, or drop it, with a reason. Simple rules pick a default (`src/evening/suggestions.ts`); Claude may choose better using the history, notes and learnings. Code enforces the limits: never drop an essential task, never write subtasks for Accounto. Applying or dismissing a suggestion resets the count. Pending suggestions also show on Today.
- **Do first** sets `first_on`, which puts the task at the top of that day's plan. **Snooze** sets `not_before`, so the planner skips the task until then. Both are editable in the task sheet.
- **Skipped evening**: the next morning flow starts with wrapping up the last unwrapped day. Older unwrapped days are closed quietly.
- **Learnings**: after an evening, Claude may add one plain-language note when at least three postponements in the last two weeks show a pattern. Notes live under Settings, Learnings, where Marion can add, edit and delete them. They are passed to the morning plan and to suggestions as hints only.

## Not yet

- Learning from actual durations (estimates stay T-shirt sizes for now).
- Morning and evening push notifications.
