import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { freshTestCtx } from "../../test/helpers.ts";
import { listThemes } from "../themes/themes.ts";
import { TEN_K_WEEK, trainingTemplate } from "../training/training.ts";
import { migrations } from "./migrations.ts";
import { migrate } from "./open.ts";

const TRAINING_VERSION = 7;

describe("migrations", () => {
  it("starts a fresh install with neutral themes and nothing flagged as scheduling only", () => {
    const themes = listThemes(freshTestCtx());
    expect(themes.map((t) => t.name)).toEqual(["Work", "Personal", "Exercise"]);
    expect(themes.map((t) => t.id)).toContain("exercise");
    expect(themes.some((t) => t.isAccounto)).toBe(false);
  });

  it("gives a fresh install no training template", () => {
    expect(trainingTemplate(freshTestCtx())).toEqual([]);
  });

  it("keeps the 10k week for an install that already trained with it", () => {
    const db = databaseAt(TRAINING_VERSION);
    db.exec(`INSERT INTO training_sessions (id, week_start, date, kind, created_at, updated_at)
      VALUES ('s1', '2026-10-12', '2026-10-12', 'strength', 'x', 'x')`);
    migrate(db);
    expect(trainingTemplate({ db, now: () => new Date(), newId: () => "id" })).toEqual(TEN_K_WEEK);
  });

  it("keeps the 10k week for an install in use from before training existed", () => {
    const db = databaseAt(1);
    db.exec("INSERT INTO passkeys (id, public_key, sign_count, label, created_at) VALUES ('p1', '{}', 0, 'Mac', 'x')");
    migrate(db);
    expect(trainingTemplate({ db, now: () => new Date(), newId: () => "id" })).toEqual(TEN_K_WEEK);
  });

  it("leaves the themes of an existing install as they were", () => {
    const db = databaseAt(TRAINING_VERSION);
    db.exec("INSERT INTO themes (id, name, color, sort_order, is_accounto) VALUES ('accounto', 'Accounto', '#2f6fde', 9, 1)");
    migrate(db);
    const ctx = { db, now: () => new Date(), newId: () => "id" };
    expect(listThemes(ctx).filter((t) => t.isAccounto).map((t) => t.name)).toEqual(["Accounto"]);
    expect(trainingTemplate(ctx)).toEqual([]);
  });
});

function databaseAt(version: number): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
  for (const sql of migrations.slice(0, version)) db.exec(sql);
  db.query("INSERT INTO schema_version (version) VALUES (?)").run(version);
  return db;
}
