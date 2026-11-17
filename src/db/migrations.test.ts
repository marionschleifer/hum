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
    expect(themes.map((t) => t.name)).toEqual(["Work", "Personal", "Exercise", "Learning"]);
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

  it("keeps existing training sessions when it allows hikes", () => {
    const db = databaseAt(9);
    db.exec(`INSERT INTO training_sessions (id, week_start, date, kind, min_minutes, status, travel, note, created_at, updated_at)
      VALUES ('s1', '2026-10-12', '2026-10-12', 'strength', 60, 'done', 1, 'felt good', 'a', 'b')`);
    migrate(db);
    expect(db.query("SELECT id, kind, min_minutes, status, travel, note FROM training_sessions").all()).toEqual([
      { id: "s1", kind: "strength", min_minutes: 60, status: "done", travel: 1, note: "felt good" },
    ]);
    db.exec(`INSERT INTO training_sessions (id, week_start, date, kind, created_at, updated_at) VALUES ('s2', '2026-10-12', '2026-10-17', 'hike', 'a', 'b')`);
    expect(() => db.exec(`INSERT INTO training_sessions (id, week_start, date, kind, created_at, updated_at) VALUES ('s3', '2026-10-12', '2026-10-17', 'yoga', 'a', 'b')`)).toThrow();
  });

  it("adds a Learning theme after an existing install's own themes", () => {
    const db = databaseAt(10);
    db.exec("INSERT INTO themes (id, name, color, sort_order, is_accounto) VALUES ('hvnly', 'hvnly', '#7a5af5', 7, 0)");
    migrate(db);
    const learning = db.query<{ name: string; sort_order: number }, []>("SELECT name, sort_order FROM themes WHERE id = 'learning'").get();
    expect(learning).toEqual({ name: "Learning", sort_order: 8 });
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
