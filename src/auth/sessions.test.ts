import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import {
  createApiToken,
  createSession,
  endSession,
  hasValidApiToken,
  hasValidSession,
  listApiTokens,
  revokeApiToken,
  sessionCookie,
} from "./sessions.ts";

function withCookie(token: string) {
  return new Request("http://localhost/", { headers: { cookie: `other=1; hum_session=${token}` } });
}

function withBearer(token: string) {
  return new Request("http://localhost/", { headers: { authorization: `Bearer ${token}` } });
}

describe("sessions", () => {
  it("accepts a fresh session and rejects unknown ones", () => {
    const ctx = testCtx();
    const { token } = createSession(ctx);
    expect(hasValidSession(ctx, withCookie(token))).toBe(true);
    expect(hasValidSession(ctx, withCookie("nope"))).toBe(false);
    expect(hasValidSession(ctx, new Request("http://localhost/"))).toBe(false);
  });

  it("expires after 180 days", () => {
    const ctx = testCtx();
    const { token } = createSession(ctx);
    ctx.advance(181 * 24 * 60 * 60 * 1000);
    expect(hasValidSession(ctx, withCookie(token))).toBe(false);
  });

  it("ends on logout", () => {
    const ctx = testCtx();
    const { token } = createSession(ctx);
    endSession(ctx, withCookie(token));
    expect(hasValidSession(ctx, withCookie(token))).toBe(false);
  });

  it("builds a locked-down cookie", () => {
    expect(sessionCookie("abc", 60, true)).toBe("hum_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
    expect(sessionCookie("abc", 60, false)).not.toContain("Secure");
  });
});

describe("API tokens", () => {
  it("authenticates by bearer token and records use", () => {
    const ctx = testCtx();
    const { token, apiToken } = createApiToken(ctx, "iPhone Shortcut");
    expect(token.startsWith("hum_")).toBe(true);
    expect(hasValidApiToken(ctx, withBearer(token))).toBe(true);
    expect(hasValidApiToken(ctx, withBearer("hum_wrong"))).toBe(false);
    expect(listApiTokens(ctx)).toEqual([{ ...apiToken, lastUsedAt: "2026-10-17T08:00:00.000Z" }]);
  });

  it("stops working when revoked", () => {
    const ctx = testCtx();
    const { token, apiToken } = createApiToken(ctx, "Shortcut");
    revokeApiToken(ctx, apiToken.id);
    expect(hasValidApiToken(ctx, withBearer(token))).toBe(false);
  });
});
