"use client";
// The export document workbook, for one invoice.
//
// The workbook is 14 sheets of formulas hanging off about 140 literal cells
// (src/lib/commercial/export-workbook/mapping.ts). This screen is those cells:
// one fieldset per group, prefilled from the order, the packing list and the
// company master, saved as commercial_export_doc_set.rootVariables so the same
// shipment regenerates identically next month.
//
// Download is an <a href download>, not a fetch: the file is 140 KB of binary
// and the browser's own download is what the user expects. Errors on that path
// therefore surface as a page of JSON rather than inline — which is why every
// other failure mode (no packing list, DTA invoice, save error) is caught and
// shown here first, and the link is disabled while any of them hold.
import { useCallback, useEffect, useMemo, useState } from "react";
import { readJson } from "@/lib/readJson";
import { Card, Badge, Empty } from "@/components/ui";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

export interface RootCellDto {
  key: string;
  sheet: string;
  cell: string;
  label: string;
  kind: "text" | "number" | "date";
  group: string;
  hint?: string;
}

interface ExportDocsDto {
  invoice: {
    id: string; orderId: string; number: string; kind: string; status: string;
    invoiceDate: string; currency: string;
    packingListId: string | null; packingListNumber: string | null;
    slabCount: number; crateCount: number;
    orderNumber: string | null; clientName: string | null;
  };
  roots: Record<string, string | number>;
  groups: Array<{ group: string; cells: RootCellDto[] }>;
  sheets: Array<{ sheet: string; what: string }>;
  saved: boolean;
  generatedAt: string | null;
  updatedAt: string | null;
}

/** Cells whose value is a paragraph rather than a field. */
const LONG_KEYS = new Set([
  "customsOffice", "deliveryTermsNote", "lutText", "selfSealingText", "igstNote",
  "c1SealColourText", "advanceAuthText", "amountInWords", "goodsDescription",
]);

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN") : null);

export function ExportDocsPanel({ invoiceId, canWrite }: { invoiceId: string; canWrite: boolean }) {
  const [data, setData] = useState<ExportDocsDto | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/office/commercial/invoices/${invoiceId}/export-docs`, { cache: "no-store" });
    } catch {
      setError("No connection — could not load the document set.");
      setLoading(false);
      return;
    }
    const r = await readJson<ExportDocsDto>(res);
    if (!r.ok || !r.data) {
      setError(r.error ?? "Could not load the document set.");
      setData(null);
    } else {
      setData(r.data);
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(r.data.roots ?? {})) v[k] = val === null || val === undefined ? "" : String(val);
      setValues(v);
      setDirty(false);
      setOpenGroup((g) => g ?? r.data!.groups[0]?.group ?? null);
    }
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    let res: Response;
    try {
      res = await fetch(`/api/office/commercial/invoices/${invoiceId}/export-docs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roots: values }),
      });
    } catch {
      setError("No connection — nothing was saved.");
      setSaving(false);
      return;
    }
    const r = await readJson<{ updatedAt?: string }>(res);
    if (!r.ok) setError(r.error ?? "Could not save the document set.");
    else { setSaved(new Date().toLocaleTimeString("en-IN")); setDirty(false); }
    setSaving(false);
  }, [data, invoiceId, values]);

  const set = (key: string, v: string) => { setValues((p) => ({ ...p, [key]: v })); setDirty(true); setSaved(null); };

  const filled = useMemo(() => {
    if (!data) return { done: 0, total: 0 };
    const all = data.groups.flatMap((g) => g.cells);
    return { done: all.filter((c) => String(values[c.key] ?? "").trim() !== "" && values[c.key] !== "0").length, total: all.length };
  }, [data, values]);

  if (loading) return <Card><div className="text-sm text-gray-500">Loading the document set…</div></Card>;

  if (error && !data) {
    return (
      <Card>
        <div className="text-sm text-red-600">{error}</div>
        <button className={`${btnGhost} mt-3`} onClick={() => void load()}>Try again</button>
      </Card>
    );
  }
  if (!data) return <Empty>Nothing to show.</Empty>;

  const inv = data.invoice;
  const noPackingList = !inv.packingListId || inv.slabCount === 0;
  const workbookHref = `/api/office/commercial/invoices/${invoiceId}/export-docs/workbook`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{inv.number}</h3>
              <Badge tone={inv.status === "ISSUED" ? "green" : inv.status === "CANCELLED" ? "red" : "amber"}>{inv.status}</Badge>
              <Badge>EXPORT</Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {inv.clientName ?? "—"} · {new Date(inv.invoiceDate).toLocaleDateString("en-IN")}
              {inv.packingListNumber ? ` · packing list ${inv.packingListNumber}` : ""}
              {inv.slabCount ? ` · ${inv.slabCount} slabs in ${inv.crateCount} crate${inv.crateCount === 1 ? "" : "s"}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {filled.done} of {filled.total} variables filled
              {data.saved ? " · saved set" : " · not saved yet, showing values worked out from the order"}
              {data.generatedAt ? ` · last generated ${when(data.generatedAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <button className={btnPrimary} disabled={saving || !dirty} onClick={() => void save()}>
                {saving ? "Saving…" : dirty ? "Save variables" : "Saved"}
              </button>
            )}
            {noPackingList ? (
              <span className="rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-400">
                Download workbook
              </span>
            ) : (
              <a className={btnGhost} href={workbookHref} download>Download workbook</a>
            )}
          </div>
        </div>

        {saved && <p className="mt-3 text-sm text-green-700">Saved at {saved}.</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {dirty && (
          <p className="mt-3 text-sm text-amber-700">
            Unsaved edits. The download uses the SAVED variables — save first, or the workbook comes out with the old values.
          </p>
        )}
        {noPackingList && (
          <p className="mt-3 text-sm text-amber-700">
            This invoice has no packing list with slabs on it, so the measurement list and the slab sheet would come out empty.
            Attach a packing list to the invoice first.
          </p>
        )}
      </Card>

      {data.groups.map((g) => {
        const open = openGroup === g.group;
        const groupFilled = g.cells.filter((c) => String(values[c.key] ?? "").trim() !== "").length;
        return (
          <Card key={g.group}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOpenGroup(open ? null : g.group)}
              aria-expanded={open}
            >
              <span className="text-sm font-semibold text-gray-900">{g.group}</span>
              <span className="text-xs text-gray-400">
                {groupFilled}/{g.cells.length} · {open ? "hide" : "show"}
              </span>
            </button>
            {open && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {g.cells.map((c) => {
                  const long = LONG_KEYS.has(c.key);
                  return (
                    <div key={c.key} className={long ? "sm:col-span-2" : ""}>
                      <label className={label} htmlFor={`root-${c.key}`}>
                        {c.label}
                        <span className="ml-2 font-normal text-gray-400">{c.sheet} · {c.cell}</span>
                      </label>
                      {long ? (
                        <textarea
                          id={`root-${c.key}`}
                          className={`${inp} min-h-[72px]`}
                          value={values[c.key] ?? ""}
                          disabled={!canWrite}
                          onChange={(e) => set(c.key, e.target.value)}
                        />
                      ) : (
                        <input
                          id={`root-${c.key}`}
                          className={inp}
                          type={c.kind === "date" ? "date" : c.kind === "number" ? "number" : "text"}
                          step={c.kind === "number" ? "any" : undefined}
                          value={values[c.key] ?? ""}
                          disabled={!canWrite}
                          onChange={(e) => set(c.key, e.target.value)}
                        />
                      )}
                      {c.hint && <p className="mt-1 text-xs text-gray-400">{c.hint}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">What the workbook contains</h3>
        <p className="mb-3 text-xs text-gray-500">
          Every sheet is generated from the variables above plus the packing list&apos;s slabs. Formulas are kept,
          so a figure corrected in Excel flows through the rest of the workbook.
        </p>
        <ul className="grid gap-1 text-sm text-gray-600 sm:grid-cols-2">
          {data.sheets.map((s) => (
            <li key={s.sheet} className="flex gap-2">
              <span className="shrink-0 font-medium text-gray-800">{s.sheet}</span>
              <span className="text-gray-500">— {s.what}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default ExportDocsPanel;
