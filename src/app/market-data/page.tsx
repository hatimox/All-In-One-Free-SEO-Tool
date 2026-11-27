export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { Database } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { ClientToolGrid, type ClientToolCard } from "@/components/shell/client-tool-grid";
import { clientScope } from "@/lib/client-scope";
import { BudgetBanner } from "@/ext/ui/budget-banner";

export default async function MarketDataIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; embed?: string }>;
}) {
  const { clientId } = await searchParams;
  if (clientId && /^\d+$/.test(clientId)) redirect(`/market-data/c/${clientId}`);

  const all = await db.select().from(clients).where(await clientScope()).orderBy(desc(clients.createdAt));
  const cards: ClientToolCard[] = all.map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    logoUrl: c.logoUrl,
    niche: c.niche,
    primary: c.country ?? "US",
    primaryTone: "cyan",
    secondary: "Volumes, ideas, domain keywords, backlinks",
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Market data"
        description="Exact keyword volumes, keyword ideas, domain keywords and backlink data from DataForSEO. Pick a client so lookups use its market and spend is attributed to it."
        icon={Database}
        accent="cyan"
      />
      <BudgetBanner />
      <ClientToolGrid cards={cards} basePath="/market-data/c" />
    </div>
  );
}
