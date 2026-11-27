/**
 * Client market -> DataForSEO location_code / language_code.
 *
 * DataForSEO location codes for countries are Google's geo target ids, the
 * same ids src/lib/google-ads.ts keeps in GEO_TARGETS, so that table is
 * reused and only extended with extra countries here. Language reuses
 * `marketLanguage` (profile language, or the market's own when the profile
 * is still the default "en").
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { GEO_TARGETS, marketLanguage } from "@/lib/google-ads";

const EXTRA_GEO: Record<string, number> = {
  AT: 2040, BE: 2056, CH: 2756, SE: 2752, NO: 2578, DK: 2208, FI: 2246,
  PT: 2620, CZ: 2203, HU: 2348, BG: 2100, GR: 2300, TR: 2792, JP: 2392,
  KR: 2410, NZ: 2554, ZA: 2710, SG: 2702, AE: 2784, ID: 2360, PH: 2608,
  VN: 2704, TH: 2764, AR: 2032, CO: 2170, CL: 2152,
};

export type Market = { country: string; language: string; locationCode: number; languageCode: string };

/** Returns null when the country has no known location code (never guess a market). */
export function resolveMarket(country: string | null | undefined, language: string | null | undefined): Market | null {
  const c = (country ?? "US").toUpperCase();
  const code = GEO_TARGETS[c] ?? EXTRA_GEO[c];
  if (!code) return null;
  const lang = marketLanguage(c, language).split(/[-_]/)[0].toLowerCase();
  return { country: c === "UK" ? "GB" : c, language: lang, locationCode: code, languageCode: lang };
}

/** Reverse of resolveMarket's location code, for reopening a recorded search. */
export function countryForLocation(code: number | null | undefined): string | null {
  if (!code) return null;
  for (const [c, v] of Object.entries({ ...EXTRA_GEO, ...GEO_TARGETS })) if (v === code && c !== "UK") return c;
  return null;
}

export async function marketForClient(clientId: number): Promise<Market | null> {
  const row = db.select({ country: clients.country, language: clients.language, url: clients.url })
    .from(clients).where(eq(clients.id, clientId)).get();
  if (!row) return null;
  return resolveMarket(row.country, row.language);
}

export async function clientDomain(clientId: number): Promise<string | null> {
  const row = db.select({ url: clients.url }).from(clients).where(eq(clients.id, clientId)).get();
  if (!row?.url) return null;
  return row.url.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "") || null;
}
