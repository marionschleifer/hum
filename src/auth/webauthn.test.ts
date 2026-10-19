import { describe, expect, it } from "bun:test";
import { createFakeAuthenticator } from "../../test/fake-authenticator.ts";
import { testCtx } from "../../test/helpers.ts";
import { listPasskeys, loginOptions, registrationOptions, verifyLogin, verifyRegistration } from "./webauthn.ts";

const config = { rpId: "localhost", origin: "http://localhost:3000" };

async function registered() {
  const ctx = testCtx();
  const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
  const { challenge } = registrationOptions(ctx, config);
  await verifyRegistration(ctx, config, await authenticator.register(challenge), "iPhone");
  return { ctx, authenticator };
}

describe("passkey registration", () => {
  it("stores a verified passkey", async () => {
    const { ctx, authenticator } = await registered();
    expect(listPasskeys(ctx)).toEqual([{ id: authenticator.id, label: "iPhone", createdAt: "2026-10-17T08:00:00.000Z" }]);
  });

  it("asks for a resident, user-verified ES256 or RS256 key", () => {
    const options = registrationOptions(testCtx(), config);
    expect(options.rp.id).toBe("localhost");
    expect(options.authenticatorSelection.userVerification).toBe("required");
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
  });

  it("names the passkey after the owner, or Hum when there is none", () => {
    expect(registrationOptions(testCtx(), { ...config, ownerName: "Marion" }).user).toEqual({
      id: "bWFyaW9u",
      name: "marion",
      displayName: "Marion",
    });
    expect(registrationOptions(testCtx(), config).user).toEqual({ id: "aHVt", name: "hum", displayName: "Hum" });
  });

  it("rejects a wrong origin", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = registrationOptions(ctx, config);
    const response = await authenticator.register(challenge, { origin: "https://evil.example" });
    await expect(verifyRegistration(ctx, config, response, "x")).rejects.toThrow("Wrong origin");
  });

  it("rejects a challenge it never issued", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
    await expect(verifyRegistration(ctx, config, await authenticator.register("made-up"), "x")).rejects.toThrow(
      "Challenge expired or unknown",
    );
  });

  it("rejects an expired challenge", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = registrationOptions(ctx, config);
    ctx.advance(6 * 60 * 1000);
    await expect(verifyRegistration(ctx, config, await authenticator.register(challenge), "x")).rejects.toThrow(
      "Challenge expired or unknown",
    );
  });

  it("rejects a key for another relying party", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = registrationOptions(ctx, config);
    const response = await authenticator.register(challenge, { rpId: "evil.example" });
    await expect(verifyRegistration(ctx, config, response, "x")).rejects.toThrow("Wrong relying party");
  });

  it("requires user verification", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = registrationOptions(ctx, config);
    const response = await authenticator.register(challenge, { verified: false });
    await expect(verifyRegistration(ctx, config, response, "x")).rejects.toThrow("User not verified");
  });
});

describe("passkey login", () => {
  it("accepts a valid signature", async () => {
    const { ctx, authenticator } = await registered();
    const { challenge } = loginOptions(ctx, config);
    await verifyLogin(ctx, config, await authenticator.login(challenge));
  });

  it("works with RS256 keys too", async () => {
    const ctx = testCtx();
    const authenticator = await createFakeAuthenticator(config.rpId, config.origin, "RS256");
    await verifyRegistration(ctx, config, await authenticator.register(registrationOptions(ctx, config).challenge), "Mac");
    await verifyLogin(ctx, config, await authenticator.login(loginOptions(ctx, config).challenge));
  });

  it("does not accept the same challenge twice", async () => {
    const { ctx, authenticator } = await registered();
    const { challenge } = loginOptions(ctx, config);
    await verifyLogin(ctx, config, await authenticator.login(challenge));
    await expect(verifyLogin(ctx, config, await authenticator.login(challenge))).rejects.toThrow("Challenge expired");
  });

  it("rejects a signature from another key", async () => {
    const { ctx, authenticator } = await registered();
    const impostor = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = loginOptions(ctx, config);
    const forged = { ...(await impostor.login(challenge)), id: authenticator.id };
    await expect(verifyLogin(ctx, config, forged)).rejects.toThrow("Bad signature");
  });

  it("rejects unknown passkeys", async () => {
    const { ctx } = await registered();
    const stranger = await createFakeAuthenticator(config.rpId, config.origin);
    const { challenge } = loginOptions(ctx, config);
    await expect(verifyLogin(ctx, config, await stranger.login(challenge))).rejects.toThrow("Unknown passkey");
  });

  it("rejects a counter that goes backwards", async () => {
    const { ctx, authenticator } = await registered();
    await verifyLogin(ctx, config, await authenticator.login(loginOptions(ctx, config).challenge, { counter: 5 }));
    const replay = await authenticator.login(loginOptions(ctx, config).challenge, { counter: 3 });
    await expect(verifyLogin(ctx, config, replay)).rejects.toThrow("counter went backwards");
  });
});
