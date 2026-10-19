import { fail, isoNow, type Ctx } from "../context.ts";

export type Learning = { id: string; text: string; source: "evening" | "manual"; createdAt: string; updatedAt: string };

const MAX_LENGTH = 500;

export function listLearnings(ctx: Ctx): Learning[] {
  return ctx.db
    .query<{ id: string; text: string; source: Learning["source"]; created_at: string; updated_at: string }, []>(
      "SELECT * FROM learnings ORDER BY created_at DESC",
    )
    .all()
    .map((row) => ({ id: row.id, text: row.text, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function addLearning(ctx: Ctx, text: string, source: Learning["source"]): Learning {
  const clean = cleanText(text);
  const id = ctx.newId();
  const now = isoNow(ctx);
  ctx.db.query("INSERT INTO learnings (id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, clean, source, now, now);
  return { id, text: clean, source, createdAt: now, updatedAt: now };
}

export function updateLearning(ctx: Ctx, id: string, text: string): Learning {
  const clean = cleanText(text);
  const result = ctx.db.query("UPDATE learnings SET text = ?, updated_at = ? WHERE id = ?").run(clean, isoNow(ctx), id);
  if (result.changes === 0) fail(404, "Learning not found");
  return listLearnings(ctx).find((learning) => learning.id === id)!;
}

export function deleteLearning(ctx: Ctx, id: string): void {
  if (ctx.db.query("DELETE FROM learnings WHERE id = ?").run(id).changes === 0) fail(404, "Learning not found");
}

export function learningTexts(ctx: Ctx): string[] {
  return listLearnings(ctx).map((learning) => learning.text);
}

function cleanText(text: string): string {
  const clean = text?.trim().replace(/\s+/g, " ");
  if (!clean) fail(400, "A learning needs some text");
  return clean.slice(0, MAX_LENGTH);
}
