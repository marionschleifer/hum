import { describe, expect, it } from "bun:test";
import { showsTodayButton } from "./today-button.ts";

const today = "2026-10-18";

describe("showsTodayButton", () => {
  it("hides the button on a task already in today's plan", () => {
    expect(showsTodayButton({ id: "a" }, today, new Set(["a"]))).toBe(false);
  });

  it("shows the button on a task that is not planned for today", () => {
    expect(showsTodayButton({ id: "b" }, today, new Set(["a"]))).toBe(true);
    expect(showsTodayButton({ id: "b", firstOn: "2026-10-19" }, today, new Set())).toBe(true);
  });

  it("hides the button on a task due today or overdue, which every plan includes anyway", () => {
    expect(showsTodayButton({ id: "a", deadline: today }, today, new Set())).toBe(false);
    expect(showsTodayButton({ id: "a", deadline: "2026-10-16" }, today, new Set())).toBe(false);
    expect(showsTodayButton({ id: "a", deadline: "2026-10-19" }, today, new Set())).toBe(true);
  });

  it("keeps the button on a task picked for today so it can be removed again", () => {
    expect(showsTodayButton({ id: "a", firstOn: today }, today, new Set(["a"]))).toBe(true);
  });
});
