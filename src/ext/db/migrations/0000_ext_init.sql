CREATE TABLE `ext_dfs_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`scope` text NOT NULL,
	`threshold` integer NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ext_dfs_alerts_uniq` ON `ext_dfs_alerts` (`month`,`scope`,`threshold`);--> statement-breakpoint
CREATE TABLE `ext_dfs_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`endpoint` text NOT NULL,
	`response_json` text NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ext_dfs_cache_key_uniq` ON `ext_dfs_cache` (`cache_key`);--> statement-breakpoint
CREATE TABLE `ext_dfs_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`client_id` integer,
	`endpoint` text NOT NULL,
	`mode` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`actual_cost_micros` integer,
	`status` text NOT NULL,
	`cache_hit` integer DEFAULT false NOT NULL,
	`task_id` text,
	`request_id` integer,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE INDEX `ext_dfs_ledger_created_idx` ON `ext_dfs_ledger` (`created_at`);--> statement-breakpoint
CREATE INDEX `ext_dfs_ledger_user_idx` ON `ext_dfs_ledger` (`user_id`);--> statement-breakpoint
CREATE INDEX `ext_dfs_ledger_client_idx` ON `ext_dfs_ledger` (`client_id`);--> statement-breakpoint
CREATE TABLE `ext_dfs_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`user_id` integer,
	`kind` text NOT NULL,
	`params_json` text NOT NULL,
	`cache_key` text,
	`status` text NOT NULL,
	`task_ids_json` text,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `ext_dfs_requests_client_idx` ON `ext_dfs_requests` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ext_dfs_requests_status_idx` ON `ext_dfs_requests` (`status`);--> statement-breakpoint
CREATE TABLE `ext_keyword_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`volume` integer,
	`cpc` real,
	`competition` real,
	`competition_index` integer,
	`low_bid` real,
	`high_bid` real,
	`trend_json` text,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ext_keyword_metrics_uniq` ON `ext_keyword_metrics` (`keyword`,`location_code`,`language_code`,`source`);--> statement-breakpoint
CREATE INDEX `ext_keyword_metrics_expires_idx` ON `ext_keyword_metrics` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ext_mcp_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`read_only` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ext_mcp_tokens_hash_uniq` ON `ext_mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `ext_mcp_tokens_user_idx` ON `ext_mcp_tokens` (`user_id`);