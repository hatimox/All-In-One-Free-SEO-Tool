"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/action-guard";
import { accountsEnabled, currentUser } from "@/lib/auth";
import { createToken, revokeToken } from "./tokens";

export type TokenActionResult =
  | { ok: true; token?: string; message?: string }
  | { ok: false; error: string };

async function me() {
  if (!accountsEnabled()) return null;
  return currentUser();
}

/** Creates a token for the signed-in user. The plaintext is returned once. */
export async function createMcpToken(input: { label: string; readOnly: boolean }): Promise<TokenActionResult> {
  await guardAction("personal");
  const user = await me();
  if (!user) return { ok: false, error: "Sign in first. Per-user tokens need accounts to be enabled." };
  // Viewers are forced read-only inside createToken as well.
  const { token } = createToken({ userId: user.id, label: String(input.label ?? ""), readOnly: input.readOnly !== false });
  revalidatePath("/account/mcp-tokens");
  return { ok: true, token };
}

/** Revokes one of the signed-in user's own tokens. */
export async function revokeMcpToken(tokenId: number): Promise<TokenActionResult> {
  await guardAction("personal");
  const user = await me();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!revokeToken(user.id, Number(tokenId))) return { ok: false, error: "Token not found." };
  revalidatePath("/account/mcp-tokens");
  return { ok: true };
}
