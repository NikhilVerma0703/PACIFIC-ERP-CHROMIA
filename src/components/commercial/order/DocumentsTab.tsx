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
import { ExportDocsPanel } from "@/components/commercial/export-docs/ExportDocsPanel";

export default function DocumentsTab({ order, actions }: OrderTabProps) {
  const exportInvoices = (order.invoices ?? []).filter((i) => i.kind === "EXPORT");
  const dtaInvoices = (order.invoices ?? []).filter((i) => i.kind === "DTA");
  const canWrite = actions.includes("write");
  const [selected, setSelected] = useState<string>(exportInvoices[0]?.id ?? "");

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

  return (
    <div className="space-y-4">
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
