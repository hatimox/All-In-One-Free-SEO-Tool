/**
 * Extension tables (all prefixed `ext_`). Kept out of src/db/schema.ts on
 * purpose so upstream merges never conflict. Migrations live in
 * src/ext/db/migrations and are applied by scripts/migrate.cjs as
 * `ext/<filename>`. Generate with `pnpm db:generate:ext`.
 *
 * user_id / client_id are plain integers (no FK) so the core schema is
 * never touched; they are indexed instead.
 */
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const ms = (name: string) => integer(name, { mode: "timestamp_ms" });

export const extKeywordMetrics = sqliteTable(
  "ext_keyword_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Normalized: trimmed, lowercased, whitespace collapsed. */
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    volume: integer("volume"),
    cpc: real("cpc"),
    competition: real("competition"),
    competitionIndex: integer("competition_index"),
    lowBid: real("low_bid"),
    highBid: real("high_bid"),
    /** JSON array of up to 12 monthly volumes, oldest first. */
    trendJson: text("trend_json"),
    source: text("source").notNull(),
    fetchedAt: ms("fetched_at").notNull(),
    expiresAt: ms("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("ext_keyword_metrics_uniq").on(
      t.keyword,
      t.locationCode,
      t.languageCode,
      t.source,
    ),
    index("ext_keyword_metrics_expires_idx").on(t.expiresAt),
  ],
);

export const extDfsCache = sqliteTable(
  "ext_dfs_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cacheKey: text("cache_key").notNull(),
    endpoint: text("endpoint").notNull(),
    responseJson: text("response_json").notNull(),
    costMicros: integer("cost_micros").notNull().default(0),
    fetchedAt: ms("fetched_at").notNull(),
    expiresAt: ms("expires_at").notNull(),
  },
  (t) => [uniqueIndex("ext_dfs_cache_key_uniq").on(t.cacheKey)],
);

export const extDfsLedger = sqliteTable(
  "ext_dfs_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** null = scheduler / legacy single-user mode. */
    userId: integer("user_id"),
    clientId: integer("client_id"),
    endpoint: text("endpoint").notNull(),
    mode: text("mode", { enum: ["live", "standard"] }).notNull(),
    units: integer("units").notNull().default(1),
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
    actualCostMicros: integer("actual_cost_micros"),
    status: text("status", {
      enum: ["reserved", "settled", "released", "failed"],
    }).notNull(),
    cacheHit: integer("cache_hit", { mode: "boolean" })
      .notNull()
      .default(false),
    taskId: text("task_id"),
    requestId: integer("request_id"),
    createdAt: ms("created_at").notNull(),
    settledAt: ms("settled_at"),
  },
  (t) => [
    index("ext_dfs_ledger_created_idx").on(t.createdAt),
    index("ext_dfs_ledger_user_idx").on(t.userId),
    index("ext_dfs_ledger_client_idx").on(t.clientId),
  ],
);

export const extDfsRequests = sqliteTable(
  "ext_dfs_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id"),
    userId: integer("user_id"),
    kind: text("kind", {
      enum: [
        "volume",
        "ideas",
        "ranked_keywords",
        "backlinks_summary",
        "backlinks_list",
        "referring_domains",
        "backlink_gap",
      ],
    }).notNull(),
    paramsJson: text("params_json").notNull(),
    cacheKey: text("cache_key"),
    status: text("status", { enum: ["pending", "ready", "failed"] }).notNull(),
    taskIdsJson: text("task_ids_json"),
    error: text("error"),
    createdAt: ms("created_at").notNull(),
    completedAt: ms("completed_at"),
  },
  (t) => [
    index("ext_dfs_requests_client_idx").on(t.clientId, t.createdAt),
    index("ext_dfs_requests_status_idx").on(t.status),
  ],
);

export const extDfsAlerts = sqliteTable(
  "ext_dfs_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** YYYY-MM (UTC). */
    month: text("month").notNull(),
    /** "team" or "user:<id>". */
    scope: text("scope").notNull(),
    threshold: integer("threshold").notNull(),
    sentAt: ms("sent_at").notNull(),
  },
  (t) => [
    uniqueIndex("ext_dfs_alerts_uniq").on(t.month, t.scope, t.threshold),
  ],
);

export const extMcpTokens = sqliteTable(
  "ext_mcp_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    label: text("label").notNull(),
    /** sha256 hex of the token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    readOnly: integer("read_only", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: ms("created_at").notNull(),
    lastUsedAt: ms("last_used_at"),
    revokedAt: ms("revoked_at"),
  },
  (t) => [
    uniqueIndex("ext_mcp_tokens_hash_uniq").on(t.tokenHash),
    index("ext_mcp_tokens_user_idx").on(t.userId),
  ],
);
