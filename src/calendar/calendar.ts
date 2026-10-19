import { fail, isoNow, type Ctx } from "../context.ts";
import type { GoogleApi } from "../google/google.ts";
import { listThemes, normalizeName, type Theme } from "../themes/themes.ts";
import { addDays, localDay, zonedMidnight } from "./time.ts";

export type CalendarSettings = { account?: string; mainCalendarId?: string };

export type ThemeSource = "name" | "rule" | "ignored" | "unknown";

export type CalendarEvent = {
  id: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  minutes: number;
  blocking: boolean;
  description?: string;
  themeId?: string;
  themeSource: ThemeSource;
};

export type CalendarDay = { connected: boolean; meetings: CalendarEvent[] };

export type CalendarListEntry = { id: string; summary: string; primary: boolean };

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

const SETTING_KEYS = { account: "calendar_account", mainCalendarId: "calendar_main" } as const;

export function calendarSettings(ctx: Ctx): CalendarSettings {
  const settings: CalendarSettings = {};
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    const row = ctx.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
    if (row) settings[field as keyof CalendarSettings] = row.value;
  }
  return settings;
}

export function saveCalendarSettings(ctx: Ctx, settings: CalendarSettings): CalendarSettings {
  for (const [field, key] of Object.entries(SETTING_KEYS)) {
    const value = settings[field as keyof CalendarSettings];
    if (value === undefined) continue;
    if (value === "") ctx.db.query("DELETE FROM meta WHERE key = ?").run(key);
    else ctx.db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  return calendarSettings(ctx);
}

export async function listCalendars(api: GoogleApi, account: string): Promise<CalendarListEntry[]> {
  const data = await api.get<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[] }>(
    account,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
  );
  return (data.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summaryOverride ?? item.summary ?? item.id,
    primary: item.primary === true,
  }));
}

export async function calendarDay(ctx: Ctx, api: GoogleApi | undefined, day: string, timeZone: string): Promise<CalendarDay> {
  const settings = calendarSettings(ctx);
  if (!api || !settings.account) return { connected: false, meetings: [] };
  const meetings = settings.mainCalendarId ? await fetchEvents(ctx, api, settings.account, settings.mainCalendarId, day, timeZone) : [];
  return { connected: true, meetings };
}

export function setTitleRule(ctx: Ctx, title: string, themeId: string | undefined): void {
  const key = normalizeName(title);
  if (!key) fail(400, "Title is required");
  if (themeId && !listThemes(ctx).some((theme) => theme.id === themeId)) fail(400, "Unknown theme");
  ctx.db
    .query(
      `INSERT INTO calendar_title_rules (title_key, title, theme_id, created_at) VALUES ($key, $title, $theme, $at)
       ON CONFLICT(title_key) DO UPDATE SET theme_id = $theme, title = $title`,
    )
    .run({ key, title: title.trim(), theme: themeId ?? null, at: isoNow(ctx) });
}

export type HiddenEvent = { id: string; title: string; start: string; hiddenAt: string };

export function hideEvent(ctx: Ctx, event: { id: string; title: string; start: string }): void {
  if (!event.id?.trim() || !event.title?.trim()) fail(400, "Event id and title are required");
  ctx.db
    .query("INSERT OR REPLACE INTO hidden_events (event_id, title, start, hidden_at) VALUES (?, ?, ?, ?)")
    .run(event.id, event.title.trim(), event.start ?? "", isoNow(ctx));
}

export function unhideEvent(ctx: Ctx, id: string): void {
  if (ctx.db.query("DELETE FROM hidden_events WHERE event_id = ?").run(id).changes === 0) fail(404, "Hidden event not found");
}

export function listHiddenEvents(ctx: Ctx): HiddenEvent[] {
  return ctx.db
    .query<{ event_id: string; title: string; start: string; hidden_at: string }, []>(
      "SELECT * FROM hidden_events ORDER BY start DESC, hidden_at DESC",
    )
    .all()
    .map((row) => ({ id: row.event_id, title: row.title, start: row.start, hiddenAt: row.hidden_at }));
}

export function themeForTitle(
  title: string,
  themes: Theme[],
  rules: Map<string, string | undefined>,
): { themeId?: string; themeSource: ThemeSource } {
  const key = normalizeName(title);
  if (rules.has(key)) {
    const themeId = rules.get(key);
    return themeId ? { themeId, themeSource: "rule" } : { themeSource: "ignored" };
  }
  const matches = themes.filter((theme) => containsWord(key, normalizeName(theme.name)));
  return matches.length === 1 ? { themeId: matches[0]!.id, themeSource: "name" } : { themeSource: "unknown" };
}

async function fetchEvents(
  ctx: Ctx,
  api: GoogleApi,
  account: string,
  calendarId: string,
  day: string,
  timeZone: string,
): Promise<CalendarEvent[]> {
  const from = zonedMidnight(day, timeZone);
  const to = zonedMidnight(addDays(day, 1), timeZone);
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await api.get<{ items?: GoogleEvent[] }>(
    account,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
  );
  const themes = listThemes(ctx);
  const rules = new Map(
    ctx.db
      .query<{ title_key: string; theme_id: string | null }, []>("SELECT title_key, theme_id FROM calendar_title_rules")
      .all()
      .map((row) => [row.title_key, row.theme_id ?? undefined] as const),
  );
  const hidden = new Set(
    ctx.db.query<{ event_id: string }, []>("SELECT event_id FROM hidden_events").all().map((row) => row.event_id),
  );
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const item of data.items ?? []) {
    const event = toEvent(item, from, to, timeZone, day);
    if (!event) continue;
    const key = `${normalizeName(event.title)}|${event.start}|${event.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (hidden.has(event.id)) continue;
    events.push({ ...event, ...themeForTitle(event.title, themes, rules) });
  }
  return events;
}

function toEvent(
  item: GoogleEvent,
  from: Date,
  to: Date,
  timeZone: string,
  day: string,
): Omit<CalendarEvent, "themeId" | "themeSource"> | undefined {
  if (item.status === "cancelled") return undefined;
  if (item.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "declined")) return undefined;
  const title = item.summary?.trim() || "(no title)";
  if (item.start?.date) {
    const start = item.start.date;
    const end = item.end?.date ?? addDays(start, 1);
    if (end <= day || start > day) return undefined;
    return { id: item.id, title, allDay: true, start, end, minutes: 0, blocking: false, description: item.description };
  }
  if (!item.start?.dateTime || !item.end?.dateTime) return undefined;
  const start = new Date(item.start.dateTime);
  const end = new Date(item.end.dateTime);
  const overlap = Math.max(0, Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime()));
  if (overlap === 0 && localDay(start, timeZone) > day) return undefined;
  return {
    id: item.id,
    title,
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
    minutes: Math.round(overlap / 60_000),
    blocking: item.transparency !== "transparent",
    description: item.description,
  };
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}
