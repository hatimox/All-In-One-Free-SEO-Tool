export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Lightbulb } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { marketAccess } from "@/ext/ui/market-access";
import { IdeasTable } from "@/ext/ui/research-ideas";
import { ErrorBox } from "@/ext/ui/market-data-shared";
import { mapDfsError } from "@/ext/ui/dfs-errors";
import { marketForClient, resolveMarket } from "@/ext/dataforseo/market";
import { loadIdeas, type IdeasList, type Slice } from "../../../research";

export default async function IdeasPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ q?: string; country?: string; variant?: string }>;
}) {
  const { clientId: raw } = await params;
  const { q, country, variant } = await searchParams;
  const clientId = Number(raw);
  if (!Number.isInteger(clientId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();
  const seed = (q ?? "").trim().slice(0, 200);
  if (!seed) redirect(`/market-data/c/${clientId}`);
  const cc = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
  const v = variant === "ideas" ? "ideas" : "suggestions";

  const { access } = await marketAccess();
  const m = cc ? resolveMarket(cc, null) : await marketForClient(clientId);
  let initial: Slice<IdeasList> = { status: "miss" };
  let error: { kind: string; error: string } | null = null;
  try {
    initial = await loadIdeas({ clientId, seed, variant: v, country: cc, spend: false });
  } catch (e) {
    error = mapDfsError(e);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title={`Ideas for "${seed}"`}
        description={`Keyword ideas for ${client.name}${m ? ` · ${m.country}` : ""}`}
        icon={Lightbulb}
        accent="cyan"
        crumbs={[
          { href: "/market-data", label: "Keyword research" },
          { href: `/market-data/c/${clientId}`, label: client.name },
          { href: `/market-data/c/${clientId}/keyword?q=${encodeURIComponent(seed)}${cc ? `&country=${cc}` : ""}`, label: seed },
          { label: "Ideas" },
        ]}
      />
      <BudgetBanner />
      {error ? (
        <ErrorBox kind={error.kind} error={error.error} isOwner={access.isOwner} />
      ) : (
        <IdeasTable key={`${seed}|${m?.country}`} clientId={clientId} access={access} seed={seed} country={m?.country ?? "US"} initialVariant={v} initial={initial} />
      )}
    </div>
  );
}
