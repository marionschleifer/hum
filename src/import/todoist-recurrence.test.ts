import { describe, expect, it } from "bun:test";
import { parseTodoistRecurrence } from "./todoist-recurrence.ts";

describe("parseTodoistRecurrence", () => {
  it.each([
    ["every day", { kind: "every", interval: 1, unit: "day" }],
    ["daily", { kind: "every", interval: 1, unit: "day" }],
    ["every week", { kind: "every", interval: 1, unit: "week" }],
    ["every other week", { kind: "every", interval: 2, unit: "week" }],
    ["every 3 months", { kind: "every", interval: 3, unit: "month" }],
    ["every! 2 days", { kind: "every", interval: 2, unit: "day" }],
    ["every day at 9am", { kind: "every", interval: 1, unit: "day" }],
    ["every week starting oct 20", { kind: "every", interval: 1, unit: "week" }],
    ["every mon, fri", { kind: "weekdays", days: ["mon", "fri"] }],
    ["every Thursday and Monday", { kind: "weekdays", days: ["mon", "thu"] }],
    ["every tue 18:00", { kind: "weekdays", days: ["tue"] }],
    ["every weekday", { kind: "weekdays", days: ["mon", "tue", "wed", "thu", "fri"] }],
    ["every weekend", { kind: "weekdays", days: ["sat", "sun"] }],
    ["every 20th", { kind: "monthly", day: 20 }],
    ["every 1 of the month", { kind: "monthly", day: 1 }],
    ["every month on the 15th", { kind: "monthly", day: 15 }],
    ["every last day", { kind: "monthly", day: -1 }],
    ["every first workday", { kind: "monthly", workday: 1 }],
    ["every 1st working day of the month", { kind: "monthly", workday: 1 }],
    ["every last workday", { kind: "monthly", workday: -1 }],
  ])("reads %p", (input, expected) => {
    expect(parseTodoistRecurrence(input)).toEqual(expected as never);
  });

  it.each(["every year", "every 40th", "every last friday", "every 2nd monday"])("keeps %p as unparsed", (input) => {
    expect(parseTodoistRecurrence(input)).toEqual({ kind: "unparsed", text: input });
  });
});
