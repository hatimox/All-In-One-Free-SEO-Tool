"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { POPULAR_COUNTRIES } from "@/lib/countries";
import { detectInput, researchHref } from "./research-input";
import { inputCls } from "./market-data-shared";

export type SearchClient = { id: number; name: string; country: string };

const selectCls = "h-10 rounded-md border border-white/10 bg-card/60 px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40";

/**
 * One box for a keyword or a domain. Navigates to the client's research
 * route; it never calls DataForSEO itself, so searching is always free.
 */
export function ResearchSearch({
  clients,
  clientId,
  initial = "",
  initialCountry,
}: {
  clients: SearchClient[];
  /** Fixed client (client route); omit to let the user choose. */
  clientId?: number;
  initial?: string;
  initialCountry?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [cid, setCid] = useState<number | undefined>(clientId ?? clients[0]?.id);
  const current = clients.find((c) => c.id === cid);
  const [country, setCountry] = useState<string | null>(initialCountry ?? null);
  const effective = country ?? current?.country ?? "US";
  const input = detectInput(text);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input || !cid) return;
    router.push(researchHref(cid, input, effective));
  };

  return (
    <form onSubmit={go} role="search" className="space-y-2 rounded-2xl border border-white/5 bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Keyword or domain"
            placeholder="Enter a keyword or a domain, e.g. vegan cookbooks or example.com"
            className={`${inputCls} h-10 pl-9`}
          />
        </div>
        {!clientId && (
          <select aria-label="Client" value={cid ?? ""} onChange={(e) => setCid(Number(e.target.value))} className={selectCls}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Country" value={effective} onChange={(e) => setCountry(e.target.value)} className={selectCls}>
          {POPULAR_COUNTRIES.some((c) => c.code === effective) ? null : <option value={effective}>{effective}</option>}
          {POPULAR_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!input || !cid}
          className="inline-flex h-10 items-center rounded-md bg-violet-500/20 px-5 text-sm font-medium text-violet-200 ring-1 ring-inset ring-violet-400/40 hover:bg-violet-500/30 disabled:opacity-50"
        >
          Search
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {input ? (input.type === "domain" ? `Opens the domain overview for ${input.value}.` : "Opens the keyword overview.") : "A domain has a dot and no spaces; anything else is a keyword."}{" "}
        Searching is free: paid data only loads when you press a button that shows its price.
      </p>
    </form>
  );
}
