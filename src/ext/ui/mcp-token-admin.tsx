"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminRevokeMcpToken, setPerUserMcp } from "../mcp/token-actions";

export type AdminTokenRow = {
  id: number;
  userLabel: string;
  role: string;
  label: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

/** Owner-only: the per-user token switch and every user's tokens. */
export function McpTokenAdmin({ tokens, enabled }: { tokens: AdminTokenRow[]; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    start(async () => {
      const r = await setPerUserMcp(next);
      if (r.ok) setOn(next);
      else setError(r.error);
    });
  }

  function revoke(id: number) {
    setError(null);
    start(async () => {
      const r = await adminRevokeMcpToken(id);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="glass-apple space-y-4 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">All users&apos; tokens (owner)</h2>
          <p className="text-xs text-muted-foreground">
            When personal tokens are off, /api/mcp refuses every one of them with a 503, whatever is listed here.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
          Accept personal tokens
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens have been created.</p>
      ) : (
        <ul className="divide-y divide-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t.userLabel}
                  <Badge variant="outline">{t.role}</Badge>
                  <span className="font-normal text-muted-foreground">{t.label}</span>
                  <Badge variant="outline">{t.readOnly ? "read-only" : "full"}</Badge>
                  {t.revokedAt && <Badge variant="outline">revoked</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {fmt(t.createdAt)} · last used {fmt(t.lastUsedAt)}
                </p>
              </div>
              {!t.revokedAt && (
                <Button variant="destructive" size="sm" disabled={pending} onClick={() => revoke(t.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
