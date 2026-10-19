import { fail, isoNow, type Ctx } from "../context.ts";
import { decodeCbor, decodeCborPrefix, type CborValue } from "./cbor.ts";
import { concatBytes, equalBytes, fromBase64Url, randomToken, sha256, toBase64Url } from "./encoding.ts";

export type WebAuthnConfig = { rpId: string; origin: string; ownerName?: string };

export type RegistrationResponse = {
  id: string;
  type: string;
  response: { clientDataJSON: string; attestationObject: string };
};

export type AuthenticationResponse = {
  id: string;
  type: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
};

export type Passkey = { id: string; label: string; createdAt: string };

type StoredKey = { alg: number; jwk: JsonWebKey };

const ES256 = -7;
const RS256 = -257;
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const ATTESTED_DATA = 0x40;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function registrationOptions(ctx: Ctx, config: WebAuthnConfig) {
  return {
    challenge: issueChallenge(ctx, "register"),
    rp: { id: config.rpId, name: "Hum" },
    user: passkeyUser(config.ownerName ?? "Hum"),
    pubKeyCredParams: [
      { type: "public-key", alg: ES256 },
      { type: "public-key", alg: RS256 },
    ],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    excludeCredentials: listPasskeys(ctx).map((passkey) => ({ type: "public-key", id: passkey.id })),
    timeout: CHALLENGE_TTL_MS,
  };
}

export async function verifyRegistration(
  ctx: Ctx,
  config: WebAuthnConfig,
  credential: RegistrationResponse,
  label: string,
): Promise<Passkey> {
  checkClientData(ctx, config, credential.response.clientDataJSON, "webauthn.create", "register");
  const attestation = asMap(decodeCbor(fromBase64Url(credential.response.attestationObject)));
  const authData = asBytes(attestation.get("authData"));
  const parsed = await parseAuthData(authData, config.rpId);
  if (!(parsed.flags & ATTESTED_DATA) || !parsed.credentialId || !parsed.publicKey) {
    fail(400, "Passkey response has no credential");
  }
  const id = toBase64Url(parsed.credentialId);
  if (id !== credential.id) fail(400, "Credential id mismatch");
  if (ctx.db.query("SELECT 1 FROM passkeys WHERE id = ?").get(id)) fail(409, "Passkey already registered");
  const createdAt = isoNow(ctx);
  ctx.db
    .query("INSERT INTO passkeys (id, public_key, sign_count, label, created_at) VALUES ($id, $key, $count, $label, $at)")
    .run({ id, key: JSON.stringify(parsed.publicKey), count: parsed.signCount, label: label.trim() || "Passkey", at: createdAt });
  return { id, label: label.trim() || "Passkey", createdAt };
}

export function loginOptions(ctx: Ctx, config: WebAuthnConfig) {
  return {
    challenge: issueChallenge(ctx, "login"),
    rpId: config.rpId,
    allowCredentials: [],
    userVerification: "required",
    timeout: CHALLENGE_TTL_MS,
  };
}

export async function verifyLogin(ctx: Ctx, config: WebAuthnConfig, credential: AuthenticationResponse): Promise<void> {
  const row = ctx.db
    .query<{ public_key: string; sign_count: number }, [string]>("SELECT public_key, sign_count FROM passkeys WHERE id = ?")
    .get(credential.id);
  if (!row) fail(401, "Unknown passkey");
  const clientData = checkClientData(ctx, config, credential.response.clientDataJSON, "webauthn.get", "login");
  const authData = fromBase64Url(credential.response.authenticatorData);
  const parsed = await parseAuthData(authData, config.rpId);
  const signed = concatBytes(authData, await sha256(clientData));
  const key = JSON.parse(row.public_key) as StoredKey;
  if (!(await verifySignature(key, fromBase64Url(credential.response.signature), signed))) fail(401, "Bad signature");
  if (row.sign_count > 0 && parsed.signCount <= row.sign_count) fail(401, "Passkey counter went backwards");
  ctx.db.query("UPDATE passkeys SET sign_count = ? WHERE id = ?").run(parsed.signCount, credential.id);
}

export function listPasskeys(ctx: Ctx): Passkey[] {
  return ctx.db
    .query<{ id: string; label: string; created_at: string }, []>("SELECT id, label, created_at FROM passkeys ORDER BY created_at")
    .all()
    .map((row) => ({ id: row.id, label: row.label, createdAt: row.created_at }));
}

function issueChallenge(ctx: Ctx, kind: "register" | "login"): string {
  const challenge = randomToken();
  const expiresAt = new Date(ctx.now().getTime() + CHALLENGE_TTL_MS).toISOString();
  ctx.db.query("DELETE FROM challenges WHERE expires_at < ?").run(isoNow(ctx));
  ctx.db.query("INSERT INTO challenges (challenge, kind, expires_at) VALUES (?, ?, ?)").run(challenge, kind, expiresAt);
  return challenge;
}

function consumeChallenge(ctx: Ctx, kind: "register" | "login", challenge: string): void {
  const row = ctx.db
    .query<{ expires_at: string }, [string, string]>("DELETE FROM challenges WHERE challenge = ? AND kind = ? RETURNING expires_at")
    .get(challenge, kind);
  if (!row || row.expires_at < isoNow(ctx)) fail(400, "Challenge expired or unknown");
}

function checkClientData(
  ctx: Ctx,
  config: WebAuthnConfig,
  encoded: string,
  type: string,
  kind: "register" | "login",
): Uint8Array {
  const bytes = fromBase64Url(encoded);
  const data = JSON.parse(new TextDecoder().decode(bytes)) as { type?: string; challenge?: string; origin?: string };
  if (data.type !== type) fail(400, "Wrong passkey ceremony");
  if (data.origin !== config.origin) fail(400, "Wrong origin");
  consumeChallenge(ctx, kind, String(data.challenge));
  return bytes;
}

async function parseAuthData(bytes: Uint8Array, rpId: string) {
  if (bytes.length < 37) fail(400, "Authenticator data too short");
  if (!equalBytes(bytes.slice(0, 32), await sha256(new TextEncoder().encode(rpId)))) fail(400, "Wrong relying party");
  const flags = bytes[32]!;
  if (!(flags & USER_PRESENT) || !(flags & USER_VERIFIED)) fail(400, "User not verified");
  const signCount = new DataView(bytes.buffer, bytes.byteOffset).getUint32(33);
  if (!(flags & ATTESTED_DATA)) return { flags, signCount };
  const idLength = new DataView(bytes.buffer, bytes.byteOffset).getUint16(53);
  const credentialId = bytes.slice(55, 55 + idLength);
  const [coseKey] = decodeCborPrefix(bytes, 55 + idLength);
  return { flags, signCount, credentialId, publicKey: coseToStoredKey(asMap(coseKey)) };
}

function coseToStoredKey(cose: Map<CborValue, CborValue>): StoredKey {
  const alg = cose.get(3);
  if (alg === ES256 && cose.get(1) === 2 && cose.get(-1) === 1) {
    return {
      alg: ES256,
      jwk: { kty: "EC", crv: "P-256", x: toBase64Url(asBytes(cose.get(-2))), y: toBase64Url(asBytes(cose.get(-3))) },
    };
  }
  if (alg === RS256 && cose.get(1) === 3) {
    return {
      alg: RS256,
      jwk: { kty: "RSA", alg: "RS256", n: toBase64Url(asBytes(cose.get(-1))), e: toBase64Url(asBytes(cose.get(-2))) },
    };
  }
  return fail(400, "Unsupported passkey algorithm");
}

async function verifySignature(key: StoredKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  if (key.alg === ES256) {
    const publicKey = await crypto.subtle.importKey("jwk", key.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, derToRaw(signature), data);
  }
  const publicKey = await crypto.subtle.importKey("jwk", key.jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, data);
}

export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) fail(400, "Bad signature encoding");
  let offset = 2;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < 2; i++) {
    if (der[offset] !== 0x02) fail(400, "Bad signature encoding");
    const length = der[offset + 1]!;
    let value = der.slice(offset + 2, offset + 2 + length);
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    parts.push(padded);
    offset += 2 + length;
  }
  return concatBytes(parts[0]!, parts[1]!);
}

function asMap(value: CborValue): Map<CborValue, CborValue> {
  if (!(value instanceof Map)) fail(400, "Malformed passkey data");
  return value;
}

function asBytes(value: CborValue): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(400, "Malformed passkey data");
  return value;
}

function passkeyUser(displayName: string) {
  const name = displayName.toLowerCase();
  return { id: toBase64Url(new TextEncoder().encode(name)), name, displayName };
}
