import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { MainNav } from "@/components/chromia/layout/main-nav";
import { SwipeNav } from "@/components/chromia/layout/swipe-nav";
import { navigation } from "@/lib/chromia/config/navigation";
import { chromiaGate } from "@/lib/chromia/access";

/**
 * Chromia module shell.
 *
 * Chrome comes from the ERP's own <Shell> (sidebar, user card, sign-out), the
 * same as every other module — the standalone app's AppHeader is gone, because
 * a module inside the ERP must not carry a second identity bar.
 *
 * What survives from the module is its tab strip: nine screens is too many to
 * navigate from the sidebar alone on a tablet, and the strip is how the line
 * has always moved between them. It is the same MainNav component, re-rooted
 * under /chromia, on the same blue-slate strip so the active tab still rises
 * out of it in the page's own white.
 *
 * SwipeNav keeps the sideways gesture between sections on a tablet — a second
 * way in, not a replacement for the tabs.
 *
 * The gate is here rather than in each of the thirteen pages: middleware stops
 * a request at the path prefix, this stops a direct render, and each is useless
 * on its own the day the other is edited. API routes carry their own.
 */
export default async function ChromiaLayout({ children }: { children: React.ReactNode }) {
  const gate = await chromiaGate();
  if (!gate.ok) redirect(gate.status === 401 ? "/login" : "/");

  const sections = navigation.map(({ href, title }) => ({ href, title }));

  return (
    <Shell>
      <div className="chromia-root">
        {/* Pulled to the edges of Shell's padded <main> so the strip spans the
            content column the way the module's own header did, and sticky for
            the same reason it was sticky there: nine sections is too many to
            scroll back to the top to change. */}
        <div className="sticky top-0 z-20 -mx-6 -mt-8 mb-6 border-b border-[var(--header-line)] bg-[var(--header-strip)] backdrop-blur-xl supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--header-strip)_90%,transparent)]">
          <div className="relative px-6">
            <MainNav items={navigation} />
            {/* Edge fades, not scrollbars: on a narrow screen the strip
                scrolls, and a soft cut at each end is what tells you there is
                more. Carried across from the module's own header. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--header-strip)] to-transparent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--header-strip)] to-transparent"
            />
          </div>
        </div>
        <SwipeNav sections={sections}>{children}</SwipeNav>
      </div>
    </Shell>
  );
}
