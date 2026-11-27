export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Database } from "lucide-react";
import { db } from "@/db/client";
import { clients, competitors } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { PageTabs, type PageTab } from "@/components/shell/page-tabs";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { marketAccess } from "@/ext/ui/market-access";
import { clientDomain } from "@/ext/dataforseo/market";
import {
  BacklinksPanel,
  DomainPanel,
  GapPanel,
  IdeasPanel,
  KeywordsPanel,
} from "@/ext/ui/market-data-panels";

const TABS: readonly PageTab[] = [
  { id: "keywords", label: "Keywords", primary: true, sections: ["keywords"] },
  { id: "ideas", label: "Ideas", sections: ["ideas"] },
  { id: "domain", label: "Domain keywords", sections: ["domain"] },
  { id: "backlinks", label: "Backlinks", sections: ["backlinks"] },
  { id: "gap", label: "Gap", sections: ["gap"] },
];

export default async function ClientMarketDataPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId: raw } = await params;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();

  const { access, settings } = await marketAccess();
  const ownDomain = await clientDomain(clientId);
  const comps = db
    .select({ url: competitors.url })
    .from(competitors)
    .where(eq(competitors.clientId, clientId))
    .all()
    .map((c) => c.url.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""))
    .filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title={`Market data · ${client.name}`}
        description="Exact volumes, ideas, domain keywords and backlinks for this client's market. Nothing is bought unless you press a button that shows its price."
        icon={Database}
        accent="cyan"
        crumbs={[{ href: "/market-data", label: "Market data" }, { label: client.name }]}
      />
      <BudgetBanner />
      <PageTabs tabs={TABS} panelId="market-data-panels" panelClassName="space-y-4">
        <KeywordsPanel clientId={clientId} access={access} country={client.country ?? "US"} mode={settings.defaultMode} />
        <IdeasPanel clientId={clientId} access={access} />
        <DomainPanel clientId={clientId} access={access} ownDomain={ownDomain} competitors={comps} />
        <BacklinksPanel clientId={clientId} access={access} backlinksEnabled={settings.backlinksEnabled} />
        <GapPanel clientId={clientId} access={access} backlinksEnabled={settings.backlinksEnabled} competitors={comps} />
      </PageTabs>
    </div>
  );
}
