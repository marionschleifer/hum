# Hum: specification

Hum is Marion's personal AI-assisted planner. It replaces Todoist.

Requirements settled on 2026-10-17.

## Why Hum exists

Todoist forces every task onto a date. Marion's weeks never repeat: a job, travel for a nonprofit, weekends away. She wants a planner that:

- fills time budgets per theme that she sets fresh each morning,
- adapts to her energy,
- fits her training plan around everything else.

## Scope and platform

- Single user per install. Others can run their own copy (decided 2026-10-19): nothing specific to Marion is hardcoded. Her name comes from `HUM_OWNER_NAME`, and Accounto rules only apply where a theme is flagged as Accounto.
- Mac and iPhone only. Delivered as a PWA plus an iOS Shortcut for "Hey Siri" voice capture.
- English only.
- A personal tool, but kept clean enough to use for Code Blossom teaching later: a public repo under the MIT license, no secrets in the repo, a README, configuration through environment variables.

## Structure

- Themes (editable). A new install starts with Work, Personal and Exercise. Marion's install has Accounto, Code Blossom, hvnly, Personal and Exercise.
- Hierarchy: Theme, then an optional Project, then Task, then one level of subtasks.
- The Tasks tab lists open tasks by theme or by date (added 2026-10-25): by date groups them by deadline into Overdue, Today, Tomorrow, Next 7 days, Later and No deadline.
- Recurring tasks behave like normal tasks.
  - Default recurrence is "N times per week" or "N times per month", on any day.
  - Fixed days only when Marion asks for them.
  - Monthly on a date ("every 20th of the month", or the last day) or on the nth working day ("first working day of the month", Monday to Friday). From that date the task is due like a deadline until it is done, then it waits for next month.

## Tasks

- **Essential** means only what Marion flags as essential. Nothing else is essential. Essential ranks first in its theme, but it does not mean "today": an essential task that does not fit the day's budget waits (except on a sick day, when essentials are all that is shown).
- **Picked for today**: Marion can browse the inbox or any theme and tap "Today" on a task. A picked task is always in that day's plan, at the top of its theme, even over budget, and joins an existing plan right away. Picking an inbox task asks for its theme in the same step. The pick lasts one day.
- **Importance within a theme** comes from three things: how close the deadline is, her priority, and how long the task has been waiting.
- The AI never invents urgency.
- The AI never guesses a theme or priority it is unsure of. If anything is unclear, the task goes to the inbox.
- **Estimates** are T-shirt sizes:
  - S = 15 minutes
  - M = 1 hour
  - L = half a day
- The AI suggests a size, Marion confirms it, and the AI learns from actual durations over time.

## Morning ritual

This is the main ritual. There are no templates and no default hours, ever. Every day starts blank.

1. **Sort the inbox.** Skippable. Unsorted items are not planned.
2. **Show today.** Today's calendar plus tasks that are due or overdue.
3. **Set budgets and energy.** Marion says or types a time budget per theme and her energy:
   - High, Normal or Lower,
   - a small, hidden Sick button,
   - optional free text.
   - Optionally, per theme, how much of the budget is open work: email, admin and anything else that is not a todo (added 2026-10-23). "6 hours Accounto, 2 of that for email" works by voice or text too.
4. **AI fills the budgets.** The AI loads the most important tasks per theme into each budget and fits in training.
   - The output is a list per theme, not a timed schedule.
   - Meetings count against their theme's budget.
   - Open work is kept free: todos only fill what is left after meetings, training and open work. Deadline warnings use the same smaller pace.
5. **Warnings and training.** Deadline-at-risk warnings (warn only, never auto-reserve time; snoozed tasks are left out while snoozed) and a weekly training strip.
   - Each warning offers actions Marion taps herself (added 2026-10-17): schedule for tomorrow (with a fit check against the theme's usual time and a "no buffer" note when tomorrow is the deadline), give it 15 or 30 minutes today from another theme or free time, do a smaller version (a 15 minute first step for today), move the deadline (soft deadlines only; tasks can be flagged as having a fixed deadline), and let it go (recorded, and the warning stops for that deadline).
   - On a sick day the box offers "Move everything at risk to when I'm better": a preview where each task lands on the day before its deadline, never earlier than tomorrow. Nothing changes until she accepts.
   - Tasks can carry high or low stakes. The box sorts by stakes, then by due date.
6. **Mid-day re-plan.** When her energy changes during the day, she can re-plan.

If no morning plan was made, Hum shows only tasks picked for today, essentials, deadlines and training.

## Evening ritual

- **Time spent** (added 2026-10-23): first, one row per theme, prefilled with that day's budget. Marion changes only what was different, with buttons, text or voice. It is all the time for the theme that day, meetings and open work included. She can change it later on that day's evening page. A day she never records stays "not recorded", never "spent as budgeted".
- Marion ticks off the tasks she finished.
- For each undone task, Hum asks why. Quick reasons:
  - no time
  - blocked
  - didn't want to
  - no longer relevant
  - plus voice for anything else.
- After 3 postponements of the same task, the AI suggests one of: do first tomorrow, break down, reschedule, or drop. It always gives a reason.
- Dropped tasks go to an archive. They are never deleted.
- A skipped evening rolls into the next morning.
- The **Week** page compares budget and time spent per theme, per day and for the week. Days without a record are shown as such and left out of the comparison.
- **Learnings** are stored as plain-language notes. Marion can read, edit and delete them. Learnings only adjust suggestions; they never act on their own. Besides postponements, the AI looks at the last two weeks of budget against time spent (for example "Accounto runs about an hour over its budget"). It never sets or prefills budgets.

## Training

Hum is the home of the training plan (decided again on 2026-10-17). Hum no longer reads training from a separate calendar.

Goal: improve her 10k.

Each new week starts from the template set under Settings, Training week. A new install has no template and shows no training until one is set; the 10k running week below is offered as a ready-made template. Marion's install keeps it as her template:

| Day | Session |
|---|---|
| Monday | Strength, 60 min minimum |
| Tuesday | Intervals |
| Wednesday | Easy run, 40 to 50 min |
| Thursday | Strength, 60 min |
| Friday | Tempo run, 30 min |
| Saturday | Rest |
| Sunday | Long run, 75 to 100 min |

She can move sessions within the week (moving swaps with whatever is on that day), and mark each one done, skipped or sick. Sick marks the whole day. She can also change a session into another kind, for example a long run into an easy run, or into an extra rest day, and add a session to a day with nothing planned (added 2026-10-23). A changed or added session takes that kind's minutes from her template, or from the 10k week when the template has no such session.

Rules Hum checks after changes (warnings only, she decides):

- Intervals and tempo are at least 48 hours apart.
- Intervals and tempo are never the day after a long run.
- Long runs are never on consecutive days.
- At least 1 full rest day per week.
- On a travel day, strength becomes bodyweight or hotel strength (a toggle on the session).
- If the rest of the week cannot fit all remaining sessions plus a rest day, skip the easy run first, then one strength session. Intervals, tempo and the long run stay as long as possible.

The earlier rule "strength never the day before intervals" was dropped because her own template has strength on Monday and intervals on Tuesday.

Training minutes (the minimum of each session) count against the Exercise budget in the morning plan.

## Calendar

- Google Calendar, read-only, through the personal Google account with Hum's own Google OAuth client.
- Hum reads the calendars chosen under Settings (changed 2026-10-27; until then only the main calendar). A meeting goes to the theme its title names, or the theme Marion gave that title before. Otherwise a calendar with a fixed theme puts it there, and a calendar without one makes Hum ask once. Training lives in Hum itself.
- Meetings a scheduling tool (Reclaim) copies in from another calendar, such as work meetings copied from Outlook into the nonprofit calendar, carry a marker. Settings sets one theme for all of them (Accounto). A remembered title rule still wins.
- Calendars that are not chosen are ignored.
- Hum dedupes events by title plus time, and timed events with exactly the same start and end count once across calendars. The copy from a fixed-theme calendar wins.
- Hum maps events to themes by title. Obvious titles (for example "Accounto Hackathon & Team Dinner") are mapped automatically. When a title is unclear, Hum asks Marion once and remembers her answer.
- An existing scheduling tool stays as it is for now. Replacing its sync is post-v1.

## Accounto

- Scheduling only.
- High-level task titles like "build workflow x for customer x" are fine to store and to send to Claude.
- The AI must never act on anything for Accounto.

## Gmail

- Two accounts: personal and Code Blossom. Each is connected through its own Google OAuth.
- Capture only from mails Marion explicitly forwards or labels. No inbox scanning.
- For clear personal or Code Blossom tasks, a "Draft it" button creates a real Gmail draft in the matching account.
- Hum never requests the send scope. Hum never sends anything.

## Capture channels

- In-app quick add (text)
- Voice, both in-app and through the iOS Shortcut
- Gmail forward or label
- An MCP server so Claude sessions can add tasks
- A command-line entry point so a session in another folder (for example `~/accounto`) can add a task without reading Hum's internals:

  ```bash
  bun run --cwd ~/hum add "Build workflow x for customer y"
  ```

  It sends the text to Hum's capture endpoint with an API token (`HUM_API_TOKEN` in `~/hum/.env`, created under Settings) and prints where the task went. It goes through the same capture rules as everything else, so unclear tasks land in the inbox.

## Boundary with Accounto

- Hum sessions never read or investigate anything in `~/accounto`, including its Claude memory folder.
- Accounto sessions may add tasks to Hum through the command-line entry point above. That is the only direction.

## Notifications

- Morning and evening push only. Times are set per day.
- Marion plans without them anyway.

## Other

- Time zone follows the device.
- Offline support is nice to have only (view, tick off, and queued capture). Not required.

## v1 build order

1. Themes, tasks, inbox, capture, voice, Todoist import
2. Morning planning
3. Evening wrap-up. Todoist is retired at this point.
4. Training rules
5. Gmail capture and the MCP server
6. Gmail drafts and the learnings page

## Tech

- Bun and TypeScript (ES2022, ESM). Prefer built-ins over dependencies. Ask before adding any dependency.
- SQLite.
- A small always-on host (Fly.io or Hetzner, about CHF 5 per month). Ask before choosing.
- Claude API for planning and drafting, using the latest models (for example `claude-sonnet-5-5`, `claude-opus-5-5`).
- OpenAI Whisper for transcription.
- Passkey login.
- Budget: a few CHF per month.
