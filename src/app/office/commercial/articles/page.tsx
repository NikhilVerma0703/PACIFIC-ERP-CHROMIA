// The customer's article master, and the labels that print off it
// (round three, answer 4).
//
// WHY IT IS BESIDE THE DESIGN MASTER AND NOT INSIDE IT. Our design master is
// one row per design — our code, our shade, the colour read off the sample.
// An ARTICLE is the same design at ONE SIZE seen from the CUSTOMER'S side:
// their item code, their description, their EAN-13. There were twelve of them
// for one design in the file the owner sent. One row per design could not hold
// twelve sizes, and one table could not hold both without a size column that
// is empty on every one of our own rows.
//
// It gates the same AREA as the design master (designCodes), so the people who
// maintain the codes maintain these, and READ-ONLY IS A PROP rather than a
// disabled fieldset — a login with `view` must still be able to look a barcode
// up, which is most of what this screen is for.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { areaAccessFor } from "@/lib/commercial/access-rules";
import { Card } from "@/components/ui";
import ArticlesEditor from "@/components/commercial/articles/ArticlesEditor";
import LabelsPanel from "@/components/commercial/articles/LabelsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer articles | Pacific ERP" };

export default async function CommercialArticlesPage() {
  const g = await commercialGate("view", "designCodes");
  if (g.status === 401) redirect("/login");
  const access = areaAccessFor(g.actor, "designCodes");
  if (access === "none") redirect("/no-access?from=/office/commercial/articles");
  const readOnly = access !== "write";
  const mayPack = areaAccessFor(g.actor, "packing") !== "none";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Customer articles and labels</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          One row per customer, design and size: their item code, their description and their EAN-13. The crate label is
          generated from these — item code, description, barcode, quantity and shipping date — the piece label from
          the item code and the size alone, and the edge label from the barcode alone, sized to the edge of the stone.
          A design packed with no article here prints without a barcode, and the panel below says which ones those are.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-gray-500">
          A barcode belongs to one article and to no other. A code already on another row is refused, that row is stored
          without one and saying why, and while any article of a customer is in that state none of their barcodes are
          generated or printed. Pick a customer above to set their GS1 company prefix and to generate the codes their
          blank articles are missing, in the same series as the ones they sent.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Our own design codes, shades and colours live on the{" "}
          <Link className="underline" href="/office/commercial/design-codes">design master</Link>.
        </p>
      </div>

      {readOnly && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Read-only for this login. Item codes and barcodes are changed by the Commercial Manager or an admin.
        </div>
      )}

      <ArticlesEditor readOnly={readOnly} />

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight text-gray-900">Labels off a packing list</h2>
      {mayPack ? <LabelsPanel /> : (
        <Card>
          <p className="text-sm text-gray-600">
            Labels are printed from a packing list, and packing lists are not one of this login&apos;s screens.
          </p>
        </Card>
      )}
    </>
  );
}
