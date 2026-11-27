import type { ReactNode } from "react";
import { getSetting } from "@/lib/settings-store";

/**
 * Chrome for the signed-out pages (see auth-paths.ts): the workspace
 * brand pinned at the top, the page's own centred card below. Reads only
 * the brand name and logo — nothing a visitor shouldn't see.
 */
export async function AuthShell({ children }: { children: ReactNode }) {
  let name = "SEO Tool";
  let logo: string | null = null;
  try {
    const [brandName, brandLogo] = await Promise.all([
      getSetting<string>("brand.name"),
      getSetting<string>("brand.logo_data_url"),
    ]);
    if (typeof brandName === "string" && brandName.trim()) name = brandName.trim();
    // Only inline image data URLs; anything else is ignored.
    if (typeof brandLogo === "string" && brandLogo.startsWith("data:image/")) logo = brandLogo;
  } catch {
    // Unmigrated or unreadable DB: fall back to the app name.
  }

  return (
    <main className="relative h-full overflow-y-auto">
      <header className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 p-6">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-8 w-auto max-w-40 object-contain" />
        ) : (
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-semibold text-foreground">{name}</span>
      </header>
      {children}
    </main>
  );
}
