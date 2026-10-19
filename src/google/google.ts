import { fail, isoNow, type Ctx } from "../context.ts";
import { randomToken } from "../auth/encoding.ts";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export type GoogleApi = {
  get: <T>(email: string, url: string) => Promise<T>;
};

export function authorizationUrl(ctx: Ctx, config: GoogleOAuthConfig): string {
  const state = randomToken(16);
  ctx.db.query("DELETE FROM oauth_states WHERE expires_at < ?").run(isoNow(ctx));
  ctx.db
    .query("INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)")
    .run(state, new Date(ctx.now().getTime() + STATE_TTL_MS).toISOString());
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeAuthorization(
  ctx: Ctx,
  config: GoogleOAuthConfig,
  query: { code?: string; state?: string; error?: string },
  send: typeof fetch = fetch,
): Promise<string> {
  if (query.error) fail(400, `Google said: ${query.error}`);
  const row = ctx.db
    .query<{ expires_at: string }, [string]>("DELETE FROM oauth_states WHERE state = ? RETURNING expires_at")
    .get(query.state ?? "");
  if (!row || row.expires_at < isoNow(ctx)) fail(400, "Sign-in link expired, please try again");
  if (!query.code) fail(400, "Google sent no code");
  const tokens = await tokenRequest(send, {
    code: query.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  if (!tokens.refresh_token) fail(400, "Google sent no refresh token. Remove Hum's access in your Google account and connect again.");
  if (!tokens.scope?.includes(CALENDAR_SCOPE)) fail(400, "Calendar access was not granted");
  const primary = await getJson<{ items?: { id: string; primary?: boolean }[] }>(
    send,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
    tokens.access_token,
  );
  const email = primary.items?.find((calendar) => calendar.primary)?.id ?? fail(400, "Could not find the primary calendar");
  ctx.db
    .query(
      `INSERT INTO google_accounts (email, refresh_token, scope, connected_at) VALUES ($email, $token, $scope, $at)
       ON CONFLICT(email) DO UPDATE SET refresh_token = $token, scope = $scope, connected_at = $at`,
    )
    .run({ email, token: tokens.refresh_token, scope: tokens.scope, at: isoNow(ctx) });
  return email;
}

export function connectedAccounts(ctx: Ctx): { email: string; connectedAt: string }[] {
  return ctx.db
    .query<{ email: string; connected_at: string }, []>("SELECT email, connected_at FROM google_accounts ORDER BY connected_at")
    .all()
    .map((row) => ({ email: row.email, connectedAt: row.connected_at }));
}

export function disconnectAccount(ctx: Ctx, email: string): void {
  ctx.db.query("DELETE FROM google_accounts WHERE email = ?").run(email);
}

export function createGoogleApi(ctx: Ctx, config: GoogleOAuthConfig, send: typeof fetch = fetch): GoogleApi {
  const cache = new Map<string, { token: string; expiresAt: number }>();
  const accessToken = async (email: string) => {
    const cached = cache.get(email);
    if (cached && cached.expiresAt > ctx.now().getTime() + 60_000) return cached.token;
    const row = ctx.db
      .query<{ refresh_token: string }, [string]>("SELECT refresh_token FROM google_accounts WHERE email = ?")
      .get(email);
    if (!row) fail(409, "Google Calendar is not connected");
    const tokens = await tokenRequest(send, {
      refresh_token: row.refresh_token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    });
    cache.set(email, { token: tokens.access_token, expiresAt: ctx.now().getTime() + (tokens.expires_in ?? 3600) * 1000 });
    return tokens.access_token;
  };
  return { get: async (email, url) => getJson(send, url, await accessToken(email)) };
}

type TokenResponse = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string };

async function tokenRequest(send: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  const response = await send("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    if (data.error === "invalid_grant") fail(409, "Google access expired or was revoked. Connect Google Calendar again in Settings.");
    throw new Error(`Google token ${response.status}: ${data.error_description ?? data.error ?? "unknown error"}`);
  }
  return data;
}

async function getJson<T>(send: typeof fetch, url: string, token: string): Promise<T> {
  const response = await send(url, { headers: { authorization: `Bearer ${token}` } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Google API ${response.status}: ${data.error?.message ?? "unknown error"}`);
  return data;
}
