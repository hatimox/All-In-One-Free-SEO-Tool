import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  GOOGLE_ADS_SCOPE,
  getGoogleClientCredentials,
  resolveRedirectUri,
} from "@/lib/google-oauth";
import { startOAuthState } from "@/ext/access/oauth-state"; // ext: access

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const creds = await getGoogleClientCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL(
        "/settings/google?error=no-credentials",
        req.nextUrl.origin,
      ),
    );
  }
  // MUST use the same URI-derivation logic as settings/google/page.tsx.
  // Otherwise the URI we show the user (to register in Google Cloud
  // Console) diverges from the URI Google actually receives, and
  // Google rejects with "Error 400: invalid_request".
  const redirectUri = resolveRedirectUri(req);

  const popup = req.nextUrl.searchParams.get("popup") === "1";
  const clientId = req.nextUrl.searchParams.get("clientId");
  const ads = req.nextUrl.searchParams.get("ads") === "1";
  // ext: access — signed state (user, client, flags, expiry); see oauth-state.ts
  const started = await startOAuthState({
    clientId: clientId && /^\d+$/.test(clientId) ? Number(clientId) : null,
    popup,
    ads,
  });
  if (!started.ok) {
    return NextResponse.redirect(
      new URL(`/settings/google?error=${started.error}`, req.nextUrl.origin),
    );
  }
  const url = buildAuthUrl({
    scopes: ads ? [GOOGLE_ADS_SCOPE] : undefined,
    clientId: creds.clientId,
    redirectUri,
    state: started.state, // ext: access
  });
  return NextResponse.redirect(url);
}
