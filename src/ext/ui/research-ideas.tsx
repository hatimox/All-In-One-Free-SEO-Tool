"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { fetchIdeasView, trackKeywords } from "@/app/market-data/actions";
import type { IdeasList, Slice } from "@/app/market-data/research";
import type { KeywordIdea } from "../dataforseo/endpoints/labs";
import { DEFAULT_ROW_LIMIT, estimateMicros } from "../dataforseo/pricing";
import { Access, ErrorBox, Legend, PaidNote, costLabel, freeBtn, inputCls, paidBtn } from "./market-data-shared";
import { SourceBadge } from "./source-badge";
import { EMPTY_FILTERS, filterIdeas, toCsv, type IdeaFilters } from "./research-input";
import { downloadCsv, num, sectionCls, usd } from "./research-ui";

type SortKey = "keyword" | "volume" | "difficulty" | "cpc" | "competition";

export function IdeasTable({
  clientId,
  access,
  seed,
  country,
  initialVariant,
  initial,
}: {
  clientId: number;
  access: Access;
  seed: string;
  country: string;
  initialVariant: "ideas" | "suggestions";
  initial: Slice<IdeasList>;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [slice, setSlice] = useState(initial);
  const [error, setError] = useState<{ kind?: string; error: string } | null>(null);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "volume", dir: -1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const canPaid = access.canSpend && access.configured;
  const est = estimateMicros(variant === "ideas" ? "labs_keyword_ideas" : "labs_keyword_suggestions", "live", DEFAULT_ROW_LIMIT);

  const load = (v: "ideas" | "suggestions", spend: boolean) =>
    start(async () => {
      setError(null);
      setMsg(null);
      const r = await fetchIdeasView({ clientId, seed, variant: v, country, spend });
      if (!r.ok) return setError(r);
      setVariant(v);
      setSlice(r.slice);
      setSel(new Set());
    });

  const items = useMemo(() => (slice.status === "ready" ? slice.data.items : []), [slice]);
  const hasDifficulty = items.some((i) => i.difficulty !== null);
  const rows = useMemo(() => {
    const out = filterIdeas(items, f);
    return [...out].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [items, f, sort]);

  const toggle = (k: string) =>
    setSel((s) => {
      const c = new Set(s);
      if (c.has(k)) c.delete(k);
      else c.add(k);
      return c;
    });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.keyword));
  const chosen = rows.filter((r) => sel.has(r.keyword));
  const exportRows = (list: KeywordIdea[]) =>
    downloadCsv(`ideas-${seed.replace(/\W+/g, "-")}.csv`, toCsv(["keyword", "volume", "difficulty", "cpc", "competition", "intent"], list.map((i) => [i.keyword, i.volume, i.difficulty, i.cpc, i.competition, i.intent])));
  const trackSel = () =>
    start(async () => {
      try {
        const r = await trackKeywords({ clientId, keywords: chosen.map((c) => c.keyword), country });
        setMsg(r.ok ? `Tracking ${r.tracked} keyword${r.tracked === 1 ? "" : "s"}.` : (r.error ?? "Could not track."));
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Could not track.");
      }
    });

  const head = (key: SortKey, label: string, left?: boolean) => (
    <th className={`px-3 py-2.5 font-medium ${left ? "text-left" : "text-right"}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wider" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "keyword" ? 1 : -1 }))}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
  const fld = (k: keyof IdeaFilters, ph: string, w = "w-24") => (
    <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} aria-label={ph} className={`${inputCls} ${w} !py-1.5 text-xs`} inputMode={k.startsWith("m") ? "numeric" : undefined} />
  );

  return (
    <div className="space-y-4">
      <Legend />
      <section className={sectionCls}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Type</span>
          {(["suggestions", "ideas"] as const).map((v) => (
            <button key={v} type="button" disabled={busy} onClick={() => load(v, false)} className={`rounded-md px-3 py-1 ring-1 ring-inset ${variant === v ? "bg-violet-500/20 text-violet-200 ring-violet-400/40" : "text-muted-foreground ring-white/10 hover:bg-white/5"}`}>
              {v === "ideas" ? "Related ideas" : "Suggestions"}
            </button>
          ))}
          {canPaid && slice.status !== "ready" && (
            <button type="button" disabled={busy} onClick={() => load(variant, true)} className={paidBtn}>
              {busy ? "Fetching…" : `Fetch ${variant === "ideas" ? "related ideas" : "suggestions"} · ${costLabel(est)}`}
            </button>
          )}
        </div>
        <PaidNote a={access} />
        {error && <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />}
        {slice.status === "miss" && <p className="text-xs text-amber-200">Nothing cached for this lookup yet.{canPaid ? " Fetching it is a paid call; the button shows the estimate." : ""}</p>}
        {slice.status === "error" && <ErrorBox error={slice.error} isOwner={access.isOwner} />}
      </section>

      {slice.status === "ready" && (
        <section className={sectionCls}>
          <div className="flex flex-wrap items-center gap-2">
            {fld("minVol", "Min volume")}
            {fld("maxVol", "Max volume")}
            {hasDifficulty && fld("minDiff", "Min difficulty")}
            {hasDifficulty && fld("maxDiff", "Max difficulty")}
            {fld("include", "Include words", "w-40")}
            {fld("exclude", "Exclude words", "w-40")}
            <SourceBadge source="dataforseo" cached={slice.cached} fetchedAt={slice.fetchedAt} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {access.canSpend && (
              <button type="button" disabled={busy || chosen.length === 0} onClick={trackSel} className={freeBtn}>
                Track selected ({chosen.length})
              </button>
            )}
            <button type="button" onClick={() => exportRows(chosen.length ? chosen : rows)} className={freeBtn}>
              <Download className="mr-1 size-3.5" />
              Export CSV{chosen.length ? ` (${chosen.length})` : ""}
            </button>
            {msg && <span role="status" className="text-xs text-emerald-300">{msg}</span>}
          </div>
          <div className="max-h-[36rem] overflow-auto rounded-xl border border-white/5">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-white/[0.06] text-[11px] text-muted-foreground">
                  <th className="w-8 px-3 py-2.5">
                    <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.keyword)))} />
                  </th>
                  {head("keyword", "Keyword", true)}
                  {head("volume", "Volume")}
                  {head("difficulty", "Difficulty")}
                  {head("cpc", "CPC")}
                  {head("competition", "Competition")}
                  <th className="px-3 py-2.5 text-left font-medium uppercase tracking-wider">Intent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((i) => (
                  <tr key={i.keyword} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5">
                      <input type="checkbox" aria-label={`Select ${i.keyword}`} checked={sel.has(i.keyword)} onChange={() => toggle(i.keyword)} />
                    </td>
                    <td className="max-w-[22rem] truncate px-3 py-1.5">
                      <Link href={`/market-data/c/${clientId}/keyword?q=${encodeURIComponent(i.keyword)}&country=${country}`} className="hover:underline">
                        {i.keyword}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(i.volume)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(i.difficulty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(i.cpc)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.competition !== null ? i.competition.toFixed(2) : "—"}</td>
                    <td className="px-3 py-1.5 capitalize">{i.intent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Showing {rows.length.toLocaleString()} of {slice.data.items.length.toLocaleString()} loaded ({slice.data.total.toLocaleString()} total).
          </p>
        </section>
      )}
    </div>
  );
}
