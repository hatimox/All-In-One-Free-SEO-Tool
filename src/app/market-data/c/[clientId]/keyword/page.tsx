export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Search } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { marketAccess } from "@/ext/ui/market-access";
import { ResearchSearch } from "@/ext/ui/research-search";
import { KeywordResearch } from "@/ext/ui/research-keyword";
import { ErrorBox } from "@/ext/ui/market-data-shared";
import { mapDfsError } from "@/ext/ui/dfs-errors";
import { loadKeywordView, type KeywordView } from "../../../research";

export default async function KeywordOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ q?: string; country?: string }>;
}) {
  const { clientId: raw } = await params;
  const { q, country } = await searchParams;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();
  const keyword = (q ?? "").trim().slice(0, 200);
  if (!keyword) redirect(`/market-data/c/${clientId}`);
  const cc = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;

  const { access } = await marketAccess();
  let view: KeywordView | null = null;
  let error: { kind: string; error: string } | null = null;
  try {
    view = await loadKeywordView({ clientId, keyword, country: cc, spend: false });
  } catch (e) {
    error = mapDfsError(e);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={keyword}
        description={`Keyword overview for ${client.name}${view ? ` · ${view.country}` : ""}`}
        icon={Search}
        accent="cyan"
        crumbs={[{ href: "/market-data", label: "Keyword research" }, { href: `/market-data/c/${clientId}`, label: client.name }, { label: "Keyword" }]}
      />
      <BudgetBanner />
      <ResearchSearch clients={[{ id: clientId, name: client.name, country: client.country ?? "US" }]} clientId={clientId} initial={keyword} initialCountry={cc} />
      {view ? <KeywordResearch key={`${view.keyword}|${view.country}`} clientId={clientId} access={access} initial={view} /> : error && <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />}
    </div>
  );
}
