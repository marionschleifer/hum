import type { Ctx } from "../src/context.ts";
import { openDatabase } from "../src/db/open.ts";
import { setTrainingTemplate, TEN_K_WEEK } from "../src/training/training.ts";

type TestCtx = Ctx & { advance: (ms: number) => void };

export function testCtx(start = "2026-10-17T08:00:00.000Z"): TestCtx {
  const ctx = freshTestCtx(start);
  useMarionsInstall(ctx);
  return ctx;
}

export function freshTestCtx(start = "2026-10-17T08:00:00.000Z"): TestCtx {
  let current = new Date(start).getTime();
  let counter = 0;
  return {
    db: openDatabase(":memory:"),
    now: () => new Date(current),
    newId: () => `id-${++counter}`,
    advance: (ms) => {
      current += ms;
    },
  };
}

function useMarionsInstall(ctx: Ctx): void {
  ctx.db.exec(`
    DELETE FROM themes;
    INSERT INTO themes (id, name, color, sort_order, is_accounto) VALUES
      ('accounto', 'Accounto', '#2f6fde', 1, 1),
      ('code-blossom', 'Code Blossom', '#d9468f', 2, 0),
      ('hvnly', 'hvnly', '#7a5af5', 3, 0),
      ('personal', 'Personal', '#2a9d8f', 4, 0),
      ('exercise', 'Exercise', '#e76f51', 5, 0);
  `);
  setTrainingTemplate(ctx, TEN_K_WEEK);
}
