"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { exactVolumesContext, lookupKeywords, type ExactVolumesContext, type KeywordsOut } from "@/app/market-data/actions";
import { ErrorBox, MetricsTable, costLabel, inputCls, paidBtn, volumeCost } from "./market-data-shared";

/**
 * Optional "Get exact volumes" block for screens that otherwise show relative
 * estimates (search-volume tool, keyword research). Renders nothing unless
 * DataForSEO is configured and the viewer may spend. The paid call only ever
 * happens from the button, which shows the estimated price.
 */
export function ExactVolumesPanel({ initialKeywords = [] }: { initialKeywords?: string[] }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<ExactVolumesContext | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [text, setText] = useState(initialKeywords.join("\n"));
  const [out, setOut] = useState<KeywordsOut | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    exactVolumesContext()
      .then((c) => {
        if (!live) return;
        setCtx(c);
        setClientId(c.clients[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!ctx || !ctx.configured || !ctx.canSpend || ctx.clients.length === 0) return null;
  const count = new Set(text.split(/\r?\n|,/).map((s) => s.trim().toLowerCase()).filter(Boolean)).size;

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-card/40 p-5">
      <div>
        <h2 className="text-base font-semibold">Exact volumes (DataForSEO)</h2>
        <p className="text-[11px] text-muted-foreground">
          Optional and paid. The figures above stay labelled as estimates; this fetches Google Ads averages instead. The client
          chosen sets the market and the spend attribution.
        </p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className={inputCls} placeholder="one keyword per line" />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={clientId ?? ""}
          onChange={(e) => setClientId(Number(e.target.value))}
          className="h-9 rounded-md border border-white/10 bg-card/60 px-2 text-xs"
          aria-label="Client for market and cost attribution"
        >
          {ctx.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || count === 0 || clientId === null}
          className={paidBtn}
          onClick={() =>
            start(async () => {
              if (clientId === null) return;
              const r = await lookupKeywords({ clientId, keywords: text, spend: true });
              if (r.ok && r.status === "pending") {
                router.push(`/market-data/c/${clientId}/requests/${r.requestId}`);
                return;
              }
              setOut(r);
            })
          }
        >
          {busy ? "Fetching…" : `Get exact volumes · ${costLabel(volumeCost(count, ctx.mode))}`}
        </button>
      </div>
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={false} />}
      {out?.ok && clientId !== null && <MetricsTable items={out.items} clientId={clientId} country="US" canTrack={false} />}
    </section>
  );
}
