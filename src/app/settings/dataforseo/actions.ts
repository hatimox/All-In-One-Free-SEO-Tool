"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/action-guard";
import { clearCredentials, saveCredentials, saveSettings, type DfsSettings } from "@/ext/dataforseo/config";
import { getBalance } from "@/ext/dataforseo/endpoints/account";
import { mapDfsError } from "@/ext/ui/dfs-errors";

export type DfsActionResult = { ok: true; message: string } | { ok: false; error: string };

const fail = (e: unknown): DfsActionResult => {
  const m = mapDfsError(e);
  return { ok: false, error: m.error };
};

/** The password is read from the form, stored encrypted, and never returned. */
export async function saveDfsCredentials(_prev: DfsActionResult | null, formData: FormData): Promise<DfsActionResult> {
  await guardAction("settings");
  try {
    await saveCredentials({
      login: String(formData.get("login") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/settings/dataforseo");
  revalidatePath("/connect");
  return { ok: true, message: "Credentials saved (encrypted)." };
}

export async function removeDfsCredentials(): Promise<DfsActionResult> {
  await guardAction("settings");
  try {
    await clearCredentials();
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/settings/dataforseo");
  revalidatePath("/connect");
  return { ok: true, message: "Stored credentials removed." };
}

export async function testDfsConnection(): Promise<DfsActionResult> {
  await guardAction("settings");
  try {
    const b = await getBalance();
    return {
      ok: true,
      message:
        b.balanceUsd === null
          ? "Connected. DataForSEO did not report a balance."
          : `Connected. Account balance: $${b.balanceUsd.toFixed(2)}.`,
    };
  } catch (e) {
    return fail(e);
  }
}

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export async function saveDfsSettings(_prev: DfsActionResult | null, formData: FormData): Promise<DfsActionResult> {
  await guardAction("settings");
  const team = num(formData.get("teamCapUsd"));
  const reqMax = num(formData.get("requestMaxUsd"));
  const ttl = { volume: num(formData.get("ttlVolume")), labs: num(formData.get("ttlLabs")), backlinks: num(formData.get("ttlBacklinks")) };
  if ([team, reqMax, ttl.volume, ttl.labs, ttl.backlinks].some((n) => Number.isNaN(n))) {
    return { ok: false, error: "Amounts and day counts must be numbers, zero or more." };
  }
  const userCaps: Record<string, number> = {};
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("userCap_")) continue;
    const n = num(v);
    if (Number.isNaN(n)) return { ok: false, error: "Per-user caps must be numbers, zero or more." };
    if (n !== null) userCaps[k.slice("userCap_".length)] = n;
  }
  const patch: Partial<DfsSettings> = {
    teamCapUsd: team,
    userCaps,
    defaultMode: formData.get("defaultMode") === "live" ? "live" : "standard",
    automationsMaySpend: formData.get("automationsMaySpend") === "on",
    backlinksEnabled: formData.get("backlinksEnabled") === "on",
  };
  if (reqMax !== null) patch.requestMaxUsd = reqMax;
  if (ttl.volume !== null && ttl.labs !== null && ttl.backlinks !== null) {
    patch.ttlDays = { volume: ttl.volume, labs: ttl.labs, backlinks: ttl.backlinks };
  }
  try {
    await saveSettings(patch);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/settings/dataforseo");
  revalidatePath("/connect");
  return { ok: true, message: "Settings saved." };
}
