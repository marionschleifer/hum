import { describe, expect, it } from "bun:test";
import { readConfig } from "./config.ts";

describe("readConfig", () => {
  it("reads the owner's name for prompts and passkeys", () => {
    expect(readConfig({ HUM_OWNER_NAME: " Ada " }).ownerName).toBe("Ada");
  });

  it("leaves the owner unnamed when the variable is empty or missing", () => {
    expect(readConfig({}).ownerName).toBeUndefined();
    expect(readConfig({ HUM_OWNER_NAME: " " }).ownerName).toBeUndefined();
  });
});
