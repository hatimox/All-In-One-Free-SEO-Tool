export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Hourglass } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { marketAccess } from "@/ext/ui/market-access";
import { PendingRequest } from "@/ext/ui/pending-request";

export default async function PendingRequestPage({
  params,
}: {
  params: Promise<{ clientId: string; requestId: string }>;
}) {
  const p = await params;
  const clientId = Number(p.clientId);
  const requestId = Number(p.requestId);
  if (!Number.isInteger(clientId) || !Number.isInteger(requestId)) notFound();
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) notFound();
  const { access } = await marketAccess();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Keyword volumes"
        description={`DataForSEO lookup for ${client.name}.`}
        icon={Hourglass}
        accent="cyan"
        crumbs={[
          { href: "/market-data", label: "Market data" },
          { href: `/market-data/c/${clientId}`, label: client.name },
          { label: `Request ${requestId}` },
        ]}
      />
      <PendingRequest clientId={clientId} requestId={requestId} country={client.country ?? "US"} canTrack={access.canSpend} />
    </div>
  );
}
