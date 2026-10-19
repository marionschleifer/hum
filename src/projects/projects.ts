import { fail, isoNow, type Ctx } from "../context.ts";
import { text, type Row } from "../db/rows.ts";
import { getTheme, normalizeName } from "../themes/themes.ts";

export type Project = {
  id: string;
  themeId: string;
  name: string;
  sortOrder: number;
  sourceRef?: string;
  archivedAt?: string;
};

export type ProjectInput = { themeId: string; name: string; sourceRef?: string };
export type ProjectPatch = { themeId?: string; name?: string; sortOrder?: number; archived?: boolean };

export function listProjects(ctx: Ctx, options: { themeId?: string; includeArchived?: boolean } = {}): Project[] {
  const rows = ctx.db
    .query<Row, { theme: string | null; all: number }>(
      `SELECT * FROM projects
       WHERE ($theme IS NULL OR theme_id = $theme) AND ($all = 1 OR archived_at IS NULL)
       ORDER BY sort_order, name`,
    )
    .all({ theme: options.themeId ?? null, all: options.includeArchived ? 1 : 0 });
  return rows.map(toProject);
}

export function getProject(ctx: Ctx, id: string): Project | undefined {
  const row = ctx.db.query<Row, [string]>("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? toProject(row) : undefined;
}

export function createProject(ctx: Ctx, input: ProjectInput): Project {
  if (!getTheme(ctx, input.themeId)) fail(400, "Unknown theme");
  const name = input.name?.trim() || fail(400, "Name is required");
  const next = ctx.db
    .query<{ n: number }, [string]>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM projects WHERE theme_id = ?")
    .get(input.themeId)!.n;
  const id = ctx.newId();
  ctx.db
    .query(
      "INSERT INTO projects (id, theme_id, name, sort_order, source_ref) VALUES ($id, $theme, $name, $sort, $ref)",
    )
    .run({ id, theme: input.themeId, name, sort: next, ref: input.sourceRef ?? null });
  return getProject(ctx, id)!;
}

export function updateProject(ctx: Ctx, id: string, patch: ProjectPatch): Project {
  const project = getProject(ctx, id) ?? fail(404, "Project not found");
  if (patch.themeId !== undefined && !getTheme(ctx, patch.themeId)) fail(400, "Unknown theme");
  const archivedAt =
    patch.archived === undefined ? project.archivedAt : patch.archived ? isoNow(ctx) : undefined;
  const themeId = patch.themeId ?? project.themeId;
  ctx.db.transaction(() => {
    ctx.db
      .query(
        "UPDATE projects SET theme_id = $theme, name = $name, sort_order = $sort, archived_at = $archived WHERE id = $id",
      )
      .run({
        id,
        theme: themeId,
        name: patch.name?.trim() || project.name,
        sort: patch.sortOrder ?? project.sortOrder,
        archived: archivedAt ?? null,
      });
    if (themeId !== project.themeId) {
      ctx.db.query("UPDATE tasks SET theme_id = $theme WHERE project_id = $id").run({ theme: themeId, id });
    }
  })();
  return getProject(ctx, id)!;
}

export function findProjectByName(ctx: Ctx, themeId: string, name: string): Project | undefined {
  const wanted = normalizeName(name);
  return listProjects(ctx, { themeId }).find((project) => normalizeName(project.name) === wanted);
}

function toProject(row: Row): Project {
  return {
    id: String(row.id),
    themeId: String(row.theme_id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    sourceRef: text(row.source_ref),
    archivedAt: text(row.archived_at),
  };
}
