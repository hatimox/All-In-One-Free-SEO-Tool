"use client";

import type { ReactNode } from "react";

export const sectionCls = "space-y-3 rounded-2xl border border-white/5 bg-card/40 p-5";
export const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());
export const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(2)}`);

export function Tile({ label, value, badge, hint, children }: { label: string; value: ReactNode; badge?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-[10rem] flex-1 rounded-xl border border-white/5 bg-card/40 p-4" data-testid={`tile-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {badge}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      {children}
    </div>
  );
}

/** 12-month line + area chart, inline SVG so it needs no library. */
export function TrendChart({ values }: { values: number[] | null }) {
  const v = (values ?? []).slice(-12);
  if (v.length < 2) return <p className="text-xs text-muted-foreground">No 12-month trend for this keyword.</p>;
  const w = 480;
  const h = 120;
  const max = Math.max(...v, 1);
  const x = (i: number) => (i / (v.length - 1)) * w;
  const y = (n: number) => h - 6 - (n / max) * (h - 16);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`);
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full text-cyan-300" role="img" aria-label={`Search volume, last ${v.length} months, peak ${max.toLocaleString()}`} preserveAspectRatio="none">
        <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill="currentColor" opacity="0.12" />
        <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {v.map((n, i) => (
          <circle key={i} cx={x(i)} cy={y(n)} r="2.5" fill="currentColor" vectorEffect="non-scaling-stroke">
            <title>{`Month ${i + 1}: ${n.toLocaleString()}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{v.length} months ago</span>
        <span>peak {max.toLocaleString()}</span>
        <span>latest month</span>
      </div>
    </div>
  );
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const linkBtn = "inline-flex h-8 items-center rounded-md border border-white/10 px-3 text-xs hover:bg-white/10 disabled:opacity-50";
