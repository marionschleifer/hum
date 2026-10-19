import { describe, expect, it } from "bun:test";
import { encodeCbor } from "../../test/fake-authenticator.ts";
import { decodeCbor } from "./cbor.ts";

describe("decodeCbor", () => {
  it("decodes integers of every width", () => {
    for (const n of [0, 23, 24, 255, 256, 65535, 65536, -1, -7, -257]) {
      expect(decodeCbor(encodeCbor(n))).toBe(n);
    }
  });

  it("decodes strings, bytes, arrays and maps", () => {
    const value = new Map<unknown, unknown>([
      ["fmt", "none"],
      [3, -7],
      [-2, new Uint8Array([1, 2, 3])],
      ["list", [1, "two", true, false]],
    ]);
    expect(decodeCbor(encodeCbor(value))).toEqual(value as never);
  });

  it("decodes 64-bit integers", () => {
    expect(decodeCbor(new Uint8Array([0x1b, 0, 0, 0, 1, 0, 0, 0, 0]))).toBe(2 ** 32);
  });

  it("rejects truncated and trailing data", () => {
    expect(() => decodeCbor(new Uint8Array([0x43, 1, 2]))).toThrow("Unexpected end");
    expect(() => decodeCbor(new Uint8Array([0x01, 0x02]))).toThrow("Trailing bytes");
    expect(() => decodeCbor(new Uint8Array([0x5f]))).toThrow("Indefinite-length");
  });
});
