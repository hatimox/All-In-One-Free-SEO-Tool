"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createMcpToken, revokeMcpToken } from "../mcp/token-actions";

export type TokenRow = {
  id: number;
  label: string;
  readOnly: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 pr-20 text-xs">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          });
        }}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] shadow-sm hover:border-foreground/25"
      >
        {done ? <Check className="size-3" /> : <Copy className="size-3" />}
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function McpTokenManager({
  tokens,
  endpoint,
  viewerOnly,
}: {
  tokens: TokenRow[];
  endpoint: string;
  viewerOnly: boolean;
}) {
  const [label, setLabel] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function create() {
    setError(null);
    start(async () => {
      const r = await createMcpToken({ label, readOnly: viewerOnly ? true : readOnly });
      if (r.ok && r.token) {
        setFresh(r.token);
        setLabel("");
      } else if (!r.ok) setError(r.error);
    });
  }

  function revoke(id: number) {
    setError(null);
    start(async () => {
      const r = await revokeMcpToken(id);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="glass-apple space-y-3 rounded-xl p-5">
        <h2 className="text-sm font-semibold">New token</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. Claude Desktop"
            className="max-w-xs"
            maxLength={80}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={viewerOnly ? true : readOnly}
              disabled={viewerOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            Read-only
          </label>
          <Button onClick={create} disabled={pending}>
            <KeyRound className="size-4" /> Create token
          </Button>
        </div>
        {viewerOnly && (
          <p className="text-xs text-muted-foreground">
            Client viewers can only create read-only tokens.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A token sees the same clients you do. Read-only tokens cannot change anything or spend DataForSEO budget.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {fresh && (
        <div className="glass-apple space-y-3 rounded-xl border border-amber-500/40 p-5">
          <h2 className="text-sm font-semibold">Copy your token now</h2>
          <p className="text-xs text-muted-foreground">It is shown once and cannot be retrieved later.</p>
          <CopyBox text={fresh} />
          <p className="text-xs text-muted-foreground">Endpoint (Streamable HTTP)</p>
          <CopyBox text={endpoint} />
          <CopyBox text={`claude mcp add -t http seo-tool ${endpoint} -H "Authorization: Bearer ${fresh}"`} />
          <Button variant="outline" size="sm" onClick={() => setFresh(null)}>
            I have saved it
          </Button>
        </div>
      )}

      <div className="glass-apple rounded-xl p-5">
        <h2 className="mb-3 text-sm font-semibold">Your tokens</h2>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.label}
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
    </div>
  );
}
