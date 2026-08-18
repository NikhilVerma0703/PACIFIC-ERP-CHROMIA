import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { SwipeNav } from "@/components/chromia/layout/swipe-nav";
import { navigation } from "@/lib/chromia/config/navigation";
import { chromiaGate } from "@/lib/chromia/access";

/**
 * Chromia module shell.
 *
 * Chrome comes from the ERP's own <Shell> — sidebar, user card, sign-out — the
 * same as every other module. The standalone app's AppHeader went when it was
 * ported, because a module inside the ERP must not carry a second identity bar,
 * and its tab strip has now gone the same way: the ERP's left sidebar already
 * lists all nine screens, so the strip was a second copy of the same menu
 * sitting above every page. The sidebar is the module's navigation.
 *
 * SwipeNav stays. It is not the strip — it is the module's own sideways gesture
 * between sections on a tablet, and it reads `navigation` directly, so it keeps
 * working with no visible chrome at all.
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
        <SwipeNav sections={sections}>{children}</SwipeNav>
      </div>
    </Shell>
  );
}
