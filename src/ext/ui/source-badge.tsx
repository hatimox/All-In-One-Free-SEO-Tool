/**
 * Says where a keyword number came from. Modeled on RankSourceBadge: the
 * sources measure different things, so a bare "1,300" would mislead.
 */
import { Database, Globe, Search, Sparkles, TrendingUp } from "lucide-react";
import { sourceBadgeLabel, sourceBadgeTitle } from "./source-badge-label";

export { sourceBadgeLabel } from "./source-badge-label";

const TONE: Record<string, string> = {
  dataforseo: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  google_ads: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  gsc: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
  bing: "bg-white/5 text-muted-foreground ring-white/10",
  estimate: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
};

export function SourceBadge({
  source,
  fetchedAt,
  cached,
  fallbackReason,
  pending,
  className,
}: {
  source: string;
  fetchedAt?: Date | string | null;
  cached?: boolean;
  fallbackReason?: string | null;
  pending?: boolean;
  className?: string;
}) {
  const Icon =
    source === "dataforseo" ? Database : source === "google_ads" ? Search : source === "estimate" ? Sparkles : source === "bing" ? Globe : TrendingUp;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${TONE[source] ?? TONE.bing} ${className ?? ""}`}
      title={sourceBadgeTitle({ source, fetchedAt, cached, fallbackReason, pending })}
    >
      <Icon className="size-2.5" />
      {sourceBadgeLabel(source)}
      {cached ? <span className="opacity-70">· cached</span> : null}
      {pending ? <span className="opacity-70">· provisional</span> : null}
    </span>
  );
}
