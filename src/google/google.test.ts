import { describe, expect, it } from "bun:test";
import { testCtx } from "../../test/helpers.ts";
import {
  CALENDAR_SCOPE,
  authorizationUrl,
  completeAuthorization,
  connectedAccounts,
  createGoogleApi,
  disconnectAccount,
} from "./google.ts";

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost:3000/api/google/callback" };

function fakeGoogle(overrides: { token?: Record<string, unknown>; tokenStatus?: number } = {}) {
  const calls: { url: string; body?: string; auth?: string }[] = [];
  const send = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined, auth: (init?.headers as Record<string, string>)?.authorization });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json(
        overrides.token ?? { access_token: "access-1", expires_in: 3600, refresh_token: "refresh-1", scope: CALENDAR_SCOPE },
        { status: overrides.tokenStatus ?? 200 },
      );
    }
    if (url.includes("calendarList")) return Response.json({ items: [{ id: "marion@example.com", primary: true }, { id: "other" }] });
    return Response.json({ ok: true, url });
  }) as typeof fetch;
  return { send, calls };
}

function stateFrom(url: string): string {
  return new URL(url).searchParams.get("state")!;
}

describe("Google sign-in", () => {
  it("builds a read-only, offline consent URL", () => {
    const url = new URL(authorizationUrl(testCtx(), config));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(CALENDAR_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("exchanges the code and stores the account", async () => {
    const ctx = testCtx();
    const { send, calls } = fakeGoogle();
    const state = stateFrom(authorizationUrl(ctx, config));
    expect(await completeAuthorization(ctx, config, { code: "abc", state }, send)).toBe("marion@example.com");
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[0]?.body).toContain("code=abc");
    expect(calls[1]?.auth).toBe("Bearer access-1");
    expect(connectedAccounts(ctx)).toEqual([{ email: "marion@example.com", connectedAt: "2026-10-17T08:00:00.000Z" }]);
  });

  it("rejects unknown, reused or expired states", async () => {
    const ctx = testCtx();
    const { send } = fakeGoogle();
    await expect(completeAuthorization(ctx, config, { code: "abc", state: "made-up" }, send)).rejects.toThrow("expired");
    const state = stateFrom(authorizationUrl(ctx, config));
    await completeAuthorization(ctx, config, { code: "abc", state }, send);
    await expect(completeAuthorization(ctx, config, { code: "abc", state }, send)).rejects.toThrow("expired");
    const late = stateFrom(authorizationUrl(ctx, config));
    ctx.advance(11 * 60 * 1000);
    await expect(completeAuthorization(ctx, config, { code: "abc", state: late }, send)).rejects.toThrow("expired");
  });

  it("refuses when calendar access was not granted or no refresh token came back", async () => {
    const ctx = testCtx();
    const noScope = fakeGoogle({ token: { access_token: "a", refresh_token: "r", scope: "openid" } });
    await expect(
      completeAuthorization(ctx, config, { code: "abc", state: stateFrom(authorizationUrl(ctx, config)) }, noScope.send),
    ).rejects.toThrow("Calendar access was not granted");
    const noRefresh = fakeGoogle({ token: { access_token: "a", scope: CALENDAR_SCOPE } });
    await expect(
      completeAuthorization(ctx, config, { code: "abc", state: stateFrom(authorizationUrl(ctx, config)) }, noRefresh.send),
    ).rejects.toThrow("no refresh token");
  });

  it("passes on Google's error", async () => {
    await expect(completeAuthorization(testCtx(), config, { error: "access_denied" })).rejects.toThrow("access_denied");
  });

  it("disconnects", async () => {
    const ctx = testCtx();
    const { send } = fakeGoogle();
    await completeAuthorization(ctx, config, { code: "abc", state: stateFrom(authorizationUrl(ctx, config)) }, send);
    disconnectAccount(ctx, "marion@example.com");
    expect(connectedAccounts(ctx)).toEqual([]);
  });
});

describe("createGoogleApi", () => {
  async function connected() {
    const ctx = testCtx();
    const google = fakeGoogle();
    await completeAuthorization(ctx, config, { code: "abc", state: stateFrom(authorizationUrl(ctx, config)) }, google.send);
    google.calls.length = 0;
    return { ctx, ...google };
  }

  it("refreshes the access token once and reuses it until it expires", async () => {
    const { ctx, send, calls } = await connected();
    const api = createGoogleApi(ctx, config, send);
    await api.get("marion@example.com", "https://www.googleapis.com/x");
    await api.get("marion@example.com", "https://www.googleapis.com/y");
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    expect(calls[0]?.body).toContain("grant_type=refresh_token");
    expect(calls[0]?.body).toContain("refresh_token=refresh-1");
    ctx.advance(3600 * 1000);
    await api.get("marion@example.com", "https://www.googleapis.com/z");
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(2);
  });

  it("asks to reconnect when access was revoked", async () => {
    const { ctx } = await connected();
    const revoked = fakeGoogle({ token: { error: "invalid_grant" }, tokenStatus: 400 });
    const api = createGoogleApi(ctx, config, revoked.send);
    await expect(api.get("marion@example.com", "https://www.googleapis.com/x")).rejects.toThrow("Connect Google Calendar again");
  });

  it("needs a connected account", async () => {
    const api = createGoogleApi(testCtx(), config, fakeGoogle().send);
    await expect(api.get("nobody@example.com", "https://www.googleapis.com/x")).rejects.toThrow("not connected");
  });
});
