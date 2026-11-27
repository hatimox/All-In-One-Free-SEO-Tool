# DataForSEO (optional, paid)

For the two people running this install. Everything in the tool that was free
stays free; DataForSEO adds exact numbers on top, and you only pay for what you
press a button for.

## What it adds

- **Exact monthly keyword volumes** (Google Ads averages, with CPC, competition and a 12-month trend) instead of the free relative estimate.
- **Keyword ideas** and **domain keywords** (what a site or competitor ranks for).
- **Keyword difficulty and search intent**, and a **domain overview** (organic keywords, estimated traffic, position distribution), **top pages** and **competing domains** for any domain. Recent lookups per client are listed from the request history.
- **Backlink data** (overview, referring domains, gap vs competitors). Off by default, see [Backlinks caveat](#backlinks-api-caveat).
- A **Market data** page per client (`/market-data`), a "Get exact volumes" block on the search-volume and keyword-research screens, spend pages, and MCP tools.

Still free and unchanged: audits, rank tracking, Search Console / GA4 / Bing data, the estimate-based volumes, AI visibility. If DataForSEO is not configured, or a cap is hit, the tool falls back to those and labels them as such.

## Setup

1. **Set `SEO_ENCRYPTION_KEY` first.** Credentials are never stored unencrypted: saving them fails with "Set SEO_ENCRYPTION_KEY" if no key can be used. Generate one with `openssl rand -base64 32` and put it in your environment (see `.env.example`). If you do not set it, the app tries to create a `.seo-encryption-key` file in the install folder; that works on a normal install but is lost with an ephemeral container filesystem, and then the saved credentials become unreadable. Back the key up with `data.db`.
2. Create a DataForSEO account and top it up (see [Cost](#cost-expectations)). Use the **API login and API password** from your DataForSEO dashboard, not your website login.
3. Sign in as the owner and open **Settings → DataForSEO**. Enter the login and password, press **Save credentials**, then **Test connection**. It shows your balance. The password is never displayed again.
4. **Set the team monthly cap.** Until you do, every paid call is refused ("No DataForSEO team budget is set"). Cached data keeps working.

Alternative to step 3: set `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in the environment. Credentials saved in Settings win over the environment; if saved credentials cannot be decrypted (wrong key), the app does not silently fall back to the environment, it reports not configured.

## Spend caps and alerts

All on **Settings → DataForSEO** (owner only):

- **Team monthly cap (USD)**: required. A paid call is refused if this month's spend plus the call's estimate would pass it.
- **Per-user monthly caps**: optional, one per team member. Both the user cap and the team cap must have room.
- **Per-request maximum**: default $1.00. A single request estimated above it is refused.
- **Cache lifetimes**: volume, Labs and backlink data each have a TTL in days. The minimum is **1 day**; 0 would switch caching off and re-bill every lookup, so it is refused (and a stored 0 is treated as 1).
- **Alerts at 80% and 100%** of the team cap (and of any user cap), once each per month. The 100% alert also fires when a call is *blocked* by the cap (spent plus the call's estimate would pass it), not only once spending reaches it. They show as a banner on the market-data and settings pages and in the activity log, and the owner(s) get an email **if SMTP is configured** under Settings. With no SMTP, the in-app alert still appears.
- **Automations may spend**: off by default. When off, scheduled jobs and other background work only read cache. When on, they still respect the caps.
- Months are UTC calendar months. Spend is tracked in this install's ledger (estimated up front, settled to the actual cost DataForSEO reports); it is not your DataForSEO invoice. **Settings → DataForSEO** shows the team view, **Account → My DataForSEO spend** shows your own.

## Standard vs live volume lookups

- **Standard queue** (default): $0.06 per task of up to 1,000 keywords. You are taken to a pending screen that checks every 15 seconds; typical turnaround is minutes to a few hours. You can leave and come back. A background job also collects finished tasks every 2 minutes.
- **Live**: $0.09 per task of up to 1,000 keywords, answered immediately.

The default mode is set on the same settings page. The app batches up to 1,000 keywords into one task, because DataForSEO bills volume per task, not per keyword.

## Caching

Paid results are cached and shared across all clients and users, so the same keyword in the same country and language is never bought twice within its lifetime. Defaults (editable under Settings):

| Data | Kept for |
|---|---|
| Keyword volumes | 30 days |
| Ideas and domain keywords (Labs) | 14 days |
| Backlink data | 14 days |

A repeat lookup inside the window costs nothing and its badge says "cached". When only some keywords of a batch are cached, you pay only for the missing ones. Google refreshes Ads volumes roughly monthly, so the 30-day default matches.

## Where data appears and what the badges mean

- **Keyword research** (`/market-data`, nav "Keyword research"): one search box for a keyword or a domain (a URL, or one word with a dot, is a domain), then pick a client and country. Pages open from the cache and never spend on their own; paid data comes from one button that shows its price.
  - `/market-data/c/<client>`: search plus recent searches (reopening one is free).
  - `.../keyword?q=`: volume, SEO difficulty, CPC, competition, intent, 12-month trend, ideas preview (Suggestions, Related, Questions), free "Scan top 10", Track and Export CSV. Button: "Get full data" (only what is not cached). Without DataForSEO, "Estimate difficulty (free)" gives a labelled estimate.
  - `.../ideas?q=`: full ideas table with volume and difficulty filters, include/exclude words, sorting, bulk Track and Export CSV.
  - `.../domain?d=`: organic keywords, estimated traffic, top-3 and top-10 positions, position distribution, top pages, top keywords and competitors (each opens its own overview). Button: "Get domain data". Backlinks summary shows from cache when backlinks are enabled.
  - `.../backlinks`: backlink summary and link gap (tabs).
- "Get exact volumes" blocks on the search-volume and keyword-research tools.
- MCP tools (below).

Every number carries a source badge:

- **DataForSEO**: exact Google Ads average from a paid lookup. "· cached" means it came from a previous lookup.
- **Keyword Planner**, **Search Console**, **Bing impressions**: other real sources, labelled as such.
- **Estimate (relative)**: the free directional bucket, not a search count.
- "· provisional": exact figures are still in the DataForSEO queue.

Hover a badge for the date and why a fallback was used.

## Roles

| | Owner | Manager | Member | Viewer |
|---|---|---|---|---|
| Sees clients | all | all | assigned only | assigned only |
| Cached lookups (free) | yes | yes | assigned clients | assigned clients |
| Paid lookups | yes | yes | assigned clients | no |
| Save credentials, caps, settings | yes | no | no | no |
| Own spend page, own MCP tokens | yes | yes | yes | yes (read-only tokens) |

Paid buttons are hidden for viewers and the page says their role is read-only. A member opening another client's market-data page gets "not found".

## Reliability and safety rules

- **Paid POSTs are never retried after a timeout or network error.** DataForSEO may already have billed the call. Such a failure keeps the reservation settled at its *estimate* on the ledger and the request is marked failed with "may have been charged". Paid POSTs are only retried on codes that mean "not charged" (40202 rate limit, 40209, HTTP 429). Free GETs (tasks_ready, task_get) still retry.
- **Interrupted calls**: a reservation with no task id still `reserved` after 1 hour (for example after a crash) is settled at its estimate by the background job and its request is marked failed, never released at $0.
- **No double payment for queued keywords**: a standard-queue lookup skips keywords already covered by a pending request of the same client, location and language, and points to that request instead. If everything is covered nothing is posted.
- **Free poll errors are transient**: bad credentials or an empty balance reported by the free task checks leave the request pending (the 48 hour rule still applies) instead of failing it.
- **Cache-only reads of other domains**: viewers and members (anyone who does not see every client) can read cached ranked-keyword and backlink data only for the client's own domain or one of that client's competitors; any other target is refused. Owners, managers and workspace tokens are not restricted.
- **Keyword lookups that may spend surface errors**: a budget refusal, a forbidden role, empty balance or bad credentials is shown as an error rather than silently replaced by the free estimate. Cache-only lookups still fall back with a reason. A country override that is not supported is refused instead of using the client's market.

## MCP

Signed-in users create their own tokens at **Account → MCP tokens**. A per-user token sees only what that user sees and is read-only by default (viewers can never have a write token). See [mcp-server.md](mcp-server.md) for connecting. The owner can switch per-user tokens off (503) and list or revoke every user's tokens on the same page.

Each DataForSEO tool comes in two forms:

- `dfs_keyword_metrics`, `dfs_keyword_ideas`, `dfs_ranked_keywords`, `dfs_backlinks_overview`, `dfs_backlink_gap`: **cache only**. Never spend, never call DataForSEO; they answer `cache_miss` if nothing is stored.
- The same name plus `_fetch`: may spend. Requires `allowSpend: true` on the call, a non-read-only token, and a role that may spend; caps apply.
- `dfs_request_status` (free) reads a queued task; `dfs_spend_summary` shows this month's spend (the whole team for owner tokens, your own for per-user tokens).

## Cost expectations

Prices (checked 2026-11-27; re-check before relying on them) from DataForSEO:
[pricing](https://dataforseo.com/pricing),
[Google Ads volume](https://dataforseo.com/pricing/keywords-data/google-ads),
[Labs](https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api),
[Backlinks](https://dataforseo.com/pricing/backlinks/backlinks).

- Volume: $0.06 per standard task, $0.09 per live task, up to 1,000 keywords each.
- Labs (ideas, domain keywords): $0.012 per request + $0.00012 per returned item.
- Labs difficulty, intent, domain overview, top pages and competing domains: the same Labs rate, $0.012 per request + $0.00012 per keyword/item. Only search intent is named on the pricing page at that rate; the other four are assumed to use it (unconfirmed) and the real cost always comes from the response. Cache TTL is the Labs TTL.
- Backlinks: $0.024 per request + $0.000036 per row.
- Account: **$50 minimum top-up** (a prepaid balance, not a monthly fee); new accounts get $1 trial credit.

A small agency doing 2,000 volume lookups, 50 keyword-idea requests (~200 items), 20 domain-keyword requests (~500 items) and a modest set of backlink checks lands near **$5 per month** (about $4.80), so one $50 top-up lasts about ten months. The big reason it is that low is batching: 2,000 keywords in two tasks cost $0.12, whereas one task per keyword would cost $120. The app always batches; if you script against DataForSEO yourself, do the same.

These are estimates from the published price pages; real cost depends on what you request. The in-app buttons show the estimated price before you press them.

## Backlinks API caveat

DataForSEO's Backlinks API may need a separate subscription or access on your account; the pricing page does not say, and this has not been confirmed. That is why it is **off by default** (Settings → "Enable Backlinks API"). If you turn it on and calls fail with an access error, check your DataForSEO plan. With it off, backlink screens fall back to the free discovery sources.

## Troubleshooting

- **"DataForSEO balance is empty" (code 40210, or HTTP 402)**: top up your DataForSEO account. Not retried.
- **Rate limit (code 40202)**: per-minute limit hit. The app retries with backoff a few times (paid POSTs included, since the call was rejected before any charge); if it still fails, wait a minute. Live volume lookups are limited to about 12 per minute per account.
- **"Not configured"**: add credentials in Settings → DataForSEO, or set the env vars; check the key if you moved the install.
- **"Set SEO_ENCRYPTION_KEY"**: see Setup step 1.
- **"No DataForSEO team budget is set"**: set the team cap.
- **Pending request never finishes**: finished tasks are collected every 2 minutes by the background job (also whenever the pending page is open). A request still waiting after **48 hours** is marked failed and its reserved budget is released. Empty balance or bad credentials reported while collecting do not fail it; fix the account and it completes.
- **"This client's country has no known DataForSEO location"**: set a supported country on the client (UK is treated as GB), or pass a location and language through the MCP tool.
- **Test connection fails**: check you used the API login/password, not the website login; the error text has credentials redacted.
