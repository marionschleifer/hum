import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrations } from "./migrations.ts";

export type Db = Database;

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.query<{ version: number }, []>("SELECT version FROM schema_version").get();
  const current = row?.version ?? 0;
  const pending = migrations.slice(current);
  if (pending.length === 0) return;
  db.transaction(() => {
    for (const sql of pending) db.exec(sql);
    db.exec("DELETE FROM schema_version");
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(migrations.length);
  })();
}
