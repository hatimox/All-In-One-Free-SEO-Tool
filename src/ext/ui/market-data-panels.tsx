"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  lookupBacklinkGap,
  lookupBacklinks,
  lookupIdeas,
  lookupKeywords,
  lookupRankedKeywords,
  type BacklinksOut,
  type KeywordsOut,
  type LiveOut,
} from "@/app/market-data/actions";
import type { GapDomain } from "../dataforseo/endpoints/backlinks";
import type { KeywordIdea, RankedKeyword } from "../dataforseo/endpoints/labs";
import { estimateMicros, type Mode } from "../dataforseo/pricing";
import {
  Access,
  ErrorBox,
  Legend,
  MetricsTable,
  PaidNote,
  Sparkline,
  costLabel,
  freeBtn,
  inputCls,
  paidBtn,
  volumeCost,
} from "./market-data-shared";

type Common = { clientId: number; access: Access };

const sectionCls = "space-y-3 rounded-2xl border border-white/5 bg-card/40 p-5 scroll-mt-24";

function Provenance({ cached, fetchedAt, costUsd }: { cached: boolean; fetchedAt: string; costUsd: number }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      DataForSEO · as of {fetchedAt.slice(0, 10)} · {cached ? "cached, no new spend" : `fetched now, cost $${costUsd.toFixed(4)}`}
    </p>
  );
}

function Miss() {
  return (
    <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/25">
      Nothing cached for this lookup yet. Fetching it is a paid call; the button above shows the estimate.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export function KeywordsPanel({
  clientId,
  access,
  country,
  mode,
}: Common & { country: string; mode: Mode }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [out, setOut] = useState<KeywordsOut | null>(null);
  const [busy, start] = useTransition();
  const count = new Set(text.split(/\r?\n|,/).map((s) => s.trim().toLowerCase()).filter(Boolean)).size;
  const canPaid = access.canSpend && access.configured;

  const run = (spend: boolean) =>
    start(async () => {
      const r = await lookupKeywords({ clientId, keywords: text, spend });
      if (r.ok && r.status === "pending") {
        router.push(`/market-data/c/${clientId}/requests/${r.requestId}`);
        return;
      }
      setOut(r);
    });

  return (
    <section id="keywords" className={sectionCls}>
      <Legend />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"one keyword per line\nvegan cookbooks\nmeal planner app"}
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || count === 0} className={freeBtn} onClick={() => run(false)}>
          {busy ? "Looking up…" : "Look up (cached, free)"}
        </button>
        {canPaid && (
          <button type="button" disabled={busy || count === 0} className={paidBtn} onClick={() => run(true)}>
            Get exact volumes · {costLabel(volumeCost(count, mode))}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {mode === "standard"
          ? "Standard queue: results usually arrive in a few minutes and you will be taken to a pending screen."
          : "Live mode: results come back immediately at a higher price."}{" "}
        Keywords already cached are free; the estimate is an upper bound.
      </p>
      <PaidNote a={access} />
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={access.isOwner} />}
      {out?.ok && (
        <MetricsTable items={out.items} clientId={clientId} country={country} canTrack={access.canSpend} />
      )}
      {out?.ok && canPaid && out.items.some((i) => i.source !== "dataforseo") && (
        <p className="text-[11px] text-muted-foreground">
          Rows not badged DataForSEO come from a fallback source; use the paid button above for exact figures.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

type IdeasData = { total: number; items: KeywordIdea[] };

export function IdeasPanel({ clientId, access }: Common) {
  const [seeds, setSeeds] = useState("");
  const [variant, setVariant] = useState<"ideas" | "suggestions">("ideas");
  const [out, setOut] = useState<LiveOut<IdeasData> | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured;
  const est = estimateMicros(variant === "ideas" ? "labs_keyword_ideas" : "labs_keyword_suggestions", "live", 200);
  const run = (spend: boolean) => start(async () => setOut(await lookupIdeas({ clientId, seeds, variant, spend })));

  return (
    <section id="ideas" className={sectionCls}>
      <Legend />
      <textarea value={seeds} onChange={(e) => setSeeds(e.target.value)} rows={3} placeholder="seed keywords, one per line" className={inputCls} />
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Type</span>
        <select value={variant} onChange={(e) => setVariant(e.target.value as "ideas" | "suggestions")} className="h-8 rounded-md border border-white/10 bg-card/60 px-2 text-xs">
          <option value="ideas">Ideas (related topics, many seeds)</option>
          <option value="suggestions">Suggestions (phrases containing the first seed)</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !seeds.trim()} className={freeBtn} onClick={() => run(false)}>
          {busy ? "Looking up…" : "Look up (cached, free)"}
        </button>
        {canPaid && (
          <button type="button" disabled={busy || !seeds.trim()} className={paidBtn} onClick={() => run(true)}>
            Fetch ideas · {costLabel(est)}
          </button>
        )}
      </div>
      <PaidNote a={access} />
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={access.isOwner} />}
      {out?.ok && out.status === "cache_miss" && <Miss />}
      {out?.ok && out.status === "ready" && (
        <>
          <Provenance cached={out.cached} fetchedAt={out.fetchedAt} costUsd={out.costUsd} />
          <Table
            head={["Keyword", "Volume", "CPC", "Difficulty", "Intent", "12 months"]}
            rows={out.data.items.map((i) => [
              i.keyword,
              num(i.volume),
              i.cpc !== null ? `$${i.cpc.toFixed(2)}` : "—",
              num(i.difficulty),
              i.intent ?? "—",
              <Sparkline key="s" values={i.trend} />,
            ])}
            total={out.data.total}
          />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Domain keywords
// ---------------------------------------------------------------------------

type RankedData = { total: number; items: RankedKeyword[] };

export function DomainPanel({
  clientId,
  access,
  ownDomain,
  competitors,
}: Common & { ownDomain: string | null; competitors: string[] }) {
  const [target, setTarget] = useState(ownDomain ?? "");
  const [out, setOut] = useState<LiveOut<RankedData> | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured;
  const est = estimateMicros("labs_ranked_keywords", "live", 200);
  const run = (spend: boolean) => start(async () => setOut(await lookupRankedKeywords({ clientId, target, spend })));
  return (
    <section id="domain" className={sectionCls}>
      <Legend />
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="example.com" className={`${inputCls} max-w-md`} />
      {(ownDomain || competitors.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Suggestions:</span>
          {[...(ownDomain ? [ownDomain] : []), ...competitors].map((d) => (
            <button key={d} type="button" onClick={() => setTarget(d)} className="rounded-full border border-white/10 px-2 py-0.5 hover:bg-white/10">
              {d}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !target.trim()} className={freeBtn} onClick={() => run(false)}>
          {busy ? "Looking up…" : "Look up (cached, free)"}
        </button>
        {canPaid && (
          <button type="button" disabled={busy || !target.trim()} className={paidBtn} onClick={() => run(true)}>
            Fetch domain keywords · {costLabel(est)}
          </button>
        )}
      </div>
      <PaidNote a={access} />
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={access.isOwner} />}
      {out?.ok && out.status === "cache_miss" && <Miss />}
      {out?.ok && out.status === "ready" && (
        <>
          <Provenance cached={out.cached} fetchedAt={out.fetchedAt} costUsd={out.costUsd} />
          <Table
            head={["Keyword", "Position", "Volume", "Est. traffic", "Difficulty", "URL"]}
            rows={out.data.items.map((i) => [i.keyword, num(i.position), num(i.volume), num(i.etv), num(i.difficulty), i.url ?? "—"])}
            total={out.data.total}
          />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export function BacklinksPanel({
  clientId,
  access,
  backlinksEnabled,
}: Common & { backlinksEnabled: boolean }) {
  const [out, setOut] = useState<BacklinksOut | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured && backlinksEnabled;
  const est = estimateMicros("backlinks_summary", "live", 1) + estimateMicros("backlinks_referring_domains", "live", 100);
  const run = (spend: boolean) => start(async () => setOut(await lookupBacklinks({ clientId, spend })));

  if (!backlinksEnabled || !access.configured) {
    return (
      <section id="backlinks" className={sectionCls}>
        <p className="text-sm text-muted-foreground">
          {!access.configured
            ? "DataForSEO is not configured, so paid backlink data is unavailable."
            : "DataForSEO backlink data is switched off. Enable it in Settings → DataForSEO (your DataForSEO account may need a separate Backlinks subscription)."}{" "}
          The built-in backlink tracker still works:{" "}
          <Link href={`/backlinks/c/${clientId}`} className="font-medium underline underline-offset-2">
            open this client&apos;s backlinks
          </Link>
          .
        </p>
        {access.isOwner && (
          <Link href="/settings/dataforseo" className="text-xs underline underline-offset-2">
            Settings → DataForSEO
          </Link>
        )}
      </section>
    );
  }

  return (
    <section id="backlinks" className={sectionCls}>
      <Legend />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={freeBtn} onClick={() => run(false)}>
          {busy ? "Looking up…" : "Look up (cached, free)"}
        </button>
        {canPaid && (
          <button type="button" disabled={busy} className={paidBtn} onClick={() => run(true)}>
            Fetch backlink summary · {costLabel(est)}
          </button>
        )}
      </div>
      <PaidNote a={access} />
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={access.isOwner} />}
      {out?.ok && out.status === "cache_miss" && <Miss />}
      {out?.ok && out.status === "ready" && (
        <>
          <Provenance cached={out.cached} fetchedAt={out.fetchedAt} costUsd={out.costUsd} />
          {out.summary && (
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
              {(
                [
                  ["Backlinks", out.summary.backlinks],
                  ["Referring domains", out.summary.referringDomains],
                  ["Referring pages", out.summary.referringPages],
                  ["Broken backlinks", out.summary.brokenBacklinks],
                  ["Rank", out.summary.rank],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="rounded-lg border border-white/5 bg-card/40 p-3">
                  <div className="text-muted-foreground">{l}</div>
                  <div className="text-base font-semibold tabular-nums">{num(v)}</div>
                </div>
              ))}
            </div>
          )}
          {out.partialError && <ErrorBox error={out.partialError} isOwner={access.isOwner} />}
          {out.domains.length > 0 && (
            <Table
              head={["Referring domain", "Backlinks", "Rank", "First seen", "Spam score"]}
              rows={out.domains.map((d) => [d.domain, num(d.backlinks), num(d.rank), d.firstSeen?.slice(0, 10) ?? "—", num(d.spamScore)])}
              total={out.domainsTotal}
            />
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gap
// ---------------------------------------------------------------------------

type GapData = { total: number; items: GapDomain[] };

export function GapPanel({
  clientId,
  access,
  backlinksEnabled,
  competitors,
}: Common & { backlinksEnabled: boolean; competitors: string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [out, setOut] = useState<LiveOut<GapData> | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured && backlinksEnabled;
  const all = [...picked, ...extra.split(/[\s,]+/).filter(Boolean)];
  const est = estimateMicros("backlinks_domain_intersection", "live", 200);
  const run = (spend: boolean) => start(async () => setOut(await lookupBacklinkGap({ clientId, competitors: all, spend })));

  if (!backlinksEnabled || !access.configured) {
    return (
      <section id="gap" className={sectionCls}>
        <p className="text-sm text-muted-foreground">
          Backlink gap needs DataForSEO backlink data, which is {access.configured ? "switched off" : "not configured"}.{" "}
          <Link href={`/backlinks/c/${clientId}`} className="font-medium underline underline-offset-2">
            Open this client&apos;s backlinks
          </Link>{" "}
          for the built-in tracker.
        </p>
      </section>
    );
  }

  return (
    <section id="gap" className={sectionCls}>
      <Legend />
      <p className="text-xs text-muted-foreground">Domains that link to your competitors but not to this client.</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {competitors.map((c) => (
          <label key={c} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={picked.includes(c)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))}
            />
            {c}
          </label>
        ))}
        {competitors.length === 0 && <span className="text-muted-foreground">No competitors saved for this client yet.</span>}
      </div>
      <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="other competitor domains, comma separated" className={`${inputCls} max-w-md`} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || all.length === 0} className={freeBtn} onClick={() => run(false)}>
          {busy ? "Looking up…" : "Look up (cached, free)"}
        </button>
        {canPaid && (
          <button type="button" disabled={busy || all.length === 0} className={paidBtn} onClick={() => run(true)}>
            Find link gap · {costLabel(est)}
          </button>
        )}
      </div>
      <PaidNote a={access} />
      {out && !out.ok && <ErrorBox kind={out.kind} error={out.error} isOwner={access.isOwner} />}
      {out?.ok && out.status === "cache_miss" && <Miss />}
      {out?.ok && out.status === "ready" && (
        <>
          <Provenance cached={out.cached} fetchedAt={out.fetchedAt} costUsd={out.costUsd} />
          <Table
            head={["Domain", "Competitors linking", "Rank", "Backlinks"]}
            rows={out.data.items.map((d) => [d.domain, num(d.intersections), num(d.rank), num(d.backlinks)])}
            total={out.data.total}
          />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString();
}

function Table({ head, rows, total }: { head: string[]; rows: React.ReactNode[][]; total: number }) {
  return (
    <div className="space-y-1">
      <div className="max-h-[32rem] overflow-auto rounded-xl border border-white/5 bg-card/40">
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
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-white/[0.02]">
                {r.map((c, ci) => (
                  <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? "text-left" : "text-right tabular-nums"} max-w-[22rem] truncate`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Showing {rows.length.toLocaleString()} of {total.toLocaleString()} results.
      </p>
    </div>
  );
}
