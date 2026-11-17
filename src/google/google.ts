import { fail, isoNow, type Ctx } from "../context.ts";
import { randomToken } from "../auth/encoding.ts";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export type GooglePurpose = "calendar" | "mail";

export type GoogleApi = {
  get: <T>(email: string, url: string) => Promise<T>;
};

export function authorizationUrl(ctx: Ctx, config: GoogleOAuthConfig, purpose: GooglePurpose = "calendar"): string {
  const state = randomToken(16);
  ctx.db.query("DELETE FROM oauth_states WHERE expires_at < ?").run(isoNow(ctx));
  ctx.db
    .query("INSERT INTO oauth_states (state, expires_at, purpose) VALUES (?, ?, ?)")
    .run(state, new Date(ctx.now().getTime() + STATE_TTL_MS).toISOString(), purpose);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: purpose === "mail" ? GMAIL_SCOPE : CALENDAR_SCOPE,
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
): Promise<{ email: string; purpose: GooglePurpose }> {
  if (query.error) fail(400, `Google said: ${query.error}`);
  const row = ctx.db
    .query<{ expires_at: string; purpose: GooglePurpose }, [string]>("DELETE FROM oauth_states WHERE state = ? RETURNING expires_at, purpose")
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
  const email = row.purpose === "mail" ? await mailboxEmail(send, tokens) : await calendarEmail(send, tokens);
  ctx.db
    .query(
      `INSERT INTO google_accounts (email, refresh_token, scope, connected_at) VALUES ($email, $token, $scope, $at)
       ON CONFLICT(email) DO UPDATE SET refresh_token = $token, scope = $scope, connected_at = $at`,
    )
    .run({ email, token: tokens.refresh_token, scope: tokens.scope, at: isoNow(ctx) });
  return { email, purpose: row.purpose };
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
    if (!row) fail(409, "This Google account is not connected");
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

async function calendarEmail(send: typeof fetch, tokens: TokenResponse): Promise<string> {
  if (!tokens.scope?.includes(CALENDAR_SCOPE)) fail(400, "Calendar access was not granted");
  const list = await getJson<{ items?: { id: string; primary?: boolean }[] }>(
    send,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
    tokens.access_token,
  );
  return list.items?.find((calendar) => calendar.primary)?.id ?? fail(400, "Could not find the primary calendar");
}

async function mailboxEmail(send: typeof fetch, tokens: TokenResponse): Promise<string> {
  if (!tokens.scope?.includes(GMAIL_SCOPE)) fail(400, "Gmail access was not granted");
  const profile = await getJson<{ emailAddress?: string }>(send, "https://gmail.googleapis.com/gmail/v1/users/me/profile", tokens.access_token);
  return profile.emailAddress ?? fail(400, "Could not read the mailbox address");
}

async function tokenRequest(send: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  const response = await send("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    if (data.error === "invalid_grant") fail(409, "Google access expired or was revoked. Connect it again in Settings.");
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
