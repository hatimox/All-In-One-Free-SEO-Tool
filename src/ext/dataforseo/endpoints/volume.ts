/**
 * Keywords Data > Google Ads > search_volume
 * Docs: https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/task_post/
 *       https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
 *       https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/tasks_ready/
 *       https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/task_get/
 *
 * - POST .../search_volume/task_post  (standard queue; 1..100 tasks per POST, task status 20100)
 * - GET  .../search_volume/tasks_ready (result[].id, endpoint)
 * - GET  .../search_volume/task_get/{id}  (same result shape as live)
 * - POST .../search_volume/live (ONE task per call; 12 requests/min per account)
 * Max 1000 keywords per task, each <= 80 chars / 10 words; keywords are lowercased.
 * Billed per task, not per keyword.
 */
import { assertTaskOk, dfsLive, dfsRequest, type DfsTask } from "../client";
import { VOLUME_KEYWORDS_PER_TASK } from "../pricing";

const BASE = "/v3/keywords_data/google_ads/search_volume";

export type VolumeRow = {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  /** 0..1, derived from competition_index when present. */
  competition: number | null;
  competitionIndex: number | null;
  lowBid: number | null;
  highBid: number | null;
  /** Up to 12 monthly volumes, oldest first. */
  trend: number[] | null;
};

type RawVolume = {
  keyword?: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: string | number | null;
  competition_index?: number | null;
  low_top_of_page_bid?: number | null;
  high_top_of_page_bid?: number | null;
  monthly_searches?: { year: number; month: number; search_volume: number | null }[] | null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const LEVEL: Record<string, number> = { LOW: 0.33, MEDIUM: 0.66, HIGH: 1 };

export function mapVolumeRow(r: RawVolume): VolumeRow | null {
  if (!r || typeof r.keyword !== "string") return null;
  const idx = num(r.competition_index);
  let competition: number | null = null;
  if (idx !== null) competition = idx / 100;
  else if (typeof r.competition === "number") competition = r.competition;
  else if (typeof r.competition === "string") competition = LEVEL[r.competition.toUpperCase()] ?? null;
  const months = (r.monthly_searches ?? [])
    .filter((m) => m && typeof m.year === "number" && typeof m.month === "number")
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-12)
    .map((m) => m.search_volume ?? 0);
  return {
    keyword: r.keyword.trim().toLowerCase(),
    volume: num(r.search_volume),
    cpc: num(r.cpc),
    competition,
    competitionIndex: idx,
    lowBid: num(r.low_top_of_page_bid),
    highBid: num(r.high_top_of_page_bid),
    trend: months.length ? months : null,
  };
}

export function mapVolumeResult(task: DfsTask<RawVolume>): VolumeRow[] {
  return (task.result ?? []).map(mapVolumeRow).filter((x): x is VolumeRow => x !== null);
}

export type VolumeParams = { keywords: string[]; locationCode: number; languageCode: string };

export function chunkKeywords(keywords: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keywords.length; i += VOLUME_KEYWORDS_PER_TASK) {
    out.push(keywords.slice(i, i + VOLUME_KEYWORDS_PER_TASK));
  }
  return out;
}

const body = (p: VolumeParams) => ({
  keywords: p.keywords,
  location_code: p.locationCode,
  language_code: p.languageCode,
});

/** Live: one task (<=1000 keywords). Returns rows and actual cost (USD). */
export async function volumeLive(p: VolumeParams) {
  const t = await dfsLive<RawVolume>(`${BASE}/live`, body(p));
  return { rows: mapVolumeResult(t), costUsd: t.cost ?? 0, taskId: t.id };
}

/** Standard queue: posts one task per call (callers chunk to <=1000). */
export async function volumePost(p: VolumeParams) {
  const env = await dfsRequest("POST", `${BASE}/task_post`, [body(p)]);
  const t = env.tasks?.[0];
  assertTaskOk(t, "task");
  return { taskId: t.id, costUsd: t.cost ?? 0 };
}

export async function volumeTasksReady(): Promise<string[]> {
  const env = await dfsRequest<{ id: string }>("GET", `${BASE}/tasks_ready`);
  const ids: string[] = [];
  for (const t of env.tasks ?? []) for (const r of t.result ?? []) if (r?.id) ids.push(r.id);
  return ids;
}

export async function volumeTaskGet(id: string) {
  const env = await dfsRequest<RawVolume>("GET", `${BASE}/task_get/${encodeURIComponent(id)}`);
  const t = env.tasks?.[0];
  assertTaskOk(t, "task");
  return { rows: mapVolumeResult(t), costUsd: t.cost ?? 0 };
}
