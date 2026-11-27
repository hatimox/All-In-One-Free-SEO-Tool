export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Globe } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { marketAccess } from "@/ext/ui/market-access";
import { ResearchSearch } from "@/ext/ui/research-search";
import { DomainResearch } from "@/ext/ui/research-domain";
import { ErrorBox } from "@/ext/ui/market-data-shared";
import { mapDfsError } from "@/ext/ui/dfs-errors";
import { bareHost } from "@/ext/ui/research-input";
import { loadDomainView, type DomainView } from "../../../research";

export default async function DomainOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ d?: string; country?: string }>;
}) {
  const { clientId: raw } = await params;
  const { d, country } = await searchParams;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();
  const domain = bareHost(d ?? "");
  if (!domain) redirect(`/market-data/c/${clientId}`);
  const cc = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;

  const { access } = await marketAccess();
  let view: DomainView | null = null;
  let error: { kind: string; error: string } | null = null;
  try {
    view = await loadDomainView({ clientId, domain, country: cc, spend: false });
  } catch (e) {
    error = mapDfsError(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title={domain}
        description={`Domain overview for ${client.name}${view ? ` · ${view.country}` : ""}`}
        icon={Globe}
        accent="cyan"
        crumbs={[{ href: "/market-data", label: "Keyword research" }, { href: `/market-data/c/${clientId}`, label: client.name }, { label: "Domain" }]}
      />
      <BudgetBanner />
      <ResearchSearch clients={[{ id: clientId, name: client.name, country: client.country ?? "US" }]} clientId={clientId} initial={domain} initialCountry={cc} />
      {view ? <DomainResearch key={`${view.domain}|${view.country}`} clientId={clientId} access={access} initial={view} /> : error && <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />}
    </div>
  );
}
