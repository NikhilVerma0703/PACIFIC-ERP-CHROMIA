"use client";
// The order workspace's Documents tab: the export document workbook, one panel
// per export invoice on the order.
//
// Only EXPORT invoices have one. A domestic order's paperwork is the DTA
// invoice and the delivery challan, both PDFs on the Invoice tab — so a
// DTA-only order gets a sentence saying where to look rather than an empty
// form nobody can fill.
import { useState } from "react";
import type { OrderTabProps } from "@/lib/commercial/types";
import { Card, Badge, Empty } from "@/components/ui";
import { lineLacksCode, printedItemCode, snapshotExtras, gstinWithLabel, exportRootOverrides, overriddenSheetsNote } from "@/lib/commercial/invoice-rules";
import { noteBox } from "@/components/commercial/invoices/ui";
import { ExportDocsPanel } from "@/components/commercial/export-docs/ExportDocsPanel";
import { useInvoiceChoices } from "@/components/commercial/invoices/useInvoiceChoices";

export default function DocumentsTab({ order, actions }: OrderTabProps) {
  const exportInvoices = (order.invoices ?? []).filter((i) => i.kind === "EXPORT");
  const dtaInvoices = (order.invoices ?? []).filter((i) => i.kind === "DTA");
  const canWrite = actions.includes("write");
  const [selected, setSelected] = useState<string>(exportInvoices[0]?.id ?? "");
  // The company's OWN registration — the first entry of the clerk-readable
  // choices route (gstinChoices puts it there). Round two, answer 19: on a
  // "this invoice only" invoice it is what the packing list, the customer copy
  // and Annexure C1 are supposed to carry, and the snapshot cannot say what it
  // is, so the check below needs it from here.
  const { choices } = useInvoiceChoices();
  const ownGstin = choices?.gstins[0]?.gstin ?? null;

  if (!exportInvoices.length) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-gray-900">No export documents for this order</h3>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          The export document workbook — commercial invoice, packing list, customer copies, measurement list,
          slab sheet, gate pass, Annexure C1, Annex D and the VGM declaration — is generated per{" "}
          <strong>export</strong> invoice.
          {dtaInvoices.length
            ? " This order has only DTA (domestic) invoices; their invoice PDF and the delivery challan are on the Invoice tab."
            : order.kind === "DOMESTIC"
              ? " This is a domestic order, so its paperwork is the DTA invoice and the delivery challan, both on the Invoice tab."
              : " Issue the export invoice on the Invoice tab and it will appear here."}
        </p>
      </Card>
    );
  }

  const current = exportInvoices.find((i) => i.id === selected) ?? exportInvoices[0];
  if (!current) return <Empty>No export invoice on this order.</Empty>;
  // answer 20: the workbook's item code column is the design master's; where
  // the master has no code the sheets print the design name and the SCREEN
  // says so, here, before the file is downloaded.
  const uncoded = (current.snapshot?.lines ?? []).filter(lineLacksCode);
  const extras = current.snapshot ? snapshotExtras(current.snapshot) : null;
  // answers 21, 23: the invoice chooses the GSTIN and the bank, and the export
  // form BELOW is prefilled from them — but every root cell of that form is
  // typed over-able and the workbook prints what the form holds. So this line
  // may only claim the default; where a saved set disagrees, say so by value
  // rather than promising a GSTIN the file will not carry. Round two, answer
  // 19: that goes for the three per-sheet GSTIN cells too, which is what the
  // scope sentence below is about — so it is checked before the sentence
  // states it as fact.
  const overrides = exportRootOverrides(current.snapshot, current.exportDocSet?.rootVariables ?? null, ownGstin);
  const overriddenSheets = overriddenSheetsNote(overrides);
  // A "this invoice only" scope expects the company's OWN registration on the
  // three other sheets, so a saved form can only be checked against it once
  // the choices have arrived. Until then the sentence says it is still
  // checking rather than asserting what the file carries.
  const scopeChecked = !current.exportDocSet || (extras?.gstinApplyAll ?? true) || Boolean(ownGstin);

  return (
    <div className="space-y-4">
      {extras && (
        <p className="text-sm text-gray-600">
          The invoice is issued under GSTIN <span className="font-medium text-gray-900">{gstinWithLabel(extras.gstin, extras.gstinLabel) || "—"}</span> and the {current.snapshot.bank?.name ?? "—"} account — change either on the invoice while it is a draft. The export form&apos;s GSTIN and bank cells default to these and can be overridden there.
          {/* round two, answer 19: the answer given when the registration was
              chosen is what the sheets below were prefilled from, so say it
              here — this is the screen the workbook is downloaded from */}
          {extras.gstinLabel && (
            <>
              {" "}
              <span className="font-medium text-gray-900">
                {extras.gstinApplyAll
                  ? "It was applied to every sheet of the workbook."
                  : "It was applied to this invoice only — the packing list, the customer copy and Annexure C1 carry the company's own registration."}
              </span>
              {/* …unless a hand typed over those cells in the saved form, which
                  is what the file will actually print. Say so here rather than
                  let the sentence above stand as fact. */}
              {overriddenSheets
                ? <span className="font-medium text-amber-800"> Not on {overriddenSheets}, though — the saved export form overrides the GSTIN there.</span>
                : !scopeChecked && <span className="text-gray-500"> (still checking what the saved export form holds on those three sheets)</span>}
            </>
          )}
        </p>
      )}
      {overrides.length > 0 && (
        <div className={noteBox}>
          <strong>Overridden in the export form.</strong> The workbook prints what the saved form holds, not the invoice&apos;s choice:
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {overrides.map((o) => (
              <li key={o.key}>
                {o.what}: <span className="font-medium">{o.saved || "(blank — the sheet prints nothing)"}</span>, where the invoice&apos;s choice gives {o.expected || "—"}.
              </li>
            ))}
          </ul>
          <span className="mt-1 block">Correct it in the export form below — the saved cell is what the file carries.</span>
        </div>
      )}
      {uncoded.length > 0 && (
        <div className={noteBox}>
          {uncoded.length === 1 ? "One line has" : `${uncoded.length} lines have`} no design code in the master ({uncoded.map((l) => printedItemCode(l)).join(", ")}) — the sheets print the design name in the item code column. Codes are added under Settings.
        </div>
      )}
      {exportInvoices.length > 1 && (
        <Card>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Export invoices</h3>
          <div className="flex flex-wrap gap-2">
            {exportInvoices.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelected(i.id)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  i.id === current.id
                    ? "border-brand bg-brand/5 font-medium text-brand"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="mr-2">{i.number}</span>
                <Badge tone={i.exportDocSet ? "green" : "amber"}>{i.exportDocSet ? "set saved" : "not saved"}</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}
      <ExportDocsPanel key={current.id} invoiceId={current.id} canWrite={canWrite} />
    </div>
  );
}
