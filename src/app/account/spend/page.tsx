export const dynamic = "force-dynamic";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { accountsEnabled, currentUser } from "@/lib/auth";
import { getSettings } from "@/ext/dataforseo/config";
import { BudgetBanner } from "@/ext/ui/budget-banner";
import { spendOverview } from "@/ext/ui/spend-data";
import { SpendView } from "@/ext/ui/spend-view";

export default async function MySpendPage() {
  const header = (
    <PageHeader
      title="My DataForSEO spend"
      description="What paid DataForSEO lookups you have triggered this month, against your personal cap."
      icon={Wallet}
    />
  );
  const settings = await getSettings();
  const me = accountsEnabled() ? await currentUser() : null;

  if (accountsEnabled() && !me) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Sign in to see your spend.</p>
      </div>
    );
  }

  // Accounts off (single-user install): spend has no user attribution, so show the team figure.
  const overview = me ? spendOverview({ userId: me.id }) : spendOverview();
  const cap = me ? (settings.userCaps[String(me.id)] ?? null) : settings.teamCapUsd;
  return (
    <div className="space-y-6">
      {header}
      <BudgetBanner />
      <SpendView overview={overview} capUsd={cap} capLabel={me ? "personal cap" : "team cap"} detailed={false} />
      {me && settings.userCaps[String(me.id)] === undefined && (
        <p className="text-xs text-muted-foreground">
          You have no personal cap; only the team cap applies
          {settings.teamCapUsd !== null
            ? ` ($${settings.teamCapUsd.toFixed(2)} per month)`
            : " (it is not set, so paid calls are blocked)"}
          .
          {me.role === "owner" && (
            <>
              {" "}
              <Link href="/settings/dataforseo" className="underline underline-offset-2">
                Change budgets
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
