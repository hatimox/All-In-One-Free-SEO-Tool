"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { fetchDomainView } from "@/app/market-data/actions";
import type { DomainView, Slice } from "@/app/market-data/research";
import type { PositionBuckets } from "../dataforseo/endpoints/labs";
import { SourceBadge } from "./source-badge";
import { Access, ErrorBox, Legend, PaidNote, costLabel, paidBtn } from "./market-data-shared";
import { Tile, num, sectionCls } from "./research-ui";

const BUCKETS: { key: keyof PositionBuckets; label: string; cls: string }[] = [
  { key: "pos1", label: "1", cls: "bg-emerald-400" },
  { key: "pos2_3", label: "2–3", cls: "bg-emerald-500/80" },
  { key: "pos4_10", label: "4–10", cls: "bg-cyan-400/80" },
  { key: "pos11_20", label: "11–20", cls: "bg-sky-400/60" },
  { key: "pos21_50", label: "21–50", cls: "bg-violet-400/60" },
  { key: "pos51_100", label: "51–100", cls: "bg-white/25" },
];

export function PositionBar({ positions }: { positions: PositionBuckets }) {
  const total = BUCKETS.reduce((s, b) => s + (positions[b.key] ?? 0), 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No ranking positions reported.</p>;
  return (
    <div className="space-y-2">
      <div className="flex h-4 overflow-hidden rounded-full bg-white/5" role="img" aria-label="Position distribution">
        {BUCKETS.map((b) => {
          const v = positions[b.key] ?? 0;
          return v > 0 ? <div key={b.key} className={b.cls} style={{ width: `${(v / total) * 100}%` }} title={`Positions ${b.label}: ${v.toLocaleString()}`} /> : null;
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {BUCKETS.map((b) => (
          <li key={b.key} className="flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-full ${b.cls}`} />
            {b.label}: <span className="tabular-nums text-foreground">{num(positions[b.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const miss = (label: string) => <p className="text-xs text-muted-foreground">{label} is not loaded yet. It comes with the domain data button.</p>;

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="max-h-[26rem] overflow-auto rounded-xl border border-white/5">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2.5 font-medium ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">{children}</tbody>
      </table>
    </div>
  );
}

const fresh = (s: Slice<unknown>) => (s.status === "ready" ? <SourceBadge source="dataforseo" cached={s.cached} fetchedAt={s.fetchedAt} /> : undefined);

export function DomainResearch({ clientId, access, initial }: { clientId: number; access: Access; initial: DomainView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<{ kind?: string; error: string } | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured && view.configured;
  const base = `/market-data/c/${clientId}`;
  const { overview: ov, pages, keywords, competitors, backlinks } = view;
  const o = ov.status === "ready" ? ov.data : null;
  const p = o?.positions ?? null;
  const top3 = p ? p.pos1 + p.pos2_3 : null;
  const top10 = p && top3 !== null ? top3 + p.pos4_10 : null;

  const getData = () =>
    start(async () => {
      setError(null);
      const r = await fetchDomainView({ clientId, domain: view.domain, country: view.country, spend: true });
      if (!r.ok) return setError(r);
      setView(r.view);
    });

  return (
    <div className="space-y-4">
      <Legend />
      {canPaid && view.missing.micros > 0 && (
        <>
          <button type="button" disabled={busy} onClick={getData} className={paidBtn}>
            {busy ? "Fetching…" : `Get domain data · ${costLabel(view.missing.micros)}`}
          </button>
          <p className="text-[11px] text-muted-foreground">Fetches only what is not cached yet: {view.missing.parts.join(", ")}. The estimate is an upper bound.</p>
        </>
      )}
      <PaidNote a={access} />
      {error && <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />}
      {[ov, pages, keywords, competitors].map((s, i) => (s.status === "error" ? <ErrorBox key={i} error={s.error} isOwner={access.isOwner} /> : null))}

      <div className="flex flex-wrap gap-3">
        <Tile label="Organic keywords" value={num(o?.organicKeywords)} badge={fresh(ov)} />
        <Tile label="Est. traffic" value={num(o?.etv !== undefined && o?.etv !== null ? Math.round(o.etv) : null)} badge={fresh(ov)} hint="Monthly visits from organic search" />
        <Tile label="Top-3 positions" value={num(top3)} badge={fresh(ov)} />
        <Tile label="Top-10 positions" value={num(top10)} badge={fresh(ov)} />
        {backlinks && (
          <Tile
            label="Backlinks"
            value={backlinks.status === "ready" && backlinks.data ? num(backlinks.data.backlinks) : "—"}
            badge={backlinks.status === "ready" ? <SourceBadge source="dataforseo" cached={backlinks.cached} fetchedAt={backlinks.fetchedAt} /> : undefined}
            hint={<Link href={`${base}/backlinks`} className="underline underline-offset-2">Open backlinks</Link>}
          />
        )}
      </div>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Position distribution</h2>
        {p ? <PositionBar positions={p} /> : miss("Position data")}
      </section>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Top pages</h2>
        {pages.status !== "ready" ? (
          miss("Top pages")
        ) : (
          <Table head={["Page", "Est. traffic", "Keywords"]}>
            {pages.data.items.map((r) => (
              <tr key={r.url}>
                <td className="max-w-[26rem] truncate px-3 py-1.5 text-left">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">{r.url}</a>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.etv !== null ? Math.round(r.etv) : null)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.keywords)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Top keywords</h2>
        {keywords.status !== "ready" ? (
          miss("Top keywords")
        ) : (
          <Table head={["Keyword", "Position", "Volume", "Est. traffic", "Difficulty"]}>
            {keywords.data.items.map((r) => (
              <tr key={`${r.keyword}|${r.url}`}>
                <td className="max-w-[22rem] truncate px-3 py-1.5 text-left">
                  <Link href={`${base}/keyword?q=${encodeURIComponent(r.keyword)}&country=${view.country}`} className="hover:underline">{r.keyword}</Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.position)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.volume)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.etv !== null ? Math.round(r.etv) : null)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(r.difficulty)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Competitors</h2>
        {competitors.status !== "ready" ? (
          miss("Competitors")
        ) : (
          <Table head={["Domain", "Shared keywords", "Keywords", "Est. traffic"]}>
            {competitors.data.items.map((c) => (
              <tr key={c.domain}>
                <td className="px-3 py-1.5 text-left">
                  <Link href={`${base}/domain?d=${encodeURIComponent(c.domain)}&country=${view.country}`} className="text-cyan-300 hover:underline">{c.domain}</Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.intersections)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.keywords)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.etv !== null ? Math.round(c.etv) : null)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
