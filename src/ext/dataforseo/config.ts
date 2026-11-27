/**
 * DataForSEO configuration: credentials + spend settings.
 *
 * Credentials live in workspace_settings (`dataforseo.login` /
 * `dataforseo.password`), both encrypted with encryptStrict. Env vars
 * DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are the fallback. Nothing here
 * ever logs or returns the password except `getCredentials()`, which is
 * for the HTTP client only.
 */
import { decrypt } from "@/lib/crypto";
import {
  deleteSetting,
  getSetting,
  setSetting,
  type SettingKey,
} from "@/lib/settings-store";
import { encryptStrict } from "../crypto/encrypt-strict";

// Core SettingKey is a closed union; ext keys are cast rather than editing it.
const K = (k: string) => k as SettingKey;

export type Credentials = { login: string; password: string };

export type TtlDays = { volume: number; labs: number; backlinks: number };

export const DEFAULT_TTL_DAYS: TtlDays = { volume: 30, labs: 14, backlinks: 14 };
export const DEFAULT_REQUEST_MAX_USD = 1;
/** TTL 0 would disable caching (every read pays again), so one day is the floor. */
export const MIN_TTL_DAYS = 1;
const ttlDay = (v: unknown, dflt: number) => Math.max(MIN_TTL_DAYS, posNum(v) ?? dflt);

export function apiBase(): string {
  return (process.env.DATAFORSEO_API_BASE || "https://api.dataforseo.com").replace(
    /\/+$/,
    "",
  );
}

/** Stored credentials (decrypted), else env, else null. Fails closed. */
export async function getCredentials(): Promise<Credentials | null> {
  const [l, p] = await Promise.all([
    getSetting<string>(K("dataforseo.login")),
    getSetting<string>(K("dataforseo.password")),
  ]);
  if (l && p) {
    const login = decrypt(l);
    const password = decrypt(p);
    if (login && password) return { login, password };
    return null; // stored but undecryptable: do NOT fall through silently
  }
  const el = process.env.DATAFORSEO_LOGIN;
  const ep = process.env.DATAFORSEO_PASSWORD;
  if (el && ep) return { login: el, password: ep };
  return null;
}

export async function isConfigured(): Promise<boolean> {
  return (await getCredentials()) !== null;
}

/** Throws EncryptionUnavailableError if secrets cannot be encrypted. */
export async function saveCredentials(c: Credentials): Promise<void> {
  const login = c.login.trim();
  if (!login || !c.password) throw new Error("Login and password are required.");
  const encLogin = encryptStrict(login);
  const encPass = encryptStrict(c.password);
  await setSetting(K("dataforseo.login"), encLogin);
  await setSetting(K("dataforseo.password"), encPass);
}

export async function clearCredentials(): Promise<void> {
  await deleteSetting(K("dataforseo.login"));
  await deleteSetting(K("dataforseo.password"));
}

/** Non-secret summary for the Settings page. */
export async function credentialStatus(): Promise<{
  configured: boolean;
  source: "settings" | "env" | null;
  loginHint: string | null;
}> {
  const stored = await getSetting<string>(K("dataforseo.login"));
  const creds = await getCredentials();
  if (!creds) return { configured: false, source: null, loginHint: null };
  const [name, domain] = creds.login.split("@");
  const hint = domain ? `${name.slice(0, 2)}***@${domain}` : `${creds.login.slice(0, 2)}***`;
  return { configured: true, source: stored ? "settings" : "env", loginHint: hint };
}

export type DfsSettings = {
  /** null = not set: all paid calls are blocked. */
  teamCapUsd: number | null;
  userCaps: Record<string, number>;
  requestMaxUsd: number;
  ttlDays: TtlDays;
  defaultMode: "standard" | "live";
  automationsMaySpend: boolean;
  backlinksEnabled: boolean;
};

function posNum(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getSettings(): Promise<DfsSettings> {
  const [team, users, reqMax, ttl, mode, auto, bl] = await Promise.all([
    getSetting<unknown>(K("dataforseo.team_cap_usd")),
    getSetting<Record<string, unknown>>(K("dataforseo.user_caps")),
    getSetting<unknown>(K("dataforseo.request_max_usd")),
    getSetting<Partial<TtlDays>>(K("dataforseo.ttl_days")),
    getSetting<string>(K("dataforseo.default_mode")),
    getSetting<unknown>(K("dataforseo.automations_may_spend")),
    getSetting<unknown>(K("dataforseo.backlinks_enabled")),
  ]);
  const userCaps: Record<string, number> = {};
  for (const [k, v] of Object.entries(users ?? {})) {
    const n = posNum(v);
    if (n !== null) userCaps[k] = n;
  }
  return {
    teamCapUsd: posNum(team),
    userCaps,
    requestMaxUsd: posNum(reqMax) ?? DEFAULT_REQUEST_MAX_USD,
    ttlDays: {
      volume: ttlDay(ttl?.volume, DEFAULT_TTL_DAYS.volume),
      labs: ttlDay(ttl?.labs, DEFAULT_TTL_DAYS.labs),
      backlinks: ttlDay(ttl?.backlinks, DEFAULT_TTL_DAYS.backlinks),
    },
    defaultMode: mode === "live" ? "live" : "standard",
    automationsMaySpend: auto === true || auto === "true",
    backlinksEnabled: bl === true || bl === "true",
  };
}

export async function saveSettings(patch: Partial<DfsSettings>): Promise<void> {
  if ("teamCapUsd" in patch) {
    if (patch.teamCapUsd == null) await deleteSetting(K("dataforseo.team_cap_usd"));
    else await setSetting(K("dataforseo.team_cap_usd"), patch.teamCapUsd);
  }
  if (patch.userCaps) await setSetting(K("dataforseo.user_caps"), patch.userCaps);
  if (patch.requestMaxUsd !== undefined)
    await setSetting(K("dataforseo.request_max_usd"), patch.requestMaxUsd);
  if (patch.ttlDays) {
    await setSetting(K("dataforseo.ttl_days"), {
      volume: Math.max(MIN_TTL_DAYS, patch.ttlDays.volume),
      labs: Math.max(MIN_TTL_DAYS, patch.ttlDays.labs),
      backlinks: Math.max(MIN_TTL_DAYS, patch.ttlDays.backlinks),
    });
  }
  if (patch.defaultMode) await setSetting(K("dataforseo.default_mode"), patch.defaultMode);
  if (patch.automationsMaySpend !== undefined)
    await setSetting(K("dataforseo.automations_may_spend"), patch.automationsMaySpend);
  if (patch.backlinksEnabled !== undefined)
    await setSetting(K("dataforseo.backlinks_enabled"), patch.backlinksEnabled);
}
