/**
 * Pages a signed-out visitor sees (sign in, first-owner registration,
 * invite acceptance). The proxy marks them with AUTH_PAGE_HEADER and the
 * root layout renders them in the bare auth shell — no sidebar, top bar,
 * AI banner or assistant, and none of the data those load.
 *
 * Pure and dependency-free: imported by src/proxy.ts.
 */
export const AUTH_PAGE_HEADER = "x-auth-page";

const EXACT = new Set(["/login", "/register"]);

export function isAuthPagePath(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (EXACT.has(p)) return true;
  // /invite/<token> only — "/invite" alone and "/invitations" are not auth pages.
  return p.startsWith("/invite/") && p.length > "/invite/".length;
}
