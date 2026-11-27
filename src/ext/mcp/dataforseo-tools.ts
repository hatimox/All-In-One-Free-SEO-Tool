/**
 * DataForSEO tools for the MCP server.
 *
 * The registry's read-only hint is static per tool, so every data tool comes
 * as a pair:
 *   dfs_<x>        read-only. Cache only, never spends.
 *   dfs_<x>_fetch  readOnlyHint false. Can spend; requires `allowSpend: true`.
 * A read-only token never sees (or can call) the _fetch variants.
 *
 * Every tool re-checks client visibility for the active MCP context, and the
 * service layer's guardPaid/guardRead check it again. Budget and permission
 * failures come back as tool errors, never as silently empty data.
 */
import { getRequest, backlinkGap, keywordIdeas, rankedKeywords, BudgetError } from "../dataforseo/service";
import { monthlySpend } from "../dataforseo/budget";
import { DEFAULT_ROW_LIMIT, microsToUsd } from "../dataforseo/pricing";
import { getBacklinkOverview } from "../providers/backlinks";
import { getKeywordMetrics } from "../providers/keyword-metrics";
import { PaidForbiddenError } from "../access/paid-guard";
import { canSeeMcpClient, mcpContext } from "./context";
import type { McpToolResult } from "@/lib/mcp/tools";

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  handler: (a: never) => Promise<McpToolResult>;
};

const SOURCE = "dataforseo";
const fail = (error: string): McpToolResult => ({ ok: false, error });

function describeError(e: unknown): string {
  if (e instanceof BudgetError) return `Budget limit reached, nothing was spent beyond it: ${e.message}`;
  if (e instanceof PaidForbiddenError) return `Not allowed: ${e.message}`;
  return `DataForSEO call failed: ${e instanceof Error ? e.message : String(e)}`;
}

function clientOf(a: Args): number | McpToolResult {
  const id = Number(a.clientId);
  if (!Number.isInteger(id) || id <= 0) return fail("clientId must be a positive integer.");
  if (!canSeeMcpClient(id)) return fail(`No client with id ${id}.`);
  return id;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
/** Undefined lets the service apply its own default (shared with the UI, so cache keys match). */
const limitOf = (v: unknown): number | undefined => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : undefined;
};

type LiveLike = { status: "cache_miss" } | { status: "ready"; requestId: number; data: unknown; cached: boolean; fetchedAt: Date; costUsd: number };

function liveOut(r: LiveLike, fetchTool: string): McpToolResult {
  if (r.status === "cache_miss") {
    return {
      ok: true,
      data: { source: SOURCE, status: "cache_miss", note: `Not in the cache, and this tool never spends. Use ${fetchTool} with allowSpend true to fetch it.` },
    };
  }
  return {
    ok: true,
    data: {
      source: SOURCE, status: "ready", cached: r.cached, fetchedAt: r.fetchedAt, costUsd: r.costUsd,
      requestId: r.requestId, data: r.data,
    },
  };
}

type Spec = {
  base: string;
  describe: string;
  props: Record<string, unknown>;
  required: string[];
  run: (clientId: number, a: Args, allowSpend: boolean, fetchTool: string) => Promise<McpToolResult>;
};

const SPECS: Spec[] = [
  {
    base: "dfs_keyword_metrics",
    describe: "Search volume, CPC and competition for keywords",
    props: {
      keywords: { type: "array", items: { type: "string" }, description: "Up to 100 keywords." },
      country: { type: "string", description: "Optional ISO country override; defaults to the client's market." },
      language: { type: "string", description: "Optional language override." },
    },
    required: ["keywords"],
    run: async (clientId, a, allowSpend, fetchTool) => {
      const keywords = strList(a.keywords).slice(0, 100);
      if (keywords.length === 0) return fail("Give at least one keyword.");
      const r = await getKeywordMetrics({
        clientId, keywords, allowSpend,
        market: a.country ? { country: String(a.country), language: a.language ? String(a.language) : undefined } : undefined,
      });
      // Provider fallbacks are labelled per item; surface why DataForSEO was skipped.
      const warnings = [...new Set(r.items.map((i) => i.fallbackReason).filter((x): x is string => Boolean(x)))];
      return {
        ok: true,
        data: {
          status: r.status, requestId: r.requestId ?? null,
          provenance: "Each item's `source` says which provider produced it; `cached` true means no spend.",
          ...(warnings.length ? { warnings } : {}),
          ...(!allowSpend ? { note: `Cache only. ${fetchTool} can fetch missing values for a fee.` } : {}),
          items: r.items,
        },
      };
    },
  },
  {
    base: "dfs_keyword_ideas",
    describe: "Keyword ideas from seed keywords (DataForSEO Labs)",
    props: {
      seeds: { type: "array", items: { type: "string" } },
      variant: { type: "string", enum: ["ideas", "suggestions"] },
      limit: { type: "number", description: `Default ${DEFAULT_ROW_LIMIT}, max 200.` },
    },
    required: ["seeds"],
    run: async (clientId, a, allowSpend, fetchTool) =>
      liveOut(
        await keywordIdeas({
          clientId, seeds: strList(a.seeds), limit: limitOf(a.limit), cacheOnly: !allowSpend,
          variant: a.variant === "suggestions" ? "suggestions" : "ideas",
        }),
        fetchTool,
      ),
  },
  {
    base: "dfs_ranked_keywords",
    describe: "Keywords a domain ranks for (defaults to the client's own domain)",
    props: {
      target: { type: "string", description: "Domain; defaults to the client's." },
      limit: { type: "number", description: `Default ${DEFAULT_ROW_LIMIT}, max 200.` },
    },
    required: [],
    run: async (clientId, a, allowSpend, fetchTool) =>
      liveOut(
        await rankedKeywords({ clientId, target: a.target ? String(a.target) : undefined, limit: limitOf(a.limit), cacheOnly: !allowSpend }),
        fetchTool,
      ),
  },
  {
    base: "dfs_backlinks_overview",
    describe: "Backlink summary and referring domains for a domain (defaults to the client's own)",
    props: { target: { type: "string", description: "Domain; defaults to the client's." } },
    required: [],
    run: async (clientId, a, allowSpend, fetchTool) => {
      const r = await getBacklinkOverview({ clientId, target: a.target ? String(a.target) : undefined, allowSpend });
      if (r.source === "none") {
        // On a paid call a failure (budget, permission, outage) must be loud.
        if (allowSpend) return fail(`No backlink data: ${r.reason}`);
        return { ok: true, data: { source: "none", status: "unavailable", reason: r.reason } };
      }
      if (r.status === "cache_miss") {
        return { ok: true, data: { source: SOURCE, status: "cache_miss", note: `Not cached; ${fetchTool} with allowSpend true fetches it.` } };
      }
      return { ok: true, data: { source: SOURCE, status: "ready", cached: r.cached, summary: r.summary, referringDomains: r.referringDomains } };
    },
  },
  {
    base: "dfs_backlink_gap",
    describe: "Domains that link to the competitors but not to the target (defaults to the client's own domain)",
    props: {
      competitors: { type: "array", items: { type: "string" } },
      target: { type: "string" },
      limit: { type: "number", description: `Default ${DEFAULT_ROW_LIMIT}, max 200.` },
    },
    required: ["competitors"],
    run: async (clientId, a, allowSpend, fetchTool) =>
      liveOut(
        await backlinkGap({
          clientId, competitors: strList(a.competitors), target: a.target ? String(a.target) : undefined,
          limit: limitOf(a.limit), cacheOnly: !allowSpend,
        }),
        fetchTool,
      ),
  },
];

function build(spec: Spec, spend: boolean): Tool {
  const name = spec.base + (spend ? "_fetch" : "");
  const fetchTool = spec.base + "_fetch";
  const props: Record<string, unknown> = {
    clientId: { type: "number", description: "Which site. Get ids from list_clients." },
    ...spec.props,
  };
  if (spend) props.allowSpend = { type: "boolean", description: "Must be true: confirms this call may spend DataForSEO budget (capped by team/user/request limits)." };
  return {
    name,
    description: spend
      ? `${spec.describe}. MAY SPEND real DataForSEO budget when the answer is not cached; refused unless allowSpend is true, and by budget caps. Source: dataforseo.`
      : `${spec.describe}. Cache only: never spends and never calls DataForSEO. Says cache_miss when nothing is stored; use ${fetchTool} to fetch. Source: dataforseo cache.`,
    inputSchema: { type: "object", properties: props, required: ["clientId", ...spec.required, ...(spend ? ["allowSpend"] : [])] },
    annotations: spend
      ? { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
      : { readOnlyHint: true, openWorldHint: false },
    handler: (async (a: Args) => {
      const clientId = clientOf(a);
      if (typeof clientId !== "number") return clientId;
      if (spend) {
        if (a.allowSpend !== true) return fail(`${name} spends money. Pass allowSpend: true to confirm, or use ${spec.base} for cached data only.`);
        if (mcpContext().readOnly) return fail("This MCP token is read-only and cannot spend DataForSEO budget.");
      }
      try {
        return await spec.run(clientId, a, spend, fetchTool);
      } catch (e) {
        return fail(describeError(e));
      }
    }) as Tool["handler"],
  };
}

const usd = (micros: number) => Number(microsToUsd(micros).toFixed(4));

const status: Tool = {
  name: "dfs_request_status",
  description:
    "Status and data of an earlier DataForSEO request (e.g. a keyword-volume task still in the standard queue). Free; reads stored data only. Source: dataforseo.",
  inputSchema: {
    type: "object",
    properties: { clientId: { type: "number" }, requestId: { type: "number", description: "From a result's requestId." } },
    required: ["clientId", "requestId"],
  },
  annotations: { readOnlyHint: true },
  handler: (async (a: Args) => {
    const clientId = clientOf(a);
    if (typeof clientId !== "number") return clientId;
    try {
      const r = await getRequest(Number(a.requestId), clientId);
      if (!r) return fail(`No request ${String(a.requestId)} for client ${clientId}.`);
      return { ok: true, data: { source: SOURCE, ...r } };
    } catch (e) {
      return fail(describeError(e));
    }
  }) as Tool["handler"],
};

const spend: Tool = {
  name: "dfs_spend_summary",
  description:
    "This month's DataForSEO spend (UTC month), cache hits and money saved. Owner-level tokens see the whole team; per-user tokens see only their own spend. Source: this install's ledger, not DataForSEO billing.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
  handler: (async () => {
    const ctx = mcpContext();
    const team = ctx.kind === "legacy" || ctx.role === "owner";
    const s = monthlySpend(team ? {} : { userId: (ctx as { userId: number }).userId });
    return {
      ok: true,
      data: {
        source: "ledger", scope: team ? "team" : "own", month: s.month,
        totalUsd: usd(s.totalMicros), reservedUsd: usd(s.reservedMicros),
        cacheHits: s.cacheHits, savedUsd: usd(s.savedMicros),
        byEndpoint: s.byEndpoint.map((e) => ({ endpoint: e.endpoint, usd: usd(e.micros), calls: e.calls })),
        ...(team ? { byUser: s.byUser.map((u) => ({ userId: u.userId, usd: usd(u.micros) })) } : {}),
      },
    };
  }) as Tool["handler"],
};

export const dataforseoTools: Tool[] = [
  ...SPECS.flatMap((s) => [build(s, false), build(s, true)]),
  status,
  spend,
];
