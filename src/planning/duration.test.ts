import { describe, expect, it } from "bun:test";
import { parseDuration } from "./duration.ts";

describe("parseDuration", () => {
  it("reads a bare number as hours, with a dot or a comma", () => {
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration(".25")).toBe(15);
  });

  it("reads hours and minutes written out", () => {
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1 h 30 min")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration(" 3 H ")).toBe(180);
  });

  it("reads an empty field as no time", () => {
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("   ")).toBe(0);
    expect(parseDuration("0")).toBe(0);
  });

  it("rounds to whole minutes", () => {
    expect(parseDuration("0.33")).toBe(20);
  });

  it("rejects what it cannot read", () => {
    for (const text of ["abc", "-1", "1h-30", "2x", "1:75", "h", "1..5", "30m 1h"]) expect(parseDuration(text)).toBeUndefined();
  });
});
