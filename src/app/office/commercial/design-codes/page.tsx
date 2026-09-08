// The design-code and colour master, on a screen of its own.
//
// WHY IT IS NOT A SECTION OF SETTINGS ANY MORE (round two, answer 15 and its
// consequence): the manager maintains the codes and the colours, and the
// settings page holds the numbering counters, the bank accounts and the company
// master, which are the admin's alone. One page could only serve both by
// showing the manager a form he must not touch. So the master moved out, the
// settings page went back to a plain `admin` gate, and this page gates the
// `designCodes` AREA — the same question middleware asks of the path.
//
// READ-ONLY IS THE EDITOR'S OWN PROP, not a <fieldset disabled> around it: a
// disabled fieldset inerts every control inside, the Find box included, so a
// login with `view` could not look a code up — the one thing it is here to do.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { areaAccessFor } from "@/lib/commercial/access-rules";
import { Card } from "@/components/ui";
import DesignCodesEditor from "@/components/commercial/settings/DesignCodesEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Design codes | Pacific ERP" };

export default async function CommercialDesignCodesPage() {
  const g = await commercialGate("view", "designCodes");
  if (g.status === 401) redirect("/login");
  const access = areaAccessFor(g.actor, "designCodes");
  if (access === "none") redirect("/no-access?from=/office/commercial/design-codes");
  const readOnly = access !== "write";
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Design codes</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          One row per design: the owner&apos;s item code (answer 20), printed on order lines and export documents, the shade
          the production queue sequences by (answer 13), and the colour read off the sample — name, L*a*b* and the swatch
          the sequencing rule measures a changeover by (round two, answers 14 and 15).
        </p>
      </div>
      <Card>
        {readOnly && (
          <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Read-only for this login. Codes, shades and colours are changed by the Commercial Manager or an admin.
          </p>
        )}
        <DesignCodesEditor readOnly={readOnly} />
      </Card>
    </>
  );
}
