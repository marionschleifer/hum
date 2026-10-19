import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { addLearning, deleteLearning, learningTexts, listLearnings, updateLearning } from "./learnings.ts";

describe("learnings", () => {
  it("adds, edits and deletes plain-language notes, newest first", () => {
    const ctx = testCtx();
    const first = addLearning(ctx, "  Half-day Accounto tasks slip   when the budget is under 3h. ", "evening");
    ctx.advance(1000);
    addLearning(ctx, "Strength works best after easy runs.", "manual");
    expect(first.text).toBe("Half-day Accounto tasks slip when the budget is under 3h.");
    expect(learningTexts(ctx)).toEqual(["Strength works best after easy runs.", first.text]);
    expect(updateLearning(ctx, first.id, "Big Accounto tasks need 3h or more.")).toMatchObject({
      text: "Big Accounto tasks need 3h or more.",
      updatedAt: "2026-10-17T08:00:01.000Z",
    });
    deleteLearning(ctx, first.id);
    expect(listLearnings(ctx).map((l) => l.source)).toEqual(["manual"]);
  });

  it("validates", () => {
    const ctx = testCtx();
    expect(() => addLearning(ctx, " ", "manual")).toThrow("needs some text");
    expect(() => updateLearning(ctx, "nope", "x")).toThrow("not found");
    expect(() => deleteLearning(ctx, "nope")).toThrow("not found");
    expect(addLearning(ctx, "x".repeat(900), "manual").text.length).toBe(500);
  });
});
