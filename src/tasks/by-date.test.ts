import { describe, expect, it } from "bun:test";
import { groupByDate } from "./by-date.ts";

const today = "2026-10-25";

describe("groupByDate", () => {
  it("groups top-level tasks by deadline, soonest first, and keeps empty groups out", () => {
    const tasks = [
      { id: "none", deadline: undefined },
      { id: "later", deadline: "2026-11-20" },
      { id: "week", deadline: "2026-11-01" },
      { id: "overdue-old", deadline: "2026-10-01" },
      { id: "overdue", deadline: "2026-10-24" },
      { id: "today", deadline: "2026-10-25" },
      { id: "tomorrow", deadline: "2026-10-26" },
      { id: "sub", deadline: "2026-10-25", parentId: "today" },
      { id: "week-soon", deadline: "2026-10-28" },
    ];
    expect(groupByDate(tasks, today).map((group) => [group.label, group.tasks.map((t) => t.id)])).toEqual([
      ["Overdue", ["overdue-old", "overdue"]],
      ["Today", ["today"]],
      ["Tomorrow", ["tomorrow"]],
      ["Next 7 days", ["week-soon", "week"]],
      ["Later", ["later"]],
      ["No deadline", ["none"]],
    ]);
  });

  it("returns nothing for no tasks", () => {
    expect(groupByDate([], today)).toEqual([]);
  });
});
