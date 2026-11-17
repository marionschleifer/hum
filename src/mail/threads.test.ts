import { describe, expect, it } from "bun:test";
import { classifyThread, parseAddress, type GmailMessage } from "./threads.ts";

const me = "me@example.com";
const now = new Date("2026-11-17T08:00:00Z");
const daysAgo = (days: number) => String(now.getTime() - days * 86_400_000);

function message(id: string, from: string, to: string, days: number, extra: { labels?: string[]; headers?: Record<string, string> } = {}): GmailMessage {
  const headers = { From: from, To: to, Subject: "Funding call", ...extra.headers };
  return {
    id,
    internalDate: daysAgo(days),
    labelIds: extra.labels ?? (from.includes(me) ? ["SENT"] : ["INBOX"]),
    snippet: `snippet of ${id}`,
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  };
}

describe("parseAddress", () => {
  it("reads names and addresses", () => {
    expect(parseAddress('"Anna Muster" <Anna@Funder.org>')).toEqual({ name: "Anna Muster", email: "anna@funder.org" });
    expect(parseAddress("anna@funder.org")).toEqual({ email: "anna@funder.org" });
    expect(parseAddress("Anna <anna@funder.org>, Ben <ben@x.org>")).toEqual({ name: "Anna", email: "anna@funder.org" });
  });
});

describe("classifyThread", () => {
  it("finds a mail of mine that has waited 10 days for an answer", () => {
    const thread = { id: "t1", messages: [message("m1", "Anna <anna@funder.org>", me, 15), message("m2", `Me <${me}>`, "Anna <anna@funder.org>", 11)] };
    expect(classifyThread(thread, me, now)).toEqual({
      kind: "waiting",
      account: me,
      threadId: "t1",
      messageId: "m2",
      counterpart: { name: "Anna", email: "anna@funder.org" },
      subject: "Funding call",
      snippet: "snippet of m2",
      at: new Date(Number(daysAgo(11))).toISOString(),
    });
  });

  it("waits until 10 days have passed, and stops looking after 30", () => {
    const fresh = { id: "t", messages: [message("m", me, "anna@funder.org", 9)] };
    const old = { id: "t", messages: [message("m", me, "anna@funder.org", 31)] };
    expect(classifyThread(fresh, me, now)).toBeUndefined();
    expect(classifyThread(old, me, now)).toBeUndefined();
  });

  it("does not wait for answers from noreply addresses or from myself", () => {
    expect(classifyThread({ id: "t", messages: [message("m", me, "no-reply@service.com", 12)] }, me, now)).toBeUndefined();
    expect(classifyThread({ id: "t", messages: [message("m", me, me, 12)] }, me, now)).toBeUndefined();
  });

  it("finds a mail from a person I have not answered after 2 days", () => {
    const thread = { id: "t2", messages: [message("m1", "Ben <ben@partner.org>", me, 3)] };
    expect(classifyThread(thread, me, now)).toMatchObject({ kind: "unanswered", messageId: "m1", counterpart: { name: "Ben", email: "ben@partner.org" } });
  });

  it("gives a fresh mail time, and stops looking after 14 days", () => {
    expect(classifyThread({ id: "t", messages: [message("m", "ben@partner.org", me, 1)] }, me, now)).toBeUndefined();
    expect(classifyThread({ id: "t", messages: [message("m", "ben@partner.org", me, 15)] }, me, now)).toBeUndefined();
  });

  it("skips newsletters, automatic mails, noreply senders and mails no longer in the inbox", () => {
    const skip = (extra: Parameters<typeof message>[4], from = "ben@partner.org") =>
      classifyThread({ id: "t", messages: [message("m", from, me, 3, extra)] }, me, now);
    expect(skip({ headers: { "List-Unsubscribe": "<mailto:x>" } })).toBeUndefined();
    expect(skip({ headers: { "Auto-Submitted": "auto-generated" } })).toBeUndefined();
    expect(skip({ headers: { Precedence: "bulk" } })).toBeUndefined();
    expect(skip({}, "notifications@github.com")).toBeUndefined();
    expect(skip({ labels: [] })).toBeUndefined();
  });

  it("knows a thread I answered last is no longer unanswered", () => {
    const thread = { id: "t", messages: [message("m1", "ben@partner.org", me, 5), message("m2", me, "ben@partner.org", 4)] };
    expect(classifyThread(thread, me, now)?.kind).not.toBe("unanswered");
  });
});
