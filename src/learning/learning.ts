import { fail, type Ctx } from "../context.ts";
import { flag, text, type Row } from "../db/rows.ts";
import { completeTask, createTask, getTask, reopenTask, type Task } from "../tasks/tasks.ts";
import { listThemes } from "../themes/themes.ts";

export const LEARNING_THEME_ID = "learning";
export const learningKinds = ["task", "book", "video"] as const;
export type LearningKind = (typeof learningKinds)[number];
export const bookStatuses = ["to_read", "reading", "done"] as const;
export type BookStatus = (typeof bookStatuses)[number];

export type LearningItem = Task & { kind: LearningKind; url?: string; reading: boolean };

export type LearningList = {
  reading: LearningItem[];
  videos: LearningItem[];
  tasks: LearningItem[];
  toRead: LearningItem[];
  read: LearningItem[];
};

const READ_SHOWN = 20;
const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];
const TITLE_TIMEOUT_MS = 5000;

export function addLearningItem(ctx: Ctx, input: { kind: LearningKind; title?: string; url?: string }): LearningItem {
  if (!learningKinds.includes(input.kind)) fail(400, "Invalid kind");
  requireLearningTheme(ctx);
  const url = input.kind === "video" ? webLink(input.url) : undefined;
  const title = input.title?.trim() || url || fail(400, "Title is required");
  const task = createTask(ctx, { title, themeId: LEARNING_THEME_ID, source: "manual" });
  ctx.db.query("UPDATE tasks SET kind = ?, url = ? WHERE id = ?").run(input.kind, url ?? null, task.id);
  return getItem(ctx, task.id);
}

export function setBookStatus(ctx: Ctx, id: string, status: BookStatus, today: string): LearningItem {
  if (!bookStatuses.includes(status)) fail(400, "Invalid book status");
  const item = getItem(ctx, id);
  if (item.kind !== "book") fail(400, "Not a book");
  ctx.db.transaction(() => {
    if (status === "done" && item.status !== "done") completeTask(ctx, id, today);
    if (status !== "done" && item.status === "done") reopenTask(ctx, id, today);
    ctx.db.query("UPDATE tasks SET reading = ? WHERE id = ?").run(status === "reading" ? 1 : 0, id);
  })();
  return getItem(ctx, id);
}

export function listLearning(ctx: Ctx): LearningList {
  const items = ctx.db
    .query<Row, [string]>(
      "SELECT * FROM tasks WHERE theme_id = ? AND parent_id IS NULL AND status IN ('open', 'done') ORDER BY created_at, id",
    )
    .all(LEARNING_THEME_ID)
    .map((row) => toItem(ctx, row));
  const open = items.filter((item) => item.status === "open");
  return {
    reading: open.filter((item) => item.kind === "book" && item.reading),
    videos: open.filter((item) => item.kind === "video"),
    tasks: open.filter((item) => item.kind === "task"),
    toRead: open.filter((item) => item.kind === "book" && !item.reading),
    read: items
      .filter((item) => item.kind === "book" && item.status === "done")
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
      .slice(0, READ_SHOWN),
  };
}

export async function youtubeTitle(url: string, send: typeof fetch = fetch): Promise<string | undefined> {
  try {
    if (!YOUTUBE_HOSTS.includes(new URL(url).hostname)) return undefined;
    const response = await send(`https://www.youtube.com/oembed?${new URLSearchParams({ format: "json", url })}`, {
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { title?: unknown };
    return typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function requireLearningTheme(ctx: Ctx): void {
  if (!listThemes(ctx).some((theme) => theme.id === LEARNING_THEME_ID)) fail(409, "No Learning theme");
}

function webLink(value: string | undefined): string {
  try {
    const url = new URL(value?.trim() ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {}
  return fail(400, "Paste the video's link");
}

function getItem(ctx: Ctx, id: string): LearningItem {
  const row = ctx.db.query<Row, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? toItem(ctx, row) : fail(404, "Task not found");
}

function toItem(ctx: Ctx, row: Row): LearningItem {
  return { ...getTask(ctx, String(row.id))!, kind: row.kind as LearningKind, url: text(row.url), reading: flag(row.reading) };
}
