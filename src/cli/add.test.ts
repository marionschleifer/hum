import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { createApp } from "../app.ts";
import { createApiToken } from "../auth/sessions.ts";
import { listTasks } from "../tasks/tasks.ts";
import { addTask } from "./add.ts";

function hum() {
  const ctx = testCtx();
  const app = createApp({ ctx, config: { origin: "http://localhost:3000", rpId: "localhost" } });
  const send = (async (url: string, init?: RequestInit) => (await app.fetch(new Request(url, init)))!) as typeof fetch;
  return { ctx, send, token: createApiToken(ctx, "Accounto sessions").token };
}

describe("addTask", () => {
  it("adds a task through the token-protected capture endpoint", async () => {
    const { ctx, send, token } = hum();
    const message = await addTask("Build workflow x for customer y", { url: "http://localhost:3000/", token, fetch: send, today: "2026-10-17" });
    expect(message).toBe("Added 1 task: 1 to the inbox.");
    expect(listTasks(ctx)).toMatchObject([{ title: "Build workflow x for customer y", source: "cli", status: "inbox" }]);
  });

  it("explains a missing or wrong token", async () => {
    const { send } = hum();
    await expect(addTask("x", { url: "http://localhost:3000", fetch: send })).rejects.toThrow("Set HUM_API_TOKEN");
    await expect(addTask("x", { url: "http://localhost:3000", token: "hum_wrong", fetch: send })).rejects.toThrow("Invalid token");
  });

  it("needs some text", async () => {
    const { send, token } = hum();
    await expect(addTask("  ", { url: "http://localhost:3000", token, fetch: send })).rejects.toThrow("Usage");
  });
});
