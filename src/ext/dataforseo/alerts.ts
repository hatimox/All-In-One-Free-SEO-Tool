/**
 * Budget threshold alerts (80% / 100%), once per scope+threshold+month.
 * `checkAlerts` is called after a settle. The unique index on
 * ext_dfs_alerts makes "once" race-safe (INSERT OR IGNORE; only the
 * inserter notifies). Email failure never throws.
 */
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/db/client";
import { users } from "@/db/schema";
import { logActivity, type ActivityKind } from "@/lib/activity";
import { sendMail } from "@/lib/mailer";
import { monthKey, spentMicros } from "./budget";
import { getSettings } from "./config";
import { extDfsAlerts } from "../db/schema";

export const THRESHOLDS = [80, 100] as const;

export type DfsAlert = { month: string; scope: string; threshold: number; sentAt: Date };

function tryInsert(month: string, scope: string, threshold: number): boolean {
  const r = sqlite
    .prepare("INSERT OR IGNORE INTO ext_dfs_alerts (month, scope, threshold, sent_at) VALUES (?, ?, ?, ?)")
    .run(month, scope, threshold, Date.now());
  return r.changes > 0;
}

async function notify(scope: string, threshold: number, spentUsd: number, capUsd: number): Promise<void> {
  const label = scope === "team" ? "The team" : "A user (" + scope + ")";
  const message =
    label + " has used " + threshold + "% of the monthly DataForSEO budget ($" +
    spentUsd.toFixed(2) + " of $" + capUsd.toFixed(2) + ").";
  try {
    await logActivity({
      kind: "dataforseo.budget_alert" as ActivityKind,
      message,
      level: threshold >= 100 ? "error" : "warning",
      dedupe: false,
    });
  } catch {
    /* activity log is best-effort */
  }
  try {
    const owners = db.select({ email: users.email }).from(users)
      .where(and(eq(users.role, "owner"), eq(users.active, true))).all()
      .map((o) => o.email);
    if (owners.length) {
      await sendMail({ to: owners, subject: "DataForSEO budget at " + threshold + "%", text: message });
    }
  } catch {
    /* SMTP missing or failing must not break the paid call */
  }
}

/** Returns the alerts newly raised by this check. */
export async function checkAlerts(opts: { userId: number | null; now?: Date }): Promise<DfsAlert[]> {
  const now = opts.now ?? new Date();
  const month = monthKey(now);
  const s = await getSettings();
  const raised: DfsAlert[] = [];
  const targets: { scope: string; spent: number; cap: number }[] = [];
  if (s.teamCapUsd) targets.push({ scope: "team", spent: spentMicros(undefined, now) / 1e6, cap: s.teamCapUsd });
  const uCap = opts.userId !== null ? s.userCaps[String(opts.userId)] : undefined;
  if (opts.userId !== null && uCap) {
    targets.push({ scope: "user:" + opts.userId, spent: spentMicros(opts.userId, now) / 1e6, cap: uCap });
  }
  for (const t of targets) {
    for (const th of THRESHOLDS) {
      if (t.spent >= (t.cap * th) / 100 && tryInsert(month, t.scope, th)) {
        raised.push({ month, scope: t.scope, threshold: th, sentAt: now });
        await notify(t.scope, th, t.spent, t.cap);
      }
    }
  }
  return raised;
}

/** Alerts raised this month, for a UI banner. Optionally limited to scopes the viewer may see. */
export function currentAlerts(opts: { userId?: number | null; includeTeam?: boolean; now?: Date } = {}): DfsAlert[] {
  const month = monthKey(opts.now);
  const rows = db.select().from(extDfsAlerts).where(eq(extDfsAlerts.month, month)).all();
  return rows
    .filter((r) => {
      if (r.scope === "team") return opts.includeTeam !== false;
      return opts.userId === undefined || r.scope === "user:" + opts.userId;
    })
    .map((r) => ({ month: r.month, scope: r.scope, threshold: r.threshold, sentAt: r.sentAt }));
}
