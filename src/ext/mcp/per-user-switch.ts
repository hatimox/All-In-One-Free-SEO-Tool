/**
 * Owner-controlled switch for per-user MCP tokens (`mcp.per_user_enabled`,
 * default ON). Turning remote MCP off for the workspace must also stop
 * per-user tokens, so the route checks this before resolving one.
 */
import { getSetting, setSetting, type SettingKey } from "@/lib/settings-store";

const KEY = "mcp.per_user_enabled" as SettingKey; // ext key, core SettingKey is a closed union

export async function perUserMcpEnabled(): Promise<boolean> {
  const v = await getSetting<unknown>(KEY);
  return !(v === false || v === "false" || v === 0);
}

export async function setPerUserMcpEnabled(on: boolean): Promise<void> {
  await setSetting(KEY, on);
}
