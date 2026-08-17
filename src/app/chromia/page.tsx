import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { chromiaGate } from "@/lib/chromia/access";

export const dynamic = "force-dynamic";

/**
 * Chromia module landing — HONEST PLACEHOLDER.
 *
 * Phase 1 of the Chromia merge delivered the skeleton (schema, the CHROMIA
 * branch + roles, the middleware gate, the nav section); the module's real
 * screens — dashboard, operator entry, slab search, recalibration, reports,
 * import — arrive with the server-layer port in the next commit. This page
 * exists so a CHROMIA login lands somewhere true rather than on a bare 404:
 * middleware redirects every out-of-module path here, so the branch's home
 * page has to render even before the module does. The sibling routes the nav
 * lists (/chromia/slabs, /chromia/operator, ...) intentionally 404 until then.
 *
 * The gate below is the page's OWN check, kept per the maintenance-page
 * precedent: middleware stops the request at the path prefix, this stops a
 * direct render, and each is useless on its own the day the other is edited.
 */
export default async function ChromiaHomePage() {
  const gate = await chromiaGate();
  if (!gate.ok) redirect("/");

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Chromia</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Slab lifecycle for the Chromia line — intake, processing, QC, grading, recalibration and dispatch.
        </p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-medium">The Chromia screens are coming in the next commit.</p>
        <p className="mt-1">
          Your login and department are already live — the dashboard, operator entry, slab register,
          recalibration tracking, reports and the Excel import land here as the module&apos;s screens are ported.
        </p>
      </div>
    </Shell>
  );
}
