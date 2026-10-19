import { describe, expect, it } from "bun:test";
import { captureRequest, createStructureCapture } from "./claude.ts";
import { createFindLearning, createSuggestForTasks, learnRequest, suggestRequest } from "./evening.ts";
import { choosePlanRequest, createChoosePlan, createParseBudgets, parseBudgetsRequest } from "./planning.ts";
import type { CaptureContext } from "./types.ts";
import { createTranscribe } from "./whisper.ts";

const context: CaptureContext = {
  today: "2026-10-17",
  weekday: "Saturday",
  themes: [
    { name: "Accounto", isAccounto: true },
    { name: "Personal", isAccounto: false },
  ],
  projects: [{ name: "Flat", theme: "Personal" }],
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("createStructureCapture", () => {
  it("sends a structured-output request and returns the tasks", async () => {
    const tasks = [{ title: "Call landlord", theme: "Personal", confident: true, subtasks: [] }];
    const { fn, calls } = fakeFetch(200, {
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ tasks }) }],
    });
    const structure = createStructureCapture({ apiKey: "test-key", model: "claude-sonnet-5-5", fetch: fn });
    expect(await structure("call the landlord", context)).toEqual(tasks);

    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(call.init.body));
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.properties.tasks.items.properties.theme.enum).toEqual(["Accounto", "Personal"]);
    expect(body.messages[0].content).toContain("<note>\ncall the landlord\n</note>");
    expect(body.messages[0].content).toContain("Today is Saturday, 2026-10-17.");
    expect(body.thinking).toBeUndefined();
  });

  it("throws on API errors, refusals and truncation", async () => {
    const make = (status: number, body: unknown) =>
      createStructureCapture({ apiKey: "k", model: "m", fetch: fakeFetch(status, body).fn });
    await expect(make(500, { error: { message: "overloaded" } })("x", context)).rejects.toThrow("Claude API 500: overloaded");
    await expect(make(200, { stop_reason: "refusal", content: [] })("x", context)).rejects.toThrow("declined");
    await expect(make(200, { stop_reason: "max_tokens", content: [] })("x", context)).rejects.toThrow("ran out of tokens");
    await expect(make(200, { stop_reason: "end_turn", content: [] })("x", context)).rejects.toThrow("no structured output");
  });
});

describe("the owner and the scheduling-only theme in prompts", () => {
  const personalOnly: CaptureContext = { ...context, themes: [{ name: "Personal", isAccounto: false }] };
  const planInput = (isAccounto: boolean) => ({
    today: "2026-10-17",
    weekday: "Saturday",
    energy: "normal",
    themes: [{ themeId: "a", name: isAccounto ? "Accounto" : "Garden", isAccounto, available: 60, meetings: [], pool: [] }],
  });
  const suggestInput = (isAccounto: boolean) => ({
    today: "2026-10-17",
    learnings: [],
    tasks: [{ taskId: "t1", title: "Fence", priority: "normal", essential: false, isAccounto, history: [], ruleAction: "do_first" }],
  });
  const learnInput = { today: "2026-10-17", learnings: [], postponements: [] };
  const everyPrompt = (ownerName?: string, isAccounto = false) => [
    captureRequest("m", "x", isAccounto ? context : personalOnly, ownerName),
    choosePlanRequest("m", planInput(isAccounto), ownerName),
    parseBudgetsRequest("m", "x", ["Personal"], ownerName),
    suggestRequest("m", suggestInput(isAccounto), ownerName),
    learnRequest("m", learnInput, ownerName),
  ];
  const sent = (request: { system: string; messages: { content: string }[] }) => request.system + request.messages[0]!.content;

  it("names the owner when one is configured", () => {
    for (const request of everyPrompt("Ada")) {
      expect(request.system).toContain("Ada");
      expect(request.system).not.toContain("Marion");
    }
  });

  it("speaks of the user when no owner is configured", () => {
    for (const request of everyPrompt()) {
      expect(request.system).toContain("the user");
      expect(request.system).not.toContain("Marion");
    }
  });

  it("never mentions Accounto, or any one person's themes, to an install without an Accounto theme", () => {
    for (const request of everyPrompt("Ada")) {
      expect(sent(request)).not.toContain("Accounto");
      expect(sent(request)).not.toContain("hvnly");
    }
  });

  it("keeps the scheduling-only rules where an Accounto theme is involved", () => {
    const [capture, plan, , suggest] = everyPrompt("Marion", true);
    expect(capture!.system).toContain("Accounto tasks are stored for scheduling only");
    expect(capture!.messages[0]!.content).toContain('Accounto theme(s): ["Accounto"]');
    expect(plan!.system).toContain("Accounto tasks are scheduling only");
    expect(suggest!.system).toContain("never write subtasks or advice for Accounto");
  });
});

describe("createTranscribe", () => {
  it("posts the audio to Whisper and returns the text", async () => {
    const { fn, calls } = fakeFetch(200, { text: " buy milk " });
    const transcribe = createTranscribe({ apiKey: "openai-key", model: "whisper-1", fetch: fn });
    expect(await transcribe(new Blob(["abc"], { type: "audio/mp4" }))).toBe("buy milk");
    const call = calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer openai-key");
    const form = call.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("audio.m4a");
  });

  it("throws on errors", async () => {
    const transcribe = createTranscribe({ apiKey: "k", model: "whisper-1", fetch: fakeFetch(401, { error: { message: "bad key" } }).fn });
    await expect(transcribe(new Blob(["abc"]))).rejects.toThrow("Whisper 401: bad key");
  });
});

describe("planning requests", () => {
  it("asks Claude to choose from the pool with the theme ids as an enum", () => {
    const request = choosePlanRequest("claude-opus-5-5", {
      today: "2026-10-17",
      weekday: "Saturday",
      energy: "lower",
      energyNote: "slept badly",
      themes: [{ themeId: "accounto", name: "Accounto", isAccounto: true, available: 60, meetings: [], pool: [] }],
    });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.output_config.format.schema.properties.themes.items.properties.themeId.enum).toEqual(["accounto"]);
    expect(request.messages[0]!.content).toContain("<energy_note>\nslept badly\n</energy_note>");
    expect(request.system).toContain("Never invent urgency");
    expect(request.messages[0]!.content).toContain("<learnings>\nNone yet.\n</learnings>");
  });

  it("asks Claude to read budgets with theme names as an enum", () => {
    const request = parseBudgetsRequest("claude-sonnet-5-5", "3h accounto", ["Accounto", "hvnly"]);
    expect(request.output_config.format.schema.properties.budgets.items.properties.theme.enum).toEqual(["Accounto", "hvnly"]);
    expect(request.messages[0]!.content).toContain("<morning_note>\n3h accounto\n</morning_note>");
  });

  it("returns parsed structured output through the shared sender", async () => {
    const { fn } = fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: '{"budgets":[]}' }] });
    expect(await createParseBudgets({ apiKey: "k", model: "m", fetch: fn })("x", ["A"])).toEqual({ budgets: [] });
    const choose = fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: '{"themes":[],"note":"ok"}' }] });
    expect(
      await createChoosePlan({ apiKey: "k", model: "m", fetch: choose.fn })({ today: "2026-10-17", weekday: "Saturday", energy: "normal", themes: [] }),
    ).toEqual({ themes: [], note: "ok" });
  });
});

describe("evening requests", () => {
  const task = {
    taskId: "t1",
    title: "Workflow",
    priority: "normal",
    essential: false,
    isAccounto: true,
    history: [{ date: "2026-10-17", reason: "no_time" }],
    ruleAction: "break_down",
  };

  it("asks for one action per postponed task with the task ids as an enum", () => {
    const request = suggestRequest("claude-sonnet-5-5", { today: "2026-10-17", learnings: ["A learning"], tasks: [task] });
    expect(request.output_config.format.schema.properties.suggestions.items.properties.taskId.enum).toEqual(["t1"]);
    expect(request.system).toContain("never write subtasks or advice for Accounto");
    expect(request.system).toContain("exactly one suggestion for every task");
    expect(request.messages[0]!.content).toContain("<learnings>\nA learning\n</learnings>");
  });

  it("asks for at most one new learning", () => {
    const request = learnRequest("claude-sonnet-5-5", { today: "2026-10-17", learnings: [], postponements: [] });
    expect(request.output_config.format.schema.properties).toHaveProperty("learning");
    expect(request.system).toContain("at least three postponements");
  });

  it("sends through the shared structured call", async () => {
    const { fn } = fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: '{"learning":"x"}' }] });
    expect(await createFindLearning({ apiKey: "k", model: "m", fetch: fn })({ today: "2026-10-17", learnings: [], postponements: [] })).toEqual({
      learning: "x",
    });
    const suggest = fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: '{"suggestions":[]}' }] });
    expect(await createSuggestForTasks({ apiKey: "k", model: "m", fetch: suggest.fn })({ today: "2026-10-17", learnings: [], tasks: [task] })).toEqual({
      suggestions: [],
    });
  });
});
