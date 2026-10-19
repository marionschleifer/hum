import { fail, isoNow, type Ctx } from "../context.ts";
import { flag, text, type Row } from "../db/rows.ts";

export type Theme = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isAccounto: boolean;
  archivedAt?: string;
};

export type ThemeInput = { name: string; color?: string; isAccounto?: boolean };
export type ThemePatch = { name?: string; color?: string; sortOrder?: number; archived?: boolean };

export function listThemes(ctx: Ctx, options: { includeArchived?: boolean } = {}): Theme[] {
  const where = options.includeArchived ? "" : "WHERE archived_at IS NULL";
  return ctx.db.query<Row, []>(`SELECT * FROM themes ${where} ORDER BY sort_order, name`).all().map(toTheme);
}

export function getTheme(ctx: Ctx, id: string): Theme | undefined {
  const row = ctx.db.query<Row, [string]>("SELECT * FROM themes WHERE id = ?").get(id);
  return row ? toTheme(row) : undefined;
}

export function createTheme(ctx: Ctx, input: ThemeInput): Theme {
  const name = requireName(input.name);
  const next = ctx.db.query<{ n: number }, []>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM themes").get()!.n;
  const id = ctx.newId();
  ctx.db
    .query("INSERT INTO themes (id, name, color, sort_order, is_accounto) VALUES ($id, $name, $color, $sort, $accounto)")
    .run({ id, name, color: input.color ?? "#888888", sort: next, accounto: input.isAccounto ? 1 : 0 });
  return getTheme(ctx, id)!;
}

export function updateTheme(ctx: Ctx, id: string, patch: ThemePatch): Theme {
  const theme = getTheme(ctx, id) ?? fail(404, "Theme not found");
  const archivedAt = patch.archived === undefined ? theme.archivedAt : patch.archived ? isoNow(ctx) : undefined;
  ctx.db
    .query("UPDATE themes SET name = $name, color = $color, sort_order = $sort, archived_at = $archived WHERE id = $id")
    .run({
      id,
      name: patch.name === undefined ? theme.name : requireName(patch.name),
      color: patch.color ?? theme.color,
      sort: patch.sortOrder ?? theme.sortOrder,
      archived: archivedAt ?? null,
    });
  return getTheme(ctx, id)!;
}

export function findThemeByName(ctx: Ctx, name: string): Theme | undefined {
  const wanted = normalizeName(name);
  return listThemes(ctx).find((theme) => normalizeName(theme.name) === wanted);
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function requireName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) fail(400, "Name is required");
  return trimmed;
}

function toTheme(row: Row): Theme {
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    sortOrder: Number(row.sort_order),
    isAccounto: flag(row.is_accounto),
    archivedAt: text(row.archived_at),
  };
}
