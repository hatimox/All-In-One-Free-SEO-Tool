import Link from "next/link";
import { Globe, Hourglass, Search } from "lucide-react";
import type { RecentItem } from "@/app/market-data/recent";

/** Reopening a recent search is free: pages read the cache first. */
export function RecentSearches({ items, showClient }: { items: RecentItem[]; showClient?: boolean }) {
  return (
    <section className="space-y-2 rounded-2xl border border-white/5 bg-card/40 p-5" aria-label="Recent searches">
      <h2 className="text-sm font-semibold">Recent searches</h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet. Search a keyword or a domain above.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {items.map((i) => (
            <li key={`${i.clientId}|${i.type}|${i.label}|${i.country}`}>
              <Link href={i.href} className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-white/[0.03]">
                {i.type === "domain" ? <Globe className="size-3.5 text-cyan-300" /> : <Search className="size-3.5 text-violet-300" />}
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {i.pending && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
                    <Hourglass className="size-3" /> pending
                  </span>
                )}
                {showClient && i.clientName && <span className="hidden text-[11px] text-muted-foreground sm:inline">{i.clientName}</span>}
                {i.country && <span className="text-[11px] text-muted-foreground">{i.country}</span>}
                <span className="text-[11px] text-muted-foreground">{i.at.slice(0, 10)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
