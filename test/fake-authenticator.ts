import type { AuthenticationResponse, RegistrationResponse } from "../src/auth/webauthn.ts";
import { concatBytes, sha256, toBase64Url } from "../src/auth/encoding.ts";

type CeremonyOptions = { origin?: string; rpId?: string; verified?: boolean; counter?: number };

export async function createFakeAuthenticator(rpId: string, origin: string, algorithm: "ES256" | "RS256" = "ES256") {
  const rsa = algorithm === "RS256";
  const keyPair = (await crypto.subtle.generateKey(
    rsa
      ? { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const id = toBase64Url(credentialId);
  let counter = 0;

  async function register(challenge: string, options: CeremonyOptions = {}): Promise<RegistrationResponse> {
    const clientDataJSON = clientData("webauthn.create", challenge, options.origin ?? origin);
    const coseKey = rsa
      ? new Map<number, number | Uint8Array>([
          [1, 3],
          [3, -257],
          [-1, Buffer.from(jwk.n!, "base64url")],
          [-2, Buffer.from(jwk.e!, "base64url")],
        ])
      : new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]);
    const authData = concatBytes(
      await sha256(new TextEncoder().encode(options.rpId ?? rpId)),
      new Uint8Array([flags(options) | 0x40]),
      uint32(counter),
      new Uint8Array(16),
      new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]),
      credentialId,
      encodeCbor(coseKey),
    );
    const attestationObject = encodeCbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id,
      type: "public-key",
      response: { clientDataJSON: toBase64Url(clientDataJSON), attestationObject: toBase64Url(attestationObject) },
    };
  }

  async function login(challenge: string, options: CeremonyOptions = {}): Promise<AuthenticationResponse> {
    counter = options.counter ?? counter + 1;
    const clientDataJSON = clientData("webauthn.get", challenge, options.origin ?? origin);
    const authData = concatBytes(
      await sha256(new TextEncoder().encode(options.rpId ?? rpId)),
      new Uint8Array([flags(options)]),
      uint32(counter),
    );
    const signed = concatBytes(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(
      await crypto.subtle.sign(rsa ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signed),
    );
    return {
      id,
      type: "public-key",
      response: {
        clientDataJSON: toBase64Url(clientDataJSON),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(rsa ? raw : rawToDer(raw)),
      },
    };
  }

  return { id, register, login };
}

export function encodeCbor(value: unknown): Uint8Array {
  if (typeof value === "number") {
    return value >= 0 ? header(0, value) : header(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(header(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concatBytes(header(2, value.length), value);
  if (Array.isArray(value)) return concatBytes(header(4, value.length), ...value.map(encodeCbor));
  if (value instanceof Map) {
    const parts = [...value.entries()].flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)]);
    return concatBytes(header(5, value.size), ...parts);
  }
  if (value === true) return new Uint8Array([0xf5]);
  if (value === false) return new Uint8Array([0xf4]);
  throw new Error(`Cannot encode ${String(value)}`);
}

function header(major: number, argument: number): Uint8Array {
  if (argument < 24) return new Uint8Array([(major << 5) | argument]);
  if (argument < 256) return new Uint8Array([(major << 5) | 24, argument]);
  if (argument < 65536) return new Uint8Array([(major << 5) | 25, argument >> 8, argument & 0xff]);
  return concatBytes(new Uint8Array([(major << 5) | 26]), uint32(argument));
}

function clientData(type: string, challenge: string, origin: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function flags(options: CeremonyOptions): number {
  return options.verified === false ? 0x01 : 0x05;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let trimmed = bytes;
    while (trimmed.length > 1 && trimmed[0] === 0) trimmed = trimmed.slice(1);
    if (trimmed[0]! & 0x80) trimmed = concatBytes(new Uint8Array([0]), trimmed);
    return concatBytes(new Uint8Array([0x02, trimmed.length]), trimmed);
  };
  const body = concatBytes(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}
