"use client";
// Agent 2: confirming a bill as a VENDOR INVOICE rather than a reimbursement.
//
// A reimbursement is three fields. A purchase invoice is a statutory document:
// the input GST becomes a credit claimed against the government, and any TDS
// becomes a return filed with the department. So this panel is built around one
// rule - derive everything the bill actually contains, and ask a human for the
// three things it does not:
//
//   1. whether input credit is blocked under s.17(5)  (eligible / ineligible)
//   2. whether a rate maps to the goods head or the services head
//   3. which TDS section applies, if any
//
// The engine proposes; nothing is silently chosen. Where it cannot propose - an
// unread GSTIN, a tax ratio that is not a GST slab - it says so in
// `needs_review` and those messages are shown in full rather than summarised,
// because each one is a specific thing to look at on the paper bill.
import { useCallback, useEffect, useState } from "react";
import { LedgerPicker } from "@/components/office/LedgerPicker";

const API = "/api/office/finance";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmt = (n: number) => inr.format(Number.isFinite(n) ? n : 0);
const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

interface TaxLine { tax: string; rate: number; amount: number; ledger: string; alternatives: string[] }
interface Suggest { interstate: boolean | null; tax_lines: TaxLine[]; taxable: number; tax_total: number; invoice_total: number; needs_review: string[] }
interface TdsOption { ledger: string; section: string; rate: number | null; nature: string }

export interface VendorSeed {
  billId: number;
  vendor: string | null;
  gstin: string | null;
  invoiceNo: string | null;
  date: string | null;
  taxable: number | null;
  cgst: number | null;
  sgst: number | null;
  amount: number | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store" });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try {
      const d = await r.json();
      msg = typeof d.error === "string" ? d.error : (d.detail?.error ?? d.detail ?? msg);
    } catch { /* keep default */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json() as Promise<T>;
}

export function VendorInvoicePanel({ seed, onDone, onCancel }: {
  seed: VendorSeed;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [vendor, setVendor] = useState(seed.vendor ?? "");
  const [expense, setExpense] = useState("");
  const [invoiceNo, setInvoiceNo] = useState(seed.invoiceNo ?? "");
  const [date, setDate] = useState(seed.date ?? "");
  const [gstin, setGstin] = useState(seed.gstin ?? "");
  // Taxable defaults to what was read; when only a gross total was read the
  // reviewer types it, because taxable-vs-gross is the single most common way
  // to get input credit wrong and it is not safe to derive.
  const [taxable, setTaxable] = useState(String(seed.taxable ?? ""));
  const [cgst, setCgst] = useState(String(seed.cgst ?? ""));
  const [sgst, setSgst] = useState(String(seed.sgst ?? ""));
  const [igst, setIgst] = useState("");
  const [eligible, setEligible] = useState(true);
  /** The reviewer states this bill genuinely carries no GST. See the blocker
   *  below for why it is an explicit tick rather than an inference. */
  const [noGst, setNoGst] = useState(false);

  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [tdsOptions, setTdsOptions] = useState<TdsOption[]>([]);
  const [tdsLedger, setTdsLedger] = useState("");
  const [tdsRate, setTdsRate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Re-derive whenever an amount, the GSTIN or the eligibility flag changes.
  // Eligibility is in here deliberately: flipping it swaps every tax line to a
  // different ledger, and doing that silently at save time would mean the
  // screen never showed what was actually posted.
  const reload = useCallback(async () => {
    const t = num(taxable);
    if (t <= 0) { setSuggest(null); return; }
    const qs = new URLSearchParams({
      taxable: String(t), cgst: String(num(cgst)), sgst: String(num(sgst)),
      igst: String(num(igst)), vendor_gstin: gstin.trim(),
      eligible: String(eligible),
    });
    try {
      const s = await j<Suggest>(`${API}/vendor/suggest?${qs}`);
      setSuggest(s);
      setChosen((prev) => {
        const next: Record<string, string> = {};
        for (const l of s.tax_lines) next[l.tax] = prev[l.tax] && [l.ledger, ...l.alternatives].includes(prev[l.tax]) ? prev[l.tax] : l.ledger;
        return next;
      });
      setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [taxable, cgst, sgst, igst, gstin, eligible]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    j<{ candidates: TdsOption[] }>(`${API}/tds`)
      .then((d) => setTdsOptions(d.candidates))
      .catch(() => setTdsOptions([]));
  }, []);

  const taxTotal = suggest?.tax_lines.reduce((a, l) => a + l.amount, 0) ?? 0;
  const invoiceTotal = num(taxable) + taxTotal;
  // TDS is deducted on the TAXABLE value, never on the gross. Deducting on the
  // total over-withholds and the vendor disputes it.
  const tdsAmount = tdsRate == null ? 0 : Math.round((num(taxable) * tdsRate) / 100);
  const payable = invoiceTotal - tdsAmount;

  const blockers: string[] = [];
  if (!vendor.trim()) blockers.push("Pick the vendor ledger");
  if (!expense.trim()) blockers.push("Pick the expense head");
  if (!invoiceNo.trim()) blockers.push("Enter the vendor's invoice number");
  if (num(taxable) <= 0) blockers.push("Enter the taxable value");
  // ZERO GST IS A REAL BILL — an unregistered vendor, a composition dealer, an
  // exempt supply. It used to be unsaveable: no tax lines meant no save, full
  // stop. But "the bill has no GST" and "we could not READ the GST" arrive here
  // looking identical, and letting the second through silently forfeits input
  // credit the company is entitled to — quietly, on a screen that said nothing.
  // So the reviewer says which, with one tick. Nothing else about tax changed:
  // rates, heads, splits and TDS behave exactly as before.
  if (!noGst && !suggest?.tax_lines.length) blockers.push("No tax lines resolved — tick “No GST on this bill” if that is correct");
  if (tdsAmount > 0 && !tdsLedger) blockers.push("Pick the TDS head");
  if (tdsAmount >= invoiceTotal && tdsAmount > 0) blockers.push("TDS is not less than the invoice total");

  const save = async () => {
    setSaving(true); setErr("");
    try {
      await j(`${API}/bills/${seed.billId}/confirm-vendor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_ledger: vendor.trim(),
          expense_ledger: expense.trim(),
          invoice_no: invoiceNo.trim(),
          date: date || null,
          vendor_gstin: gstin.trim() || null,
          interstate: suggest?.interstate ?? null,
          eligible,
          taxable: num(taxable),
          tax_lines: (suggest?.tax_lines ?? []).map((l) => ({
            ledger: chosen[l.tax] ?? l.ledger, amount: l.amount, tax: l.tax, rate: l.rate,
          })),
          tds_ledger: tdsAmount > 0 ? tdsLedger : "",
          tds_amount: tdsAmount,
          // Recorded, not just enforced. A voucher that books no input tax
          // should say on its face that a human decided that, so the next
          // person reading it in Tally is not left wondering whether the GST
          // was zero or simply missed. confirm-vendor already stores a
          // narration; no schema change is needed to keep the reason.
          narration: noGst ? "No GST on this bill - confirmed by reviewer" : "",
        }),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 text-sm text-gray-700">
        <span className="font-medium">Vendor invoice.</span> Input GST is claimed as credit and any TDS is
        reported to the department, so the ledgers below are checked against Tally before this can be saved.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={label}>Vendor ledger</span>
          <LedgerPicker value={vendor} person="" onSelect={setVendor} />
        </div>
        <div>
          <span className={label}>Expense head</span>
          <LedgerPicker value={expense} person="" onSelect={setExpense} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className={label}>Invoice no. <span className="text-gray-400">(the vendor&apos;s)</span></span>
          <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV/26-27/881" className={inp} />
        </div>
        <div>
          <span className={label}>Invoice date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        </div>
        <div>
          <span className={label}>Vendor GSTIN</span>
          <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="33ABCDE1234F1Z5" className={inp} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <span className={label}>Taxable (₹)</span>
          <input type="number" step="0.01" value={taxable} onChange={(e) => setTaxable(e.target.value)} className={inp} />
        </div>
        <div>
          <span className={label}>CGST</span>
          <input type="number" step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} className={inp} />
        </div>
        <div>
          <span className={label}>SGST</span>
          <input type="number" step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} className={inp} />
        </div>
        <div>
          <span className={label}>IGST</span>
          <input type="number" step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} className={inp} />
        </div>
      </div>

      {/* Placed under the tax boxes, because that is where a reviewer is looking
          when they find all three empty. */}
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={noGst}
          onChange={(e) => setNoGst(e.target.checked)} />
        <span>
          <span className="block font-medium text-gray-700">No GST on this bill</span>
          <span className="block text-xs text-gray-500">
            Unregistered vendor, composition dealer or an exempt supply. Tick this and the
            invoice saves with no input tax — leave it clear if the tax is simply unread.
          </span>
        </span>
      </label>

      {/* The "no tax read" advisory is ANSWERED once that box is ticked, so it
          stops nagging. Every other check still shows. */}
      {(noGst
        ? (suggest?.needs_review ?? []).filter((n) => !/no tax read/i.test(n))
        : (suggest?.needs_review ?? [])
      ).length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-medium">Check before saving</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {(noGst
              ? suggest!.needs_review.filter((n) => !/no tax read/i.test(n))
              : suggest!.needs_review
            ).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            Input tax {suggest?.interstate == null ? "" : suggest.interstate ? "· inter-state (IGST)" : "· intra-state (CGST + SGST)"}
          </span>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={!eligible} onChange={(e) => setEligible(!e.target.checked)} />
            Blocked credit — s.17(5)
          </label>
        </div>
        {suggest?.tax_lines.length ? (
          <div className="space-y-2">
            {suggest.tax_lines.map((l) => (
              <div key={l.tax} className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-2">
                <span className="text-xs text-gray-500">{l.tax} @ {l.rate}%</span>
                <select value={chosen[l.tax] ?? l.ledger} onChange={(e) => setChosen((p) => ({ ...p, [l.tax]: e.target.value }))} className={inp}>
                  {[l.ledger, ...l.alternatives].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-right text-sm tabular-nums text-gray-700">{fmt(l.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Enter the taxable value and tax amounts above.</p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <span className="mb-2 block text-xs font-medium text-gray-600">TDS — leave blank if none is withheld</span>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <select
            value={tdsLedger}
            onChange={(e) => {
              const v = e.target.value;
              setTdsLedger(v);
              setTdsRate(tdsOptions.find((o) => o.ledger === v)?.rate ?? null);
            }}
            className={inp}
          >
            <option value="">No TDS</option>
            {tdsOptions.map((o) => (
              <option key={o.ledger} value={o.ledger}>
                {o.nature || "other"}{o.section ? ` · ${o.section}` : ""}{o.rate != null ? ` · ${o.rate}%` : ""} — {o.ledger}
              </option>
            ))}
          </select>
          <span className="self-center text-right text-sm tabular-nums text-gray-700">{fmt(tdsAmount)}</span>
        </div>
        {tdsRate != null && (
          <p className="mt-1 text-xs text-gray-400">{tdsRate}% of the taxable value, not the invoice total.</p>
        )}
      </div>

      <div className="rounded-xl bg-gray-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Taxable</span><span className="tabular-nums">{fmt(num(taxable))}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Input tax</span><span className="tabular-nums">{fmt(taxTotal)}</span></div>
        <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-500">Invoice total</span><span className="tabular-nums">{fmt(invoiceTotal)}</span></div>
        {tdsAmount > 0 && <div className="flex justify-between"><span className="text-gray-500">Less TDS</span><span className="tabular-nums">− {fmt(tdsAmount)}</span></div>}
        <div className="flex justify-between border-t border-gray-200 pt-1 font-medium"><span>Payable to vendor</span><span className="tabular-nums">{fmt(payable)}</span></div>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {blockers.length > 0 && (
        <p className="text-xs text-gray-400">{blockers.join(" · ")}</p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost}>Back to reimbursement</button>
        <button type="button" onClick={save} disabled={saving || blockers.length > 0} className={btnPrimary}>
          {saving ? "Saving…" : "Confirm invoice → approved"}
        </button>
      </div>
    </div>
  );
}
