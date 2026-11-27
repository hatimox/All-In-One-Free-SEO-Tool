"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Hourglass, Plus } from "lucide-react";
import {
  estimateKeywordDifficulty,
  fetchKeywordView,
  scanTopResults,
  trackKeywords,
  type TopResultsOut,
} from "@/app/market-data/actions";
import type { KeywordView } from "@/app/market-data/research";
import type { KeywordIdea } from "../dataforseo/endpoints/labs";
import { SourceBadge } from "./source-badge";
import { Access, ErrorBox, Legend, PaidNote, costLabel, freeBtn, paidBtn } from "./market-data-shared";
import { isQuestion, toCsv } from "./research-input";
import { Tile, TrendChart, downloadCsv, linkBtn, num, sectionCls, usd } from "./research-ui";

type Tab = "suggestions" | "related" | "questions";

export function KeywordResearch({ clientId, access, initial }: { clientId: number; access: Access; initial: KeywordView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [error, setError] = useState<{ kind?: string; error: string } | null>(null);
  const [busy, start] = useTransition();
  const [est, setEst] = useState<{ difficulty: number } | null>(null);
  const [estMsg, setEstMsg] = useState<string | null>(null);
  const [serp, setSerp] = useState<TopResultsOut | null>(null);
  const [tab, setTab] = useState<Tab>("suggestions");
  const [tracked, setTracked] = useState(false);
  const canPaid = access.canSpend && access.configured && view.configured;
  const { keyword, country } = view;
  const m = view.metrics;
  const base = `/market-data/c/${clientId}`;

  const getFull = () =>
    start(async () => {
      setError(null);
      const r = await fetchKeywordView({ clientId, keyword, country, spend: true });
      if (!r.ok) return setError(r);
      if (r.view.pendingRequestId) {
        router.push(`${base}/requests/${r.view.pendingRequestId}`);
        return;
      }
      setView(r.view);
    });

  const runEstimate = () =>
    start(async () => {
      setEstMsg(null);
      const r = await estimateKeywordDifficulty({ clientId, keyword });
      if (r.ok) setEst({ difficulty: r.difficulty });
      else setEstMsg(r.error);
    });

  const runScan = () =>
    start(async () => setSerp(await scanTopResults({ clientId, keyword, country })));

  const track = () =>
    start(async () => {
      try {
        const r = await trackKeywords({ clientId, keywords: [keyword], country });
        if (r.ok) setTracked(true);
        else setError({ error: r.error ?? "Could not track." });
      } catch (e) {
        setError({ error: e instanceof Error ? e.message : "Could not track." });
      }
    });

  const ideas = (s: KeywordView["suggestions"]) => (s.status === "ready" ? s.data.items : []);
  const lists: Record<Tab, KeywordIdea[]> = {
    suggestions: ideas(view.suggestions),
    related: ideas(view.related),
    questions: [...ideas(view.suggestions), ...ideas(view.related)].filter((i, ix, a) => isQuestion(i.keyword) && a.findIndex((x) => x.keyword === i.keyword) === ix),
  };
  const shown = lists[tab].slice(0, 10);
  const difficulty = est ? est.difficulty : view.difficulty.difficulty;
  const diffSource = est ? "estimate" : view.difficulty.source;

  const exportCsv = () =>
    downloadCsv(
      `keyword-${keyword.replace(/\W+/g, "-")}.csv`,
      toCsv(
        ["keyword", "volume", "difficulty", "cpc", "competition", "intent", "source"],
        [
          [keyword, m?.volume, difficulty, m?.cpc, m?.competition, view.intent.intent, m?.source],
          ...lists.suggestions.concat(lists.related).map((i) => [i.keyword, i.volume, i.difficulty, i.cpc, i.competition, i.intent, "dataforseo"]),
        ],
      ),
    );

  return (
    <div className="space-y-4">
      <Legend />
      {view.pendingRequestId && (
        <Link href={`${base}/requests/${view.pendingRequestId}`} className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/25">
          <Hourglass className="size-3.5" /> Exact volume is in the DataForSEO queue. Open the pending page.
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canPaid && view.missing.micros > 0 && (
          <button type="button" disabled={busy} onClick={getFull} className={paidBtn}>
            {busy ? "Fetching…" : `Get full data · ${costLabel(view.missing.micros)}`}
          </button>
        )}
        {access.canSpend && (
          <button type="button" disabled={busy || tracked} onClick={track} className={freeBtn}>
            <Plus className="mr-1 size-3.5" />
            {tracked ? "Tracked" : "Track"}
          </button>
        )}
        <button type="button" onClick={exportCsv} className={freeBtn}>
          <Download className="mr-1 size-3.5" />
          Export CSV
        </button>
      </div>
      {canPaid && view.missing.micros > 0 && (
        <p className="text-[11px] text-muted-foreground">Fetches only what is not cached yet: {view.missing.parts.join(", ")}. The estimate is an upper bound.</p>
      )}
      <PaidNote a={access} />
      {error && <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />}

      <div className="flex flex-wrap gap-3">
        <Tile
          label="Search volume"
          value={m?.volume != null ? m.volume.toLocaleString() : m?.volumeBucket ? m.volumeBucket.replace("_", " ") : "—"}
          badge={m && <SourceBadge source={m.source} fetchedAt={m.fetchedAt} cached={m.cached} pending={m.pending} />}
          hint="Searches per month"
        />
        <Tile
          label="SEO difficulty"
          value={difficulty != null ? `${Math.round(difficulty)}/100` : "—"}
          badge={difficulty != null || view.difficulty.fallbackReason ? <SourceBadge source={diffSource} cached={!est && view.difficulty.cached} /> : undefined}
          hint={estMsg ?? (difficulty == null ? "Not loaded yet" : diffSource === "estimate" ? "Heuristic from the live results page" : "Higher is harder to rank")}
        >
          {difficulty == null && access.canSpend && (!view.configured || view.difficulty.needsFreeEstimate) && (
            <button type="button" disabled={busy} onClick={runEstimate} className={`${linkBtn} mt-2`}>
              Estimate difficulty (free)
            </button>
          )}
        </Tile>
        <Tile label="CPC" value={usd(m?.cpc)} badge={m && m.cpc != null ? <SourceBadge source={m.source} cached={m.cached} /> : undefined} hint="Average cost per click" />
        <Tile label="Competition" value={m?.competition != null ? m.competition.toFixed(2) : "—"} badge={m && m.competition != null ? <SourceBadge source={m.source} cached={m.cached} /> : undefined} hint="Advertiser competition, 0 to 1" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Search intent</span>
        {view.intent.intent ? (
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-medium capitalize text-violet-200 ring-1 ring-inset ring-violet-400/30">{view.intent.intent}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {view.intent.intent && <SourceBadge source="dataforseo" cached={view.intent.cached} />}
      </div>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Search volume, last 12 months</h2>
        <TrendChart values={m?.trend ?? null} />
      </section>

      <section className={sectionCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Keyword ideas</h2>
          <div role="tablist" className="flex gap-1.5 text-xs">
            {(["suggestions", "related", "questions"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 capitalize ring-1 ring-inset ${tab === t ? "bg-violet-500/20 text-violet-200 ring-violet-400/40" : "text-muted-foreground ring-white/10 hover:bg-white/5"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {view.suggestions.status === "ready" || view.related.status === "ready" ? "No ideas in this group." : "Not loaded yet. Ideas come with the full data button."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Keyword</th>
                  <th className="px-3 py-2 text-right font-medium">Volume</th>
                  <th className="px-3 py-2 text-right font-medium">Difficulty</th>
                  <th className="px-3 py-2 text-right font-medium">CPC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {shown.map((i) => (
                  <tr key={i.keyword}>
                    <td className="px-3 py-1.5">
                      <Link href={`${base}/keyword?q=${encodeURIComponent(i.keyword)}&country=${country}`} className="hover:underline">
                        {i.keyword}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(i.volume)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(i.difficulty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(i.cpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link href={`${base}/ideas?q=${encodeURIComponent(keyword)}&country=${country}`} className="inline-block text-xs underline underline-offset-2">
          View all
        </Link>
      </section>

      <section className={sectionCls}>
        <h2 className="text-sm font-semibold">Top 10 results</h2>
        {access.canSpend ? (
          <button type="button" disabled={busy} onClick={runScan} className={freeBtn}>
            {busy && !serp ? "Scanning…" : "Scan top 10 (free)"}
          </button>
        ) : (
          <p className="text-[11px] text-muted-foreground">Your role is read-only, so the live scan is unavailable.</p>
        )}
        {serp && !serp.ok && <ErrorBox error={serp.error} isOwner={access.isOwner} />}
        {serp?.ok && (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Title</th>
                  <th className="px-3 py-2 text-left font-medium">URL</th>
                  <th className="px-3 py-2 text-left font-medium">Domain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {serp.results.map((r) => (
                  <tr key={r.position}>
                    <td className="px-3 py-1.5 tabular-nums">{r.position}</td>
                    <td className="max-w-[20rem] truncate px-3 py-1.5">{r.title}</td>
                    <td className="max-w-[20rem] truncate px-3 py-1.5">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                        {r.url}
                      </a>
                    </td>
                    <td className="px-3 py-1.5">
                      <Link href={`${base}/domain?d=${encodeURIComponent(r.domain)}&country=${country}`} className="hover:underline">
                        {r.domain}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
