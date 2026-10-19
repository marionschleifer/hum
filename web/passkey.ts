import { api } from "./api.ts";

type CreationOptions = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  excludeCredentials: { type: "public-key"; id: string }[];
  timeout: number;
};

type RequestOptions = {
  challenge: string;
  rpId: string;
  userVerification: UserVerificationRequirement;
  timeout: number;
};

export async function registerPasskey(label: string, setupToken?: string): Promise<void> {
  const options = await api<CreationOptions>("POST", "/api/auth/register/options", { setupToken });
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromBase64Url(options.challenge),
      user: { ...options.user, id: fromBase64Url(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((c) => ({ type: c.type, id: fromBase64Url(c.id) })),
    },
  })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAttestationResponse;
  await api("POST", "/api/auth/register/verify", {
    setupToken,
    label,
    credential: {
      id: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
      },
    },
  });
}

export async function loginWithPasskey(): Promise<void> {
  const options = await api<RequestOptions>("POST", "/api/auth/login/options");
  const credential = (await navigator.credentials.get({
    publicKey: { ...options, challenge: fromBase64Url(options.challenge), allowCredentials: [] },
  })) as PublicKeyCredential;
  const response = credential.response as AuthenticatorAssertionResponse;
  await api("POST", "/api/auth/login/verify", {
    credential: {
      id: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
      },
    },
  });
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
