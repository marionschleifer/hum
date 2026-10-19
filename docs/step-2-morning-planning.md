# Step 2: morning planning

Status: built on 2026-10-17. Connecting the real calendar and adding the Claude key are up to Marion.

## How it works

1. **Morning flow** (`#/morning`): sort the inbox (skippable), look at today's calendar and what is due, then set minutes per theme, energy (high, normal, lower, or the small "Sick today" link) and an optional note. Budgets can also be typed or dictated in one sentence ("3h Accounto, 1h Code Blossom, feeling slow"); Claude fills in the numbers for review.
2. **Planner** (`src/planning/planner.ts`, plain code): per theme, available time is the budget minus blocking meetings of that theme (and minus training for Exercise). Candidates are open, sorted tasks that are due today by their recurrence. They are ranked by essential, deadline proximity, priority, time waiting, and recurring counts running out of days. Energy shifts the ranking: lower skips non-urgent half-day tasks and prefers small ones, sick keeps only essentials and today's deadlines.
3. **Claude** (`claude-opus-5-5`, `HUM_PLANNING_MODEL`) then picks and orders tasks from each theme's ranked pool, using her energy and note, and writes one or two sentences about the day. Code enforces the rules afterwards: only pool tasks, within budget, essentials and today's deadlines always in. If Claude fails, the ranked plan stands.
4. **Today** shows a list per theme with meetings, training, tasks, the reason for each pick, deadline-at-risk warnings (warn only), the first task that was too big for the time, and a Monday to Sunday training strip. **Re-plan** prefills what is left of each budget.

## Calendar

- Read-only Google OAuth, connected under Settings. Hum stores the refresh token in SQLite.
- Two calendars: one for meetings and events, one for training. Chosen in Settings.
- Events map to themes by title: a title containing exactly one theme name maps automatically, anything else is asked once on Today or in the morning flow and remembered.

## Defaults chosen (easy to change)

- Unsized tasks count as 1 hour and show as "1h?".
- Budgets are strict. Only tasks picked for today and tasks due today may go over, and they are marked "Over budget". Essentials rank first but wait when they do not fit (changed 2026-10-17 at Marion's request).
- Training minutes come from the event description ("75-100mins" counts as 75), else 1 hour.

## Not yet

- Training rules (step 4). For now the training strip only shows what is in the training calendar.
- Learning from actual durations, and the evening wrap-up (step 3).
- Hosting, so the iPhone can reach Hum every morning.
