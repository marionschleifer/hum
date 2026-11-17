import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import { addMailAccount, mailSettings, removeMailAccount, saveMailSettings } from "./settings.ts";

describe("mail settings", () => {
  it("starts empty", () => {
    expect(mailSettings(testCtx())).toEqual({ accounts: [], important: [], stakes: "" });
  });

  it("adds each mailbox once and remembers its theme", () => {
    const ctx = testCtx();
    addMailAccount(ctx, "me@example.com");
    addMailAccount(ctx, "me@blossom.example");
    addMailAccount(ctx, "me@example.com");
    saveMailSettings(ctx, { accounts: [{ email: "me@example.com", themeId: "personal" }, { email: "me@blossom.example", themeId: "code-blossom" }] });
    expect(mailSettings(ctx).accounts).toEqual([
      { email: "me@example.com", themeId: "personal" },
      { email: "me@blossom.example", themeId: "code-blossom" },
    ]);
    removeMailAccount(ctx, "me@example.com");
    expect(mailSettings(ctx).accounts.map((a) => a.email)).toEqual(["me@blossom.example"]);
  });

  it("keeps the Always important list tidy", () => {
    const ctx = testCtx();
    expect(saveMailSettings(ctx, { important: [" Anna@Funder.org ", "", "anna@funder.org", "Kilian"] }).important).toEqual([
      "anna@funder.org",
      "kilian",
    ]);
  });

  it("remembers what counts as high stakes", () => {
    expect(saveMailSettings(testCtx(), { stakes: "  career, funding  " }).stakes).toBe("career, funding");
  });

  it("only takes known themes and mailboxes Hum has connected", () => {
    const ctx = testCtx();
    addMailAccount(ctx, "me@example.com");
    expect(() => saveMailSettings(ctx, { accounts: [{ email: "me@example.com", themeId: "nope" }] })).toThrow("Unknown theme");
    expect(() => saveMailSettings(ctx, { accounts: [{ email: "other@example.com" }] })).toThrow("not connected");
  });
});
