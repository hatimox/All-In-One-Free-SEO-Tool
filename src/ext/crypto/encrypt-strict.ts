/**
 * Strict encryption for secrets that must never touch disk in plaintext.
 *
 * Core `encrypt()` (src/lib/crypto.ts) silently returns the plaintext when
 * no key can be obtained. That is acceptable for legacy fields but not for
 * a credential that can spend money, so this wrapper throws instead.
 */
import { encrypt, isEncrypted } from "@/lib/crypto";

export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      "Encryption key unavailable: refusing to store the secret in plaintext. " +
        "Set SEO_ENCRYPTION_KEY (base64, 32 bytes) or make the data directory writable.",
    );
    this.name = "EncryptionUnavailableError";
  }
}

export function encryptStrict(plaintext: string): string {
  if (!plaintext) throw new Error("encryptStrict: empty value");
  const out = encrypt(plaintext);
  if (!isEncrypted(out)) throw new EncryptionUnavailableError();
  return out;
}
