export const dynamic = "force-dynamic";

import Link from "next/link";
import { headers } from "next/headers";
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { accountsEnabled, canManageSettings, currentUser } from "@/lib/auth";
import { McpTokenManager } from "@/ext/ui/mcp-token-manager";
import { listAllTokens, listTokens } from "@/ext/mcp/tokens";
import { perUserMcpEnabled } from "@/ext/mcp/per-user-switch";
import { McpTokenAdmin } from "@/ext/ui/mcp-token-admin";

export default async function McpTokensPage() {
  const header = (
    <PageHeader
      title="MCP tokens"
      description="Personal tokens for connecting Claude, Cursor or other MCP clients as you."
      icon={KeyRound}
    />
  );

  if (!accountsEnabled()) {
    return (
      <div className="space-y-6">
        {header}
        <div className="glass-apple rounded-xl p-6 text-sm text-muted-foreground">
          Accounts are not enabled on this install, so per-user tokens are not available. The workspace
          MCP tokens in{" "}
          <Link href="/settings" className="font-medium underline underline-offset-4">
            Settings
          </Link>{" "}
          apply instead (owner-level access to every client).
        </div>
      </div>
    );
  }

  const me = await currentUser();
  if (!me) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Sign in to manage your MCP tokens.</p>
      </div>
    );
  }

  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const tokens = listTokens(me.id).map((t) => ({
    id: t.id,
    label: t.label,
    readOnly: t.readOnly,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  }));

  const admin = canManageSettings(me.role)
    ? {
        enabled: await perUserMcpEnabled(),
        tokens: listAllTokens().map((t) => ({
          id: t.id,
          userLabel: t.userName || t.userEmail,
          role: t.userRole,
          label: t.label,
          readOnly: t.readOnly,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          revokedAt: t.revokedAt?.toISOString() ?? null,
        })),
      }
    : null;

  return (
    <div className="space-y-6">
      {header}
      <McpTokenManager tokens={tokens} endpoint={`${proto}://${host}/api/mcp`} viewerOnly={me.role === "viewer"} />
      {admin && <McpTokenAdmin tokens={admin.tokens} enabled={admin.enabled} />}
    </div>
  );
}
