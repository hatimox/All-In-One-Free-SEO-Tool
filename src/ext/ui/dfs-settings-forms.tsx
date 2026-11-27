"use client";

import { useActionState, useState, useTransition } from "react";
import {
  removeDfsCredentials,
  saveDfsCredentials,
  saveDfsSettings,
  testDfsConnection,
  type DfsActionResult,
} from "@/app/settings/dataforseo/actions";

const input =
  "h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40";
const btn =
  "inline-flex h-9 items-center rounded-md bg-violet-500/15 px-4 text-xs font-medium text-violet-200 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50";
const btnQuiet =
  "inline-flex h-9 items-center rounded-md border border-white/10 bg-white/5 px-3 text-xs font-medium hover:bg-white/10 disabled:opacity-50";

function Notice({ r }: { r: DfsActionResult | null }) {
  if (!r) return null;
  return (
    <p
      role="status"
      className={`rounded-md px-3 py-2 text-xs ring-1 ring-inset ${
        r.ok ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" : "bg-rose-500/10 text-rose-300 ring-rose-500/30"
      }`}
    >
      {r.ok ? r.message : r.error}
    </p>
  );
}

export function CredentialsForm({
  configured,
  source,
  loginHint,
}: {
  configured: boolean;
  source: "settings" | "env" | null;
  loginHint: string | null;
}) {
  const [state, action, pending] = useActionState(saveDfsCredentials, null);
  const [other, setOther] = useState<DfsActionResult | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {configured
          ? `Connected as ${loginHint} (from ${source === "env" ? "environment variables" : "saved settings"}). The password is never shown again.`
          : "Not connected. Use your DataForSEO API login (not your account email password) and API password."}
      </p>
      <form action={action} autoComplete="off" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">API login</span>
          <input name="login" required className={input} placeholder={loginHint ?? "login"} autoComplete="off" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">API password</span>
          <input name="password" type="password" required className={input} autoComplete="new-password" />
        </label>
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "Saving…" : configured ? "Replace credentials" : "Save credentials"}
        </button>
      </form>
      <Notice r={state} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !configured}
          className={btnQuiet}
          onClick={() => start(async () => setOther(await testDfsConnection()))}
        >
          Test connection
        </button>
        {source === "settings" && (
          <button
            type="button"
            disabled={busy}
            className={`${btnQuiet} text-rose-300`}
            onClick={() => {
              if (!window.confirm("Remove the stored DataForSEO credentials?")) return;
              start(async () => setOther(await removeDfsCredentials()));
            }}
          >
            Remove credentials
          </button>
        )}
      </div>
      <Notice r={other} />
    </div>
  );
}

export type SettingsFormProps = {
  teamCapUsd: number | null;
  requestMaxUsd: number;
  ttlDays: { volume: number; labs: number; backlinks: number };
  defaultMode: "standard" | "live";
  automationsMaySpend: boolean;
  backlinksEnabled: boolean;
  users: { id: number; label: string; cap: number | null }[];
};

export function SpendSettingsForm(p: SettingsFormProps) {
  const [state, action, pending] = useActionState(saveDfsSettings, null);
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-1">
        <label className="space-y-1 text-xs">
          <span className="font-medium">Team monthly cap (USD)</span>
          <input name="teamCapUsd" type="number" min={0} step="0.01" defaultValue={p.teamCapUsd ?? ""} className={`${input} max-w-xs`} placeholder="not set" />
        </label>
        <p className="text-[11px] text-muted-foreground">
          {p.teamCapUsd === null
            ? "Not set: every paid DataForSEO call is blocked until you set a cap. Cached data still works."
            : "Paid calls are refused once this month's spend (plus the call's estimate) would pass the cap."}
        </p>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium">Per-user monthly caps (USD)</span>
        <div className="grid gap-2 md:grid-cols-2">
          {p.users.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No team accounts yet — only the team cap applies.</p>
          )}
          {p.users.map((u) => (
            <label key={u.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{u.label}</span>
              <input name={`userCap_${u.id}`} type="number" min={0} step="0.01" defaultValue={u.cap ?? ""} placeholder="no personal cap" className={`${input} max-w-[10rem]`} />
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Per-request max (USD)</span>
          <input name="requestMaxUsd" type="number" min={0} step="0.01" defaultValue={p.requestMaxUsd} className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Keep volumes (days)</span>
          <input name="ttlVolume" type="number" min={1} defaultValue={p.ttlDays.volume} className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Keep ideas / domain keywords (days)</span>
          <input name="ttlLabs" type="number" min={1} defaultValue={p.ttlDays.labs} className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Keep backlink data (days)</span>
          <input name="ttlBacklinks" type="number" min={1} defaultValue={p.ttlDays.backlinks} className={input} />
        </label>
      </div>

      <fieldset className="space-y-1 text-xs">
        <legend className="font-medium">Default volume lookup mode</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="defaultMode" value="standard" defaultChecked={p.defaultMode === "standard"} className="mt-0.5" />
          <span>
            Standard queue — $0.06 per task of up to 1,000 keywords. Results usually arrive in a few minutes.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="defaultMode" value="live" defaultChecked={p.defaultMode === "live"} className="mt-0.5" />
          <span>Live — $0.09 per task of up to 1,000 keywords. Results immediately.</span>
        </label>
      </fieldset>

      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="automationsMaySpend" defaultChecked={p.automationsMaySpend} className="mt-0.5" />
        <span>
          <span className="font-medium">Automations may spend.</span> Off by default: scheduled jobs only use cached data.
          When on, they still respect the team cap.
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" name="backlinksEnabled" defaultChecked={p.backlinksEnabled} className="mt-0.5" />
        <span>
          <span className="font-medium">Enable Backlinks API.</span> DataForSEO may require a separate Backlinks
          subscription on your account; if calls fail with an access error, check your DataForSEO plan.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
      <Notice r={state} />
    </form>
  );
}
