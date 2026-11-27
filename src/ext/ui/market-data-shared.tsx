"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { SourceBadge } from "./source-badge";
import { estimateMicros, microsToUsd, tasksForKeywords, type Mode } from "../dataforseo/pricing";
import { trackKeyword } from "@/app/keywords/actions";
import type { MetricView } from "@/app/market-data/actions";

export type Access = {
  /** Role may spend (not a viewer). */
  canSpend: boolean;
  /** DataForSEO credentials exist. */
  configured: boolean;
  /** Owner: may be linked to settings. */
  isOwner: boolean;
};

export const costLabel = (micros: number) => `≈$${microsToUsd(micros).toFixed(micros < 100_000 ? 3 : 2)}`;

export const volumeCost = (n: number, mode: Mode) =>
  estimateMicros("search_volume", mode, tasksForKeywords(Math.max(1, n)));

export const inputCls =
  "w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40";
export const freeBtn =
  "inline-flex h-9 items-center rounded-md border border-white/10 bg-white/5 px-4 text-xs font-medium hover:bg-white/10 disabled:opacity-50";
export const paidBtn =
  "inline-flex h-9 items-center rounded-md bg-emerald-500/15 px-4 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50";

export function ErrorBox({ kind, error, isOwner }: { kind?: string; error: string; isOwner: boolean }) {
  const settingsLink =
    isOwner && (kind === "budget" || kind === "not_configured" || kind === "disabled") ? (
      <>
        {" "}
        <Link href="/settings/dataforseo" className="underline underline-offset-2">
          Settings → DataForSEO
        </Link>
      </>
    ) : null;
  return (
    <p role="alert" className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
      {error}
      {settingsLink}
    </p>
  );
}

/** Explains why there is no paid button, instead of silently hiding it. */
export function PaidNote({ a }: { a: Access }) {
  if (!a.canSpend) {
    return <p className="text-[11px] text-muted-foreground">Your role is read-only, so you see cached data only.</p>;
  }
  if (!a.configured) {
    return (
      <p className="text-[11px] text-muted-foreground">
        DataForSEO is not configured, so only cached data is available.
        {a.isOwner && (
          <>
            {" "}
            <Link href="/settings/dataforseo" className="underline underline-offset-2">
              Add credentials
            </Link>
          </>
        )}
      </p>
    );
  }
  return null;
}

export const Legend = () => (
  <p className="text-[11px] text-muted-foreground">
    Each number shows its source. DataForSEO figures are Google Ads averages for the client&apos;s market, cached for days;
    estimates are relative buckets, not search counts. Hover a badge for details.
  </p>
);

/** 12-month inline-SVG sparkline. Renders nothing without trend data. */
export function Sparkline({ values }: { values: number[] | null }) {
  const v = (values ?? []).slice(-12);
  if (v.length < 2) return <span className="text-muted-foreground">—</span>;
  const max = Math.max(...v, 1);
  const w = 72;
  const h = 18;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 1 - (y / max) * (h - 2)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Last ${v.length} months, peak ${max.toLocaleString()}`} className="text-cyan-300">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TrackButton({ clientId, query, country }: { clientId: number; query: string; country: string }) {
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();
  if (done) return <span className="text-[11px] text-emerald-300">Tracked</span>;
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("clientId", String(clientId));
          fd.set("query", query);
          fd.set("country", country);
          try {
            await trackKeyword(fd);
            setDone(true);
          } catch {
            /* guardAction refused: leave the button */
          }
        })
      }
    >
      Track
    </button>
  );
}

export function MetricsTable({
  items,
  clientId,
  country,
  canTrack,
}: {
  items: MetricView[];
  clientId: number;
  country: string;
  canTrack: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-card/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-medium">Keyword</th>
            <th className="px-3 py-2.5 text-right font-medium">Volume / mo</th>
            <th className="px-3 py-2.5 text-right font-medium">CPC</th>
            <th className="px-3 py-2.5 text-right font-medium">Competition</th>
            <th className="px-3 py-2.5 text-left font-medium">12 months</th>
            <th className="px-3 py-2.5 text-left font-medium">Source</th>
            {canTrack && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {items.map((i) => (
            <tr key={i.keyword} className="hover:bg-white/[0.02]">
              <td className="px-4 py-2">{i.keyword}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {i.volume !== null ? i.volume.toLocaleString() : i.volumeBucket ? i.volumeBucket.replace("_", " ") : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{i.cpc !== null ? `$${i.cpc.toFixed(2)}` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{i.competition !== null ? i.competition.toFixed(2) : "—"}</td>
              <td className="px-3 py-2">
                <Sparkline values={i.trend} />
              </td>
              <td className="px-3 py-2">
                <SourceBadge source={i.source} fetchedAt={i.fetchedAt} cached={i.cached} fallbackReason={i.fallbackReason} pending={i.pending} />
              </td>
              {canTrack && (
                <td className="px-3 py-2 text-right">
                  <TrackButton clientId={clientId} query={i.keyword} country={country} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
