export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Search } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { ResearchSearch } from "@/ext/ui/research-search";
import { RecentSearches } from "@/ext/ui/research-recent";
import { loadRecent } from "../../recent";

export default async function ClientResearchPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId: raw } = await params;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();
  const recent = await loadRecent([{ id: clientId, name: client.name }]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title={`Keyword research · ${client.name}`}
        description="Search a keyword or a domain. Nothing is bought unless you press a button that shows its price."
        icon={Search}
        accent="cyan"
        crumbs={[{ href: "/market-data", label: "Keyword research" }, { label: client.name }]}
        actions={
          <Link href={`/market-data/c/${clientId}/backlinks`} className="text-xs underline underline-offset-2">
            Backlinks
          </Link>
        }
      />
      <BudgetBanner />
      <ResearchSearch clients={[{ id: clientId, name: client.name, country: client.country ?? "US" }]} clientId={clientId} />
      <RecentSearches items={recent} />
    </div>
  );
}
