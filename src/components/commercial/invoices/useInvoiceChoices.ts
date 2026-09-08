"use client";
// What the two invoice dropdowns offer — the GSTINs the company issues under
// (answer 21) and the two bank accounts (answer 23) — plus the alwaysIgst
// switch (answer 22), read once per screen from the clerk-readable choices
// route rather than from the admin-only settings.
import { useEffect, useState } from "react";
import { readJson } from "@/lib/readJson";

export interface GstinChoiceDto { label: string; gstin: string }
export interface BankChoiceDto { key: "export" | "domestic"; name: string; label: string }
export interface InvoiceChoicesDto {
  gstins: GstinChoiceDto[];
  banks: BankChoiceDto[];
  alwaysIgst: boolean;
}

export function useInvoiceChoices(): { choices: InvoiceChoicesDto | null; error: string | null } {
  const [choices, setChoices] = useState<InvoiceChoicesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      let r: Response;
      try {
        r = await fetch("/api/office/commercial/invoices/choices", { cache: "no-store" });
      } catch {
        if (live) setError("Could not load the GSTIN and bank choices");
        return;
      }
      const res = await readJson<InvoiceChoicesDto>(r);
      if (!live) return;
      if (!res.ok || !res.data) setError(res.error ?? "Could not load the GSTIN and bank choices");
      else setChoices(res.data);
    })();
    return () => { live = false; };
  }, []);
  return { choices, error };
}

// There is no second GSTIN-label helper here. This hook once exported
// gstinLabelOf(choices, gstin), which formatted "GSTIN — label" from the
// dropdown choices while every screen printed gstinWithLabel(gstin, label)
// from invoice-rules off the SNAPSHOT's own label. Two formats for one value,
// and the choices-based one went stale the moment a registration left
// Settings — so the snapshot's is the only one. Use gstinWithLabel.
