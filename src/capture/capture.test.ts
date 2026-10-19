import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import type { CaptureContext } from "../ai/types.ts";
import { listTasks } from "../tasks/tasks.ts";
import { captureAudio, captureText, describeCapture } from "./capture.ts";

const request = { source: "quick_add" as const, today: "2026-10-17" };

describe("captureText", () => {
  it("creates structured tasks with subtasks and logs the capture", async () => {
    const ctx = testCtx();
    let seen: CaptureContext | undefined;
    const structure = async (_text: string, context: CaptureContext) => {
      seen = context;
      return [
        { title: "Plan Lisbon trip", theme: "Code Blossom", confident: true, subtasks: ["Book flights", "Visa"] },
        { title: "Something vague", confident: false, subtasks: [] },
      ];
    };
    const result = await captureText({ ctx, structure }, "plan lisbon trip, flights and visa. also something vague", request);
    expect(result.usedFallback).toBe(false);
    expect(result.tasks.map((t) => [t.title, t.status])).toEqual([
      ["Plan Lisbon trip", "open"],
      ["Something vague", "inbox"],
    ]);
    expect(listTasks(ctx, { parentId: result.tasks[0]!.id }).map((t) => t.title)).toEqual(["Book flights", "Visa"]);
    expect(seen).toMatchObject({ today: "2026-10-17", weekday: "Saturday" });
    expect(seen?.themes.find((t) => t.isAccounto)?.name).toBe("Accounto");
    const log = ctx.db.query<{ raw_text: string; error: string | null }, []>("SELECT raw_text, error FROM captures").get();
    expect(log).toEqual({ raw_text: "plan lisbon trip, flights and visa. also something vague", error: null });
  });

  it("never loses a capture when the AI fails", async () => {
    const ctx = testCtx();
    const structure = async () => {
      throw new Error("network down");
    };
    const result = await captureText({ ctx, structure }, "renew passport", request);
    expect(result.usedFallback).toBe(true);
    expect(result.tasks).toMatchObject([{ title: "renew passport", status: "inbox" }]);
    const log = ctx.db.query<{ error: string }, []>("SELECT error FROM captures").get();
    expect(log?.error).toBe("network down");
  });

  it("falls back to the inbox without an API key", async () => {
    const result = await captureText({ ctx: testCtx() }, "renew passport", request);
    expect(result.tasks).toMatchObject([{ title: "renew passport", status: "inbox", source: "quick_add" }]);
  });

  it("falls back to the inbox when the AI finds no task", async () => {
    const result = await captureText({ ctx: testCtx(), structure: async () => [] }, "hmm", request);
    expect(result.tasks).toMatchObject([{ title: "hmm", status: "inbox" }]);
  });

  it("rejects empty captures", async () => {
    await expect(captureText({ ctx: testCtx() }, "  ", request)).rejects.toThrow("Nothing to capture");
  });
});

describe("captureAudio", () => {
  it("transcribes and then captures", async () => {
    const ctx = testCtx();
    const transcribe = async (audio: Blob) => `heard ${audio.size} bytes`;
    const result = await captureAudio({ ctx, transcribe }, new Blob(["abc"]), { ...request, source: "voice" });
    expect(result.transcript).toBe("heard 3 bytes");
    expect(result.tasks[0]?.source).toBe("voice");
  });

  it("needs a transcriber", async () => {
    await expect(captureAudio({ ctx: testCtx() }, new Blob(["abc"]), request)).rejects.toThrow("OPENAI_API_KEY");
  });

  it("rejects silence", async () => {
    const ctx = testCtx();
    await expect(captureAudio({ ctx, transcribe: async () => "" }, new Blob(["abc"]), request)).rejects.toThrow(
      "Could not hear anything",
    );
    await expect(captureAudio({ ctx, transcribe: async () => "x" }, new Blob([]), request)).rejects.toThrow("empty");
  });
});

describe("describeCapture", () => {
  it("summarizes where things went, for Siri to read out", async () => {
    const ctx = testCtx();
    const structure = async () => [
      { title: "A", theme: "Personal", confident: true, subtasks: ["a1"] },
      { title: "B", theme: "Personal", confident: true, subtasks: [] },
      { title: "C", confident: false, subtasks: [] },
    ];
    const result = await captureText({ ctx, structure }, "a b c", request);
    expect(describeCapture(result, (id) => (id === "personal" ? "Personal" : undefined))).toBe(
      "Added 3 tasks: 2 to Personal, 1 to the inbox.",
    );
  });
});
