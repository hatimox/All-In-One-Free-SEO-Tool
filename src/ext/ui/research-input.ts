/**
 * Pure helpers for the keyword-research flow: what the search box means,
 * where it navigates, and the questions filter. No server or React imports.
 */

import type { KeywordIdea } from "../dataforseo/endpoints/labs";

export type ResearchInput = { type: "domain"; value: string } | { type: "keyword"; value: string };

/** Host of a URL or bare domain, lowercased, without scheme, "www." or path. */
export function bareHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, "");
}

/** A URL (http...) or a single token with a dot is a domain; anything else is a keyword. */
export function detectInput(raw: string): ResearchInput | null {
  const t = raw.trim();
  if (!t) return null;
  const isDomain = /^https?:\/\//i.test(t) || (!/\s/.test(t) && /\.[a-z]{2,}([/?#:]|$)/i.test(t));
  if (isDomain) {
    const host = bareHost(t);
    if (host) return { type: "domain", value: host };
  }
  return { type: "keyword", value: t.replace(/\s+/g, " ") };
}

/** Route for a search, always under the client so access and spend attribution stay scoped. */
export function researchHref(clientId: number, input: ResearchInput, country?: string | null): string {
  const q = new URLSearchParams();
  q.set(input.type === "domain" ? "d" : "q", input.value);
  if (country) q.set("country", country);
  return `/market-data/c/${clientId}/${input.type === "domain" ? "domain" : "keyword"}?${q.toString()}`;
}

export const isQuestion = (kw: string) => /\b(who|what|when|where|why|how)\b/i.test(kw);

/** RFC 4180 CSV with a formula-injection guard for spreadsheet apps. */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export type IdeaFilters = { minVol: string; maxVol: string; minDiff: string; maxDiff: string; include: string; exclude: string };
export const EMPTY_FILTERS: IdeaFilters = { minVol: "", maxVol: "", minDiff: "", maxDiff: "", include: "", exclude: "" };

const n = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
const words = (s: string) => s.toLowerCase().split(/[\s,]+/).filter(Boolean);

/** Pure so it can be tested: rows with a null value fail a bound on that value. */
export function filterIdeas(items: KeywordIdea[], f: IdeaFilters): KeywordIdea[] {
  const [minV, maxV, minD, maxD] = [n(f.minVol), n(f.maxVol), n(f.minDiff), n(f.maxDiff)];
  const inc = words(f.include);
  const exc = words(f.exclude);
  return items.filter((i) => {
    const k = i.keyword.toLowerCase();
    if (minV !== null && (i.volume ?? -1) < minV) return false;
    if (maxV !== null && (i.volume ?? Infinity) > maxV) return false;
    if (minD !== null && (i.difficulty ?? -1) < minD) return false;
    if (maxD !== null && (i.difficulty ?? Infinity) > maxD) return false;
    if (inc.length && !inc.every((w) => k.includes(w))) return false;
    if (exc.length && exc.some((w) => k.includes(w))) return false;
    return true;
  });
}

