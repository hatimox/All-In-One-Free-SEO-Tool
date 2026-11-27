export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { Search } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { clientScope } from "@/lib/client-scope";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { ResearchSearch } from "@/ext/ui/research-search";
import { RecentSearches } from "@/ext/ui/research-recent";
import { loadRecent } from "./recent";

export default async function KeywordResearchIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; embed?: string }>;
}) {
  const { clientId } = await searchParams;
  if (clientId && /^\d+$/.test(clientId)) redirect(`/market-data/c/${clientId}`);

  const all = await db.select().from(clients).where(await clientScope()).orderBy(desc(clients.createdAt));
  const recent = await loadRecent(all.map((c) => ({ id: c.id, name: c.name })));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Keyword research"
        description="Search a keyword or a domain for volume, difficulty, ideas, top pages and competitors from DataForSEO. Lookups use the client's market and spend is attributed to it."
        icon={Search}
        accent="cyan"
      />
      <BudgetBanner />
      {all.length === 0 ? (
        <p className="rounded-2xl border border-white/5 bg-card/40 p-5 text-sm text-muted-foreground">Add a client first: research runs in a client&apos;s market.</p>
      ) : (
        <>
          <ResearchSearch clients={all.map((c) => ({ id: c.id, name: c.name, country: c.country ?? "US" }))} />
          <RecentSearches items={recent} showClient />
        </>
      )}
    </div>
  );
}
