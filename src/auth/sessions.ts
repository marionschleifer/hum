import { fail, isoNow, type Ctx } from "../context.ts";
import { randomToken, sha256Hex } from "./encoding.ts";

export const SESSION_COOKIE = "hum_session";
const SESSION_DAYS = 180;

export type ApiToken = { id: string; label: string; createdAt: string; lastUsedAt?: string };

export function createSession(ctx: Ctx): { token: string; maxAgeSeconds: number } {
  const token = randomToken();
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  const expiresAt = new Date(ctx.now().getTime() + maxAgeSeconds * 1000).toISOString();
  ctx.db
    .query("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(sha256Hex(token), isoNow(ctx), expiresAt);
  return { token, maxAgeSeconds };
}

export function hasValidSession(ctx: Ctx, request: Request): boolean {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const row = ctx.db
    .query<{ expires_at: string }, [string]>("SELECT expires_at FROM sessions WHERE token_hash = ?")
    .get(sha256Hex(token));
  return row !== null && row.expires_at > isoNow(ctx);
}

export function endSession(ctx: Ctx, request: Request): void {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) ctx.db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function createApiToken(ctx: Ctx, label: string): { token: string; apiToken: ApiToken } {
  const token = `hum_${randomToken()}`;
  const id = ctx.newId();
  const createdAt = isoNow(ctx);
  const cleanLabel = label.trim() || fail(400, "Label is required");
  ctx.db
    .query("INSERT INTO api_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .run(id, sha256Hex(token), cleanLabel, createdAt);
  return { token, apiToken: { id, label: cleanLabel, createdAt } };
}

export function hasValidApiToken(ctx: Ctx, request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return false;
  const result = ctx.db
    .query("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?")
    .run(isoNow(ctx), sha256Hex(match[1]!));
  return result.changes === 1;
}

export function listApiTokens(ctx: Ctx): ApiToken[] {
  return ctx.db
    .query<{ id: string; label: string; created_at: string; last_used_at: string | null }, []>(
      "SELECT id, label, created_at, last_used_at FROM api_tokens ORDER BY created_at",
    )
    .all()
    .map((row) => ({ id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at ?? undefined }));
}

export function revokeApiToken(ctx: Ctx, id: string): void {
  if (ctx.db.query("DELETE FROM api_tokens WHERE id = ?").run(id).changes === 0) fail(404, "Token not found");
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
