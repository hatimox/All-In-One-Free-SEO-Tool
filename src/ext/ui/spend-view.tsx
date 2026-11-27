/**
 * Month spend breakdown. Server component, shared by Settings → DataForSEO
 * (team scope) and /account/spend (one user).
 */
import { nameMaps, usd, type SpendOverview } from "./spend-data";

function Bar({ spent, cap }: { spent: number; cap: number | null }) {
  const pct = cap && cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const tone = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="rounded-xl border border-white/5 bg-card/40 p-3">
      <h3 className="mb-2 text-xs font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet this month.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-white/[0.04]">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{r.value}</td>
                {r.sub !== undefined && (
                  <td className="py-1 pl-2 text-right text-muted-foreground tabular-nums">{r.sub}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SpendView({
  overview,
  capUsd,
  capLabel,
  detailed = true,
}: {
  overview: SpendOverview;
  capUsd: number | null;
  capLabel: string;
  /** false: totals + ledger only (a user's own page). */
  detailed?: boolean;
}) {
  const { spend, ledger } = overview;
  const names = nameMaps();
  const spentUsd = spend.totalMicros / 1e6;
  const userName = (id: number | null) =>
    id === null ? "—" : (names.users.get(id) ?? `User ${id}`);
  const clientName = (id: number | null) =>
    id === null ? "—" : (names.clients.get(id) ?? `Client ${id}`);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/5 bg-card/40 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm">
            <span className="text-lg font-semibold tabular-nums">{usd(spend.totalMicros)}</span>{" "}
            <span className="text-muted-foreground">
              spent in {spend.month} (UTC)
              {capUsd !== null ? ` of $${capUsd.toFixed(2)} ${capLabel}` : ` — no ${capLabel} set`}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Reserved for in-flight calls: {usd(spend.reservedMicros)} · Cache hits: {spend.cacheHits} (saved about{" "}
            {usd(spend.savedMicros)})
          </div>
        </div>
        <div className="mt-3">
          <Bar spent={spentUsd} cap={capUsd} />
        </div>
      </div>

      {detailed && (
        <div className="grid gap-3 md:grid-cols-3">
          <Table
            title="By user"
            rows={spend.byUser.map((r) => ({
              label: r.userId === null ? "Automations / local" : userName(r.userId),
              value: usd(r.micros),
            }))}
          />
          <Table
            title="By client"
            rows={spend.byClient.map((r) => ({
              label: r.clientId === null ? "No client" : clientName(r.clientId),
              value: usd(r.micros),
            }))}
          />
          <Table
            title="By endpoint"
            rows={spend.byEndpoint.map((r) => ({
              label: r.endpoint,
              value: usd(r.micros),
              sub: `${r.calls} call${r.calls === 1 ? "" : "s"}`,
            }))}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-card/40">
        <h3 className="px-3 pt-3 text-xs font-semibold">Last {ledger.length} ledger rows</h3>
        {ledger.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No DataForSEO activity yet.</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">When (UTC)</th>
                <th className="px-2 py-1.5 font-medium">Endpoint</th>
                <th className="px-2 py-1.5 font-medium">User</th>
                <th className="px-2 py-1.5 font-medium">Client</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04]">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {new Date(r.at).toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.endpoint} <span className="text-muted-foreground">({r.mode})</span>
                  </td>
                  <td className="px-2 py-1.5">{userName(r.userId)}</td>
                  <td className="px-2 py-1.5">{clientName(r.clientId)}</td>
                  <td className="px-2 py-1.5">{r.cacheHit ? "cache hit" : r.status}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.cacheHit ? "$0.0000" : usd(r.micros, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
