export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { Database } from "lucide-react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { PageHeader } from "@/components/shell/page-header";
import { credentialStatus, getSettings } from "@/ext/dataforseo/config";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { CredentialsForm, SpendSettingsForm } from "@/ext/ui/dfs-settings-forms";
import { spendOverview } from "@/ext/ui/spend-data";
import { SpendView } from "@/ext/ui/spend-view";

export default async function DataForSeoSettingsPage() {
  const [cred, settings] = await Promise.all([credentialStatus(), getSettings()]);
  const team = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.active, true))
    .all();
  const overview = spendOverview();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="DataForSEO"
        description="Exact keyword volumes, keyword ideas and backlink data from DataForSEO. Every paid lookup is an explicit button with its cost shown, capped by the budgets below, and cached so the same data is never paid for twice."
        icon={Database}
        accent="cyan"
        crumbs={[{ href: "/settings", label: "Settings" }, { label: "DataForSEO" }]}
      />
      <BudgetBanner />

      <section className="space-y-3 rounded-2xl border border-white/5 bg-card/40 p-5">
        <h2 className="text-base font-semibold">Credentials</h2>
        <CredentialsForm configured={cred.configured} source={cred.source} loginHint={cred.loginHint} />
      </section>

      <section className="space-y-3 rounded-2xl border border-white/5 bg-card/40 p-5">
        <h2 className="text-base font-semibold">Budget and behaviour</h2>
        <SpendSettingsForm
          teamCapUsd={settings.teamCapUsd}
          requestMaxUsd={settings.requestMaxUsd}
          ttlDays={settings.ttlDays}
          defaultMode={settings.defaultMode}
          automationsMaySpend={settings.automationsMaySpend}
          backlinksEnabled={settings.backlinksEnabled}
          users={team.map((u) => ({
            id: u.id,
            label: u.name || u.email,
            cap: settings.userCaps[String(u.id)] ?? null,
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Spend this month</h2>
        <SpendView overview={overview} capUsd={settings.teamCapUsd} capLabel="team cap" />
      </section>
    </div>
  );
}
