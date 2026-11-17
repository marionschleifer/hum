import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import type { JudgeMailInput } from "../ai/mail.ts";
import type { GoogleApi } from "../google/google.ts";
import { getTask, listTasks } from "../tasks/tasks.ts";
import { lastMailRun, mailRunDue, runMailCheck } from "./check.ts";
import { addMailAccount, saveMailSettings } from "./settings.ts";
import type { GmailMessage, GmailThread } from "./threads.ts";

const me = "me@example.com";
const today = "2026-10-17";
const now = new Date("2026-10-17T08:00:00.000Z");
const daysAgo = (days: number) => String(now.getTime() - days * 86_400_000);

function message(id: string, from: string, to: string, days: number, subject = "Grant"): GmailMessage {
  return {
    id,
    internalDate: daysAgo(days),
    labelIds: from === me ? ["SENT"] : ["INBOX"],
    snippet: `text of ${id}`,
    payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }] },
  };
}

function fakeGmail(threads: GmailThread[]) {
  const calls: string[] = [];
  const api: GoogleApi = {
    get: async <T>(_email: string, url: string) => {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/threads")) {
        const q = parsed.searchParams.get("q") ?? "";
        const wanted = threads.filter((t) => (q.includes("in:sent") ? t.messages!.some((m) => m.labelIds?.includes("SENT")) : t.messages!.some((m) => m.labelIds?.includes("INBOX"))));
        return { threads: wanted.map((t) => ({ id: t.id })) } as T;
      }
      const id = parsed.pathname.split("/").at(-1)!;
      const thread = threads.find((t) => t.id === id);
      if (!thread) throw new Error("Google API 404: Not found");
      return thread as T;
    },
  };
  return { api, calls, threads };
}

function setup(threads: GmailThread[]) {
  const ctx = testCtx();
  addMailAccount(ctx, me);
  saveMailSettings(ctx, { accounts: [{ email: me, themeId: "code-blossom" }] });
  return { ctx, gmail: fakeGmail(threads) };
}

const judgeAll = (verdict: boolean, seen: JudgeMailInput[] = []) => async (input: JudgeMailInput) => {
  seen.push(input);
  return { verdicts: input.items.map((item) => ({ id: item.id, task: verdict, reason: `Reason for ${item.id}.` })) };
};

const gmailTasks = (ctx: ReturnType<typeof testCtx>) => listTasks(ctx, { status: ["open", "inbox", "done"] }, today).filter((t) => t.source === "gmail");

describe("runMailCheck", () => {
  it("turns a follow-up and a high-stakes mail into tasks in the account's theme, with a reason and a Gmail link", async () => {
    const { ctx, gmail } = setup([
      { id: "t1", messages: [message("m1", me, "Anna <anna@funder.org>", 12, "Grant form")] },
      { id: "t2", messages: [message("m2", "Ben <ben@partner.org>", me, 3, "Partnership")] },
    ]);
    const seen: JudgeMailInput[] = [];
    const summary = await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true, seen), now: () => now }, today);
    expect(seen[0]!.items.map((i) => i.id)).toEqual(["waiting:t1", "unanswered:t2"]);
    expect(gmailTasks(ctx).map((t) => [t.title, t.themeId, t.status])).toEqual([
      ["Follow up with Anna: Grant form", "code-blossom", "open"],
      ["Reply to Ben: Partnership", "code-blossom", "open"],
    ]);
    expect(gmailTasks(ctx)[0]!.notes).toBe(`Reason for waiting:t1.\n\nOpen in Gmail: https://mail.google.com/mail/u/${me}/#all/t1`);
    expect(summary.accounts).toEqual([{ email: me, checked: 2, created: 2, closed: 0 }]);
    expect(lastMailRun(ctx)?.accounts[0]?.created).toBe(2);
  });

  it("creates nothing when Claude says no, and does not ask again until the thread changes", async () => {
    const { ctx, gmail } = setup([{ id: "t1", messages: [message("m1", me, "anna@funder.org", 12)] }]);
    const seen: JudgeMailInput[] = [];
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(false, seen), now: () => now }, today);
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(false, seen), now: () => now }, today);
    expect(seen).toHaveLength(1);
    expect(gmailTasks(ctx)).toEqual([]);
    gmail.threads[0]!.messages!.push(message("m2", me, "anna@funder.org", 11));
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(false, seen), now: () => now }, today);
    expect(seen).toHaveLength(2);
  });

  it("makes a task for someone on the Always important list without asking Claude", async () => {
    const { ctx, gmail } = setup([{ id: "t2", messages: [message("m2", "Kilian <kilian@boss.org>", me, 3, "Contract")] }]);
    saveMailSettings(ctx, { important: ["kilian@boss.org"] });
    const seen: JudgeMailInput[] = [];
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(false, seen), now: () => now }, today);
    expect(seen).toEqual([]);
    expect(gmailTasks(ctx)[0]).toMatchObject({ title: "Reply to Kilian: Contract" });
    expect(gmailTasks(ctx)[0]!.notes).toStartWith("Kilian is on your Always important list.");
  });

  it("never creates a task twice for the same thread, even after it was dropped", async () => {
    const { ctx, gmail } = setup([{ id: "t1", messages: [message("m1", me, "anna@funder.org", 12)] }]);
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true), now: () => now }, today);
    ctx.db.query("UPDATE tasks SET status = 'dropped' WHERE source = 'gmail'").run();
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true), now: () => now }, today);
    expect(ctx.db.query("SELECT count(*) AS n FROM tasks WHERE source = 'gmail'").get()).toEqual({ n: 1 });
  });

  it("closes a follow-up once they answer, and a reply task once I answer", async () => {
    const { ctx, gmail } = setup([
      { id: "t1", messages: [message("m1", me, "anna@funder.org", 12)] },
      { id: "t2", messages: [message("m2", "ben@partner.org", me, 3)] },
    ]);
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true), now: () => now }, today);
    gmail.threads[0]!.messages!.push(message("m3", "anna@funder.org", me, 1));
    gmail.threads[1]!.messages!.push(message("m4", me, "ben@partner.org", 1));
    const summary = await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true), now: () => now }, today);
    expect(gmailTasks(ctx).map((t) => t.status)).toEqual(["done", "done"]);
    expect(summary.accounts[0]!.closed).toBe(2);
  });

  it("puts tasks into the inbox when the account has no theme, and skips judging without Claude", async () => {
    const { ctx, gmail } = setup([{ id: "t1", messages: [message("m1", me, "anna@funder.org", 12)] }]);
    saveMailSettings(ctx, { accounts: [{ email: me }], important: ["anna@funder.org"] });
    gmail.threads.push({ id: "t2", messages: [message("m2", "anna@funder.org", me, 3)] });
    await runMailCheck({ ctx, api: gmail.api, now: () => now }, today);
    expect(gmailTasks(ctx).map((t) => [t.title, t.status])).toEqual([["Reply to anna@funder.org: Grant", "inbox"]]);
  });

  it("records an account that fails and carries on", async () => {
    const { ctx } = setup([]);
    const broken: GoogleApi = { get: async () => { throw new Error("Google access expired or was revoked. Connect it again in Settings."); } };
    const summary = await runMailCheck({ ctx, api: broken, judge: judgeAll(true), now: () => now, log: () => {} }, today);
    expect(summary.accounts).toEqual([{ email: me, checked: 0, created: 0, closed: 0, error: "Google access expired or was revoked. Connect it again in Settings." }]);
  });

  it("makes no task when Claude fails, and tries again next time", async () => {
    const { ctx, gmail } = setup([{ id: "t1", messages: [message("m1", me, "anna@funder.org", 12)] }]);
    const failing = async () => { throw new Error("overloaded"); };
    await runMailCheck({ ctx, api: gmail.api, judge: failing, now: () => now, log: () => {} }, today);
    expect(gmailTasks(ctx)).toEqual([]);
    await runMailCheck({ ctx, api: gmail.api, judge: judgeAll(true), now: () => now }, today);
    expect(gmailTasks(ctx)).toHaveLength(1);
    expect(getTask(ctx, gmailTasks(ctx)[0]!.id)?.size).toBe("S");
  });
});

describe("mailRunDue", () => {
  it("is due without an earlier run, and again 20 hours after the last one", () => {
    expect(mailRunDue(undefined, now)).toBe(true);
    expect(mailRunDue({ at: "2026-10-16T13:00:00.000Z", accounts: [] }, now)).toBe(false);
    expect(mailRunDue({ at: "2026-10-16T12:00:00.000Z", accounts: [] }, now)).toBe(true);
  });
});
