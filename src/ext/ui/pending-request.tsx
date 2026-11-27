"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { pollRequest, type PendingOut } from "@/app/market-data/actions";
import { ErrorBox, MetricsTable } from "./market-data-shared";

const POLL_MS = 15_000;

export function PendingRequest({
  clientId,
  requestId,
  country,
  canTrack,
}: {
  clientId: number;
  requestId: number;
  country: string;
  canTrack: boolean;
}) {
  const [state, setState] = useState<PendingOut | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let r: PendingOut;
      try {
        r = await pollRequest({ clientId, requestId });
      } catch {
        r = { ok: false, kind: "other", error: "Could not check the request. Retrying…" };
      }
      if (stopped.current) return;
      setState(r);
      const done = r.ok && r.status !== "pending";
      const fatal = !r.ok && r.kind === "forbidden";
      if (!done && !fatal) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [clientId, requestId]);

  const back = (
    <Link href={`/market-data/c/${clientId}`} className="text-xs underline underline-offset-2">
      Back to market data
    </Link>
  );

  if (state?.ok && state.status === "ready") {
    return (
      <div className="space-y-3">
        <p className="text-sm">Exact volumes are ready ({state.rows.length} keyword{state.rows.length === 1 ? "" : "s"}).</p>
        {state.missing > 0 && (
          <p className="text-xs text-muted-foreground">{state.missing} keyword(s) were not returned by DataForSEO.</p>
        )}
        {state.error && <p className="text-xs text-amber-300">{state.error}</p>}
        <MetricsTable items={state.rows} clientId={clientId} country={country} canTrack={canTrack} />
        {back}
      </div>
    );
  }
  if (state?.ok && state.status === "failed") {
    return (
      <div className="space-y-3">
        <ErrorBox error={state.error ?? "The DataForSEO request failed."} isOwner={false} />
        {back}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-card/40 p-4">
        <Loader2 className="mt-0.5 size-4 animate-spin text-cyan-300" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Results pending</p>
          <p className="text-xs text-muted-foreground">
            DataForSEO standard queue usually takes a few minutes. This page checks every 15 seconds; you can leave and come
            back, the request keeps running.
          </p>
        </div>
      </div>
      {state && !state.ok && <ErrorBox kind={state.kind} error={state.error} isOwner={false} />}
      {back}
    </div>
  );
}
