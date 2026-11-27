export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Link2 } from "lucide-react";
import { db } from "@/db/client";
import { clients, competitors } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { PageTabs, type PageTab } from "@/components/shell/page-tabs";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { marketAccess } from "@/ext/ui/market-access";
import { BacklinksPanel, GapPanel } from "@/ext/ui/market-data-panels";

const TABS: readonly PageTab[] = [
  { id: "backlinks", label: "Backlinks", primary: true, sections: ["backlinks"] },
  { id: "gap", label: "Gap", sections: ["gap"] },
];

export default async function BacklinksPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId: raw } = await params;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();

  const { access, settings } = await marketAccess();
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
        title={`Backlinks · ${client.name}`}
        description="Backlink summary, referring domains and link gap against competitors. Nothing is bought unless you press a button that shows its price."
        icon={Link2}
        accent="cyan"
        crumbs={[{ href: "/market-data", label: "Keyword research" }, { href: `/market-data/c/${clientId}`, label: client.name }, { label: "Backlinks" }]}
      />
      <BudgetBanner />
      <PageTabs tabs={TABS} panelId="backlinks-panels" panelClassName="space-y-4">
        <BacklinksPanel clientId={clientId} access={access} backlinksEnabled={settings.backlinksEnabled} />
        <GapPanel clientId={clientId} access={access} backlinksEnabled={settings.backlinksEnabled} competitors={comps} />
      </PageTabs>
    </div>
  );
}
