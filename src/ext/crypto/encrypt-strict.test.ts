import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crypto", async (orig) => {
  const real = await orig<typeof import("@/lib/crypto")>();
  return { ...real, encrypt: vi.fn((s: string) => s) }; // simulates "no key": plaintext passthrough
});

import { encryptStrict, EncryptionUnavailableError } from "./encrypt-strict";

describe("encryptStrict", () => {
  it("throws when the core encrypt falls back to plaintext", () => {
    expect(() => encryptStrict("secret-value")).toThrow(EncryptionUnavailableError);
    try {
      encryptStrict("secret-value");
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-value");
    }
  });
  it("rejects empty input", () => {
    expect(() => encryptStrict("")).toThrow();
  });
  it("rejects a plaintext that already starts with the reserved enc:v1: prefix", () => {
    expect(() => encryptStrict("enc:v1:looks-encrypted")).toThrow(/reserved prefix/);
  });
});

describe("encryptStrict with a working key", () => {
  it("returns an enc:v1 blob", async () => {
    const real = await vi.importActual<typeof import("@/lib/crypto")>("@/lib/crypto");
    const m = await import("@/lib/crypto");
    (m.encrypt as unknown as ReturnType<typeof vi.fn>).mockImplementation(real.encrypt);
    const out = encryptStrict("abc");
    expect(out.startsWith("enc:v1:")).toBe(true);
    expect(real.decrypt(out)).toBe("abc");
  });
});
