/**
 * Shows this month's DataForSEO budget alerts (80% warning, 100% blocked).
 * Server component. Team alerts are shown to anyone who can see the page
 * (they explain why paid buttons fail); user alerts only to that user.
 */
import Link from "next/link";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { currentAlerts } from "../dataforseo/alerts";
import { accountsEnabled, currentUser } from "@/lib/auth";

export async function BudgetBanner() {
  let alerts: ReturnType<typeof currentAlerts> = [];
  try {
    const me = accountsEnabled() ? await currentUser() : null;
    alerts = currentAlerts({ userId: me ? me.id : undefined });
  } catch {
    return null;
  }
  if (alerts.length === 0) return null;
  const blocked = alerts.filter((a) => a.threshold >= 100);
  const warn = alerts.filter((a) => a.threshold < 100);
  const label = (s: string) => (s === "team" ? "The team budget" : "Your budget");
  return (
    <div className="space-y-2">
      {blocked.map((a) => (
        <div key={a.scope + a.threshold} className="flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-200 ring-1 ring-inset ring-rose-500/30">
          <OctagonAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {label(a.scope)} for DataForSEO is used up for {a.month}. Paid lookups are blocked; cached data still works.{" "}
            <Link href="/account/spend" className="underline underline-offset-2">See spend</Link>
          </span>
        </div>
      ))}
      {warn.map((a) => (
        <div key={a.scope + a.threshold} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {label(a.scope)} for DataForSEO has passed {a.threshold}% for {a.month}.{" "}
            <Link href="/account/spend" className="underline underline-offset-2">See spend</Link>
          </span>
        </div>
      ))}
    </div>
  );
}
