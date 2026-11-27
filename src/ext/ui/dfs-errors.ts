/**
 * Maps errors from the DataForSEO service / paid guard to messages a user
 * can act on. Pure; used by server actions and tests.
 */
import { BudgetError } from "../dataforseo/budget";
import { DataForSeoError } from "../dataforseo/client";
import { PaidForbiddenError } from "../access/paid-guard";
import { ActionForbiddenError } from "@/lib/action-guard";
import { EncryptionUnavailableError } from "../crypto/encrypt-strict";

export type DfsErrorKind = "budget" | "forbidden" | "not_configured" | "disabled" | "encryption" | "other";
export type DfsError = { ok: false; kind: DfsErrorKind; error: string };

export function mapDfsError(e: unknown): DfsError {
  if (e instanceof BudgetError) return { ok: false, kind: "budget", error: e.message };
  if (e instanceof PaidForbiddenError || e instanceof ActionForbiddenError) {
    return { ok: false, kind: "forbidden", error: e.message };
  }
  if (e instanceof EncryptionUnavailableError) {
    return {
      ok: false,
      kind: "encryption",
      error: "Set SEO_ENCRYPTION_KEY — credentials are never stored unencrypted.",
    };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof DataForSeoError && /not configured/i.test(msg)) {
    return { ok: false, kind: "not_configured", error: "DataForSEO is not configured. An owner can add credentials in Settings → DataForSEO." };
  }
  if (/switched off/i.test(msg)) return { ok: false, kind: "disabled", error: msg };
  return { ok: false, kind: "other", error: msg };
}
