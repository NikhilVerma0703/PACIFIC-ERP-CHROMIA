"use client";
// Bill automation for the Office branch (Finance / Accounts): upload a person's
// stack of bills, the engine OCRs and classifies them, a human confirms three
// fields, and one Tally-importable XML comes out per batch. All engine calls go
// through /api/office/finance/* so the API key stays server-side.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { SearchableSelect } from "@/components/robo/SearchableSelect";
import { VendorInvoicePanel } from "@/components/office/VendorInvoicePanel";
import { LedgerPicker } from "@/components/office/LedgerPicker";

const API = "/api/office/finance";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmtAmt = (n: number | null | undefined) => (n == null ? "—" : inr.format(n));

const STATUS_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  queued: "brand", processing: "brand", review: "amber", manual_entry: "amber",
  needs_reupload: "red", duplicate: "red", approved: "green", posted: "green",
  rejected: "red", error: "red",
};
const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", processing: "Reading…", review: "Review", manual_entry: "Manual entry",
  needs_reupload: "Re-scan needed", duplicate: "Duplicate?", approved: "Approved",
  posted: "In Tally", rejected: "Rejected", error: "Error",
};
const BAND_HINT: Record<string, string> = {
  high: "Confident match — check and confirm.",
  medium: "Likely match — worth a glance at the alternatives.",
  low: "Weak match — please pick the ledger.",
  none: "No suggestion — pick the ledger.",
};

interface BillRow {
  id: number; person: string; status: string; vendor: string | null;
  amount: number | null; date: string | null; ledger: string | null; exported?: boolean;
}
interface BatchState {
  id: string; person: string; total: number; done: number; finished: boolean; sum: number;
  bills: { id: number; status: string; vendor: string | null; amount: number | null }[];
}
interface Suggestion { ledger: string; score: number; band: string; reasons?: string[] }
interface BillDetail {
  person: string; status: string; image_url: string;
  ocr: { confidence: number; text: string | null; reasons: string[] };
  // NULLABLE. The engine sends `extracted: null` for a bill with no extraction
  // row - OCR failed, the page was unreadable, or it is still processing. The
  // interface used to declare it always-present, so TypeScript happily compiled
  // `detail.extracted.arithmetic_ok` and the review panel crashed on exactly the
  // bills a human most needs to look at.
  extracted: {
    vendor: string | null; gstin: string | null; invoice_no: string | null;
    date: string | null; taxable: number | null; cgst: number | null; sgst: number | null;
    igst: number | null; amount: number | null; arithmetic_ok: boolean | null;
  } | null;
  suggestions: Suggestion[];
  duplicates: { bill_id: number; reasons?: string[] }[];
}
interface Preview {
  requested: number; vouchers: number; total: number;
  new_ledgers: { name: string; parent: string }[];
  skipped: { bill_id: number; reasons: string[] }[];
}
interface ExportRow { ref: string; bill_count: number; total: number; imported: boolean; created_at?: string }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store" });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const d = await r.json(); msg = typeof d.error === "string" ? d.error : (d.detail?.error ?? d.detail ?? msg); } catch { /* keep default */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}

export function FinanceBills() {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [engineDown, setEngineDown] = useState<string>("");

  // upload
  const [person, setPerson] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [batch, setBatch] = useState<BatchState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // queue + review
  const [queue, setQueue] = useState<BillRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [form, setForm] = useState({ ledger: "", amount: "", date: "", narration: "" });
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  // Which kind of document this bill is. Reset on every open so the previous
  // bill's choice can never carry over onto the next one.
  const [vendorMode, setVendorMode] = useState(false);
  const [reason, setReason] = useState("");

  // export
  const [approved, setApproved] = useState<BillRow[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [lastExport, setLastExport] = useState<{ ref: string; vouchers: number; total: number } | null>(null);
  const [exports, setExports] = useState<ExportRow[]>([]);

  const refreshLists = useCallback(async () => {
    try {
      const [q, a, ex] = await Promise.all([
        j<{ bills: BillRow[] }>(`${API}/bills?status=review,manual_entry,duplicate,needs_reupload,error&limit=100`),
        j<{ bills: BillRow[] }>(`${API}/bills?status=approved&exported=false&limit=100`),
        j<{ exports: ExportRow[] }>(`${API}/exports?limit=8`).catch(() => ({ exports: [] as ExportRow[] })),
      ]);
      setQueue(q.bills); setApproved(a.bills); setExports(ex.exports ?? []);
      setEngineDown("");
    } catch (e) {
      setEngineDown((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // limit=5000: the whole claimant group, never a page of it. This dropdown
      // is filtered in the browser, so anything not fetched here is unreachable
      // rather than merely on "page 2" - and the old limit=500 against a
      // 607-member group silently hid every name from "Shri" onwards.
      j<{ people: string[]; total: number; truncated?: boolean }>(`${API}/people?limit=5000`)
      .then((d) => {
        setPeople(d.people.map((name) => ({ id: name, name })));
        if (d.truncated) setEngineDown(`Claimant list is incomplete — showing ${d.people.length} of ${d.total} names.`);
      })
      .catch((e) => setEngineDown((e as Error).message));
    refreshLists();
  }, [refreshLists]);

  // poll the active batch while OCR runs
  useEffect(() => {
    if (!batch || batch.finished) return;
    const t = window.setInterval(async () => {
      try {
        const d = await j<Omit<BatchState, "id">>(`${API}/batches/${batch.id}`);
        setBatch({ ...d, id: batch.id });
        if (d.finished) { window.clearInterval(t); refreshLists(); }
      } catch { window.clearInterval(t); }
    }, 1500);
    return () => window.clearInterval(t);
  }, [batch, refreshLists]);

  const upload = async () => {
    setUploadError("");
    if (!person) { setUploadError("Pick the person first — their whole stack files under one name."); return; }
    if (!files?.length) { setUploadError("Choose at least one bill (photo or PDF)."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("person", person);
      fd.set("handwritten", String(handwritten));
      for (const f of Array.from(files)) fd.append("files", f);
      const d = await j<{ batch_id: string; count: number; rejected: { filename: string; reason: string }[] }>(
        `${API}/bills`, { method: "POST", body: fd });
      setBatch({ id: d.batch_id, person, total: d.count, done: 0, finished: d.count === 0, sum: 0, bills: [] });
      if (d.rejected?.length) setUploadError(`${d.rejected.length} file(s) unreadable: ${d.rejected.map(r => r.filename).join(", ")}`);
      setFiles(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const openBill = async (id: number) => {
    setSelected(id); setDetail(null); setActionError(""); setRejectOpen(false); setReason(""); setVendorMode(false);
    try {
      const d = await j<BillDetail>(`${API}/bills/${id}`);
      setDetail(d);
      setForm({
        ledger: d.suggestions[0]?.ledger ?? "",
        // Blank rather than crashing when nothing was extracted: the reviewer
        // types the amount off the image, which is the whole point of the
        // manual-entry path.
        amount: d.extracted?.amount != null ? String(d.extracted.amount) : "",
        date: d.extracted?.date ?? "",
        narration: "",
      });
    } catch (e) { setActionError((e as Error).message); }
  };

  const confirm = async () => {
    if (selected == null || !detail) return;
    setActionError("");
    if (!form.ledger) { setActionError("Pick the expense ledger."); return; }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setActionError("Amount must be greater than zero."); return; }
    setSaving(true);
    try {
      await j(`${API}/bills/${selected}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledger: form.ledger, person: detail.person, amount: amt, date: form.date || undefined, narration: form.narration || undefined }),
      });
      setSelected(null); setDetail(null);
      refreshLists();
    } catch (e) { setActionError((e as Error).message); } finally { setSaving(false); }
  };

  const rejectBill = async () => {
    if (selected == null) return;
    if (reason.trim().length < 4) { setActionError("Give a short reason (4+ characters)."); return; }
    setSaving(true); setActionError("");
    try {
      await j(`${API}/bills/${selected}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setSelected(null); setDetail(null); setRejectOpen(false); setReason("");
      refreshLists();
    } catch (e) { setActionError((e as Error).message); } finally { setSaving(false); }
  };

  const overrideDuplicate = async () => {
    if (selected == null) return;
    if (reason.trim().length < 4) { setActionError("An override needs a reason (4+ characters) — it goes in the audit trail."); return; }
    setSaving(true); setActionError("");
    try {
      await j(`${API}/bills/${selected}/override-duplicate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setReason("");
      await openBill(selected); // back to review with the duplicate cleared
      refreshLists();
    } catch (e) { setActionError((e as Error).message); } finally { setSaving(false); }
  };

  const runPreview = async () => {
    setExportError(""); setPreview(null); setLastExport(null);
    if (!picked.size) { setExportError("Tick the bills to include."); return; }
    try {
      setPreview(await j<Preview>(`${API}/export/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill_ids: [...picked] }),
      }));
    } catch (e) { setExportError((e as Error).message); }
  };

  const runExport = async () => {
    setExporting(true); setExportError("");
    try {
      const d = await j<{ ref: string; vouchers: number; total: number }>(`${API}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill_ids: [...picked] }),
      });
      setLastExport(d); setPreview(null); setPicked(new Set());
      refreshLists();
    } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };

  const markImported = async (ref: string) => {
    try {
      await j(`${API}/exports/${encodeURIComponent(ref)}/mark-imported`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      refreshLists();
    } catch (e) { setExportError((e as Error).message); }
  };

  /** Tally refused the file (bad ledger, closed period)? Release the bills so
   * they can be fixed and exported again — otherwise they stay locked and the
   * reimbursement never happens. */
  const voidExport = async (ref: string) => {
    const why = window.prompt(`Void export ${ref}?\n\nThe bills go back to "approved" so they can be exported again. Only do this if Tally did NOT accept the file.\n\nReason:`);
    if (why == null) return;
    if (why.trim().length < 4) { setExportError("A reason of at least 4 characters is required to void an export."); return; }
    try {
      const d = await j<{ released: number }>(`${API}/exports/${encodeURIComponent(ref)}/void`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: why.trim() }),
      });
      setExportError("");
      setLastExport(null);
      refreshLists();
      window.alert(`${d.released} bill(s) released back to approved.`);
    } catch (e) { setExportError((e as Error).message); }
  };

  const suggestion = detail?.suggestions?.[0];
  const isDuplicate = detail?.status === "duplicate" && (detail?.duplicates?.length ?? 0) > 0;
  const approvedTotal = useMemo(() => approved.filter(b => picked.has(b.id)).reduce((s, b) => s + (b.amount ?? 0), 0), [approved, picked]);

  return (
    <div className="space-y-5">
      {engineDown && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {engineDown}
        </div>
      )}

      {/* ---- 1 · upload a person's stack ---- */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">1 · Upload bills</h2>
        {uploadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadError}</div>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <span className={label}>Person (who gets reimbursed)</span>
            <SearchableSelect value={person} options={people} placeholder="Search the claimant list…" onSelect={setPerson} />
            <p className="mt-1 text-xs text-gray-400">Names come from Tally, so the import can’t fail on one.</p>
          </div>
          <div>
            <span className={label}>Bills — photos or PDFs, the whole stack at once</span>
            <input ref={fileInput} type="file" multiple accept="image/*,.pdf"
              onChange={(e) => setFiles(e.target.files)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/20" />
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={handwritten} onChange={(e) => setHandwritten(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand/30" />
              Mostly handwritten bills
            </label>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={upload} disabled={uploading} className={btnPrimary}>
              {uploading ? "Uploading…" : "Upload stack"}
            </button>
          </div>
        </div>

        {batch && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-gray-700">{batch.person} — {batch.done} of {batch.total} read{batch.finished ? " · done" : "…"}</span>
              {batch.sum > 0 && <span className="font-medium text-gray-900">{fmtAmt(batch.sum)}</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }} />
            </div>
            {batch.finished && (
              <button type="button" className="mt-3 text-sm font-medium text-brand hover:underline" onClick={() => setBatch(null)}>
                Dismiss — bills are in the queue below
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ---- 2 · review queue ---- */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">2 · Needs a human · {queue.length}</h2>
        {queue.length === 0 ? (
          <Empty>Nothing waiting. Upload a stack above.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Bill</th>
                  <th className="py-2 pr-4 font-medium">Person</th>
                  <th className="py-2 pr-4 font-medium">Vendor</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Suggested ledger</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((b) => (
                  <tr key={b.id} onClick={() => openBill(b.id)}
                    className={`cursor-pointer border-b border-gray-50 last:border-0 hover:bg-brand/5 ${selected === b.id ? "bg-brand/5" : ""}`}>
                    <td className="py-2 pr-4 text-gray-400">#{b.id}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{b.person}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.vendor || "—"}</td>
                    <td className="py-2 pr-4 text-gray-900">{fmtAmt(b.amount)}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.ledger || "—"}</td>
                    <td className="py-2"><Badge tone={STATUS_TONE[b.status] ?? "brand"}>{STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* review panel */}
        {selected != null && (
          <div className="mt-4 rounded-xl border border-gray-200 p-4">
            {!detail ? (
              <p className="text-sm text-gray-400">Loading bill #{selected}…</p>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* the bill image */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Bill #{selected} — {detail.person}</h3>
                    <span className="text-xs text-gray-400">OCR {detail.ocr.confidence}%{detail.extracted?.arithmetic_ok ? " · totals reconcile ✓" : ""}</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API}${detail.image_url.replace(/^\/api\/v1/, "")}`} alt={`Bill ${selected}`}
                    className="max-h-[480px] w-full rounded-lg border border-gray-200 object-contain" />
                  {detail.ocr.text && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">What the OCR read</summary>
                      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{detail.ocr.text}</pre>
                    </details>
                  )}
                </div>

                {/* the three fields — or the vendor-invoice panel */}
                <div className="space-y-4">
                  {actionError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}

                  {/* WHAT KIND OF DOCUMENT IS THIS - asked first, because it
                      decides everything below it. A staff claim books Dr expense
                      / Cr person; a supplier's tax invoice books input GST and
                      possibly TDS as well. It cannot be inferred - plenty of
                      reimbursed restaurant bills carry a GSTIN - so the reviewer
                      says which, before filling anything in. */}
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                    {([
                      { on: false, title: "Reimbursement", sub: "Pay a person back" },
                      { on: true, title: "Vendor invoice", sub: "Input GST · TDS" },
                    ] as const).map((t) => (
                      <button
                        key={t.title}
                        type="button"
                        onClick={() => setVendorMode(t.on)}
                        className={`rounded-lg px-3 py-2 text-center transition ${
                          vendorMode === t.on
                            ? "bg-white shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        <span className={`block text-sm ${vendorMode === t.on ? "font-medium text-gray-900" : ""}`}>{t.title}</span>
                        <span className="block text-[11px] text-gray-400">{t.sub}</span>
                      </button>
                    ))}
                  </div>

                  {vendorMode ? (
                    <VendorInvoicePanel
                      seed={{
                        billId: selected,
                        vendor: detail.extracted?.vendor ?? null,
                        gstin: detail.extracted?.gstin ?? null,
                        invoiceNo: detail.extracted?.invoice_no ?? null,
                        date: detail.extracted?.date ?? null,
                        // Prefer the taxable value when the OCR separated it;
                        // otherwise leave blank rather than seeding the gross,
                        // which would silently over-claim input credit.
                        taxable: detail.extracted?.taxable ?? null,
                        cgst: detail.extracted?.cgst ?? null,
                        sgst: detail.extracted?.sgst ?? null,
                        amount: detail.extracted?.amount ?? null,
                      }}
                      onCancel={() => setVendorMode(false)}
                      onDone={() => {
                        setVendorMode(false);
                        setSelected(null);
                        setDetail(null);
                        void refreshLists();
                      }}
                    />
                  ) : (
                  <>

                  {isDuplicate && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-medium text-red-800">Looks like a duplicate of bill {detail.duplicates.map(d => `#${d.bill_id}`).join(", ")}.</p>
                      <p className="mt-1 text-xs text-red-700">{detail.duplicates[0]?.reasons?.join(" · ")}</p>
                      <div className="mt-3 flex gap-2">
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it genuinely a separate expense?" className={inp} />
                        <button type="button" onClick={overrideDuplicate} disabled={saving} className={btnGhost}>Override</button>
                      </div>
                    </div>
                  )}

                  {suggestion && !isDuplicate && (
                    <div className={`rounded-xl border p-3 text-sm ${suggestion.band === "high" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      <span className="font-medium">{Math.round(suggestion.score * 100)}% — {suggestion.ledger}.</span>{" "}
                      {BAND_HINT[suggestion.band] ?? ""}
                      {suggestion.reasons?.length ? <span className="block text-xs opacity-80">{suggestion.reasons.join(" · ")}</span> : null}
                    </div>
                  )}

                  <div>
                    <span className={label}>Expense ledger</span>
                    <LedgerPicker value={form.ledger} person={detail.person} onSelect={(l) => setForm((p) => ({ ...p, ledger: l }))} />
                    {detail.suggestions.length > 1 && !form.ledger && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {detail.suggestions.slice(0, 4).map((s) => (
                          <button key={s.ledger} type="button" onClick={() => setForm((p) => ({ ...p, ledger: s.ledger }))}
                            className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                            {s.ledger} · {Math.round(s.score * 100)}%
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className={label}>Amount (₹)</span>
                      <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inp} />
                    </div>
                    <div>
                      <span className={label}>Date</span>
                      <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className={inp} />
                    </div>
                  </div>
                  <div>
                    <span className={label}>Narration (optional)</span>
                    <input value={form.narration} onChange={(e) => setForm((p) => ({ ...p, narration: e.target.value }))} placeholder={`Reimbursement to ${detail.person}`} className={inp} />
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    {rejectOpen ? (
                      <div className="flex flex-1 gap-2">
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason — e.g. personal expense" className={inp} />
                        <button type="button" onClick={rejectBill} disabled={saving} className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">Reject</button>
                        <button type="button" onClick={() => setRejectOpen(false)} className={btnGhost}>Back</button>
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setRejectOpen(true); setReason(""); }} className="text-sm text-gray-400 transition hover:text-red-600">Reject bill</button>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setSelected(null); setDetail(null); }} className={btnGhost}>Close</button>
                          <button type="button" onClick={confirm} disabled={saving || isDuplicate} className={btnPrimary}>
                            {saving ? "Saving…" : "Confirm → approved"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---- 3 · export to Tally ---- */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">3 · Ready for Tally · {approved.length}</h2>
        {exportError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div>}
        {lastExport && (
          <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Exported {lastExport.vouchers} voucher{lastExport.vouchers === 1 ? "" : "s"} · {fmtAmt(lastExport.total)} —{" "}
            <a className="font-medium underline" href={`${API}/exports/${encodeURIComponent(lastExport.ref)}/download`}>download the XML</a>{" "}
            and import it in Tally (O: Import → Transactions), then mark it imported below.
          </div>
        )}
        {approved.length === 0 ? (
          <Empty>No approved bills waiting. Confirm bills above and they collect here.</Empty>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-3 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 text-gray-600">
                <input type="checkbox" checked={picked.size === approved.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(approved.map(b => b.id)) : new Set())}
                  className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" />
                Select all
              </label>
              {picked.size > 0 && <span className="text-gray-400">{picked.size} selected · {fmtAmt(approvedTotal)}</span>}
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={runPreview} className={btnGhost}>Preview</button>
                <button type="button" onClick={runExport} disabled={!preview || exporting} className={btnPrimary}
                  title={!preview ? "Preview first — it shows exactly what the XML will do" : ""}>
                  {exporting ? "Exporting…" : "Export XML"}
                </button>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {approved.map((b) => (
                    <tr key={b.id} className="border-b border-gray-50 last:border-0">
                      <td className="w-8 py-2">
                        <input type="checkbox" checked={picked.has(b.id)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })}
                          className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" />
                      </td>
                      <td className="py-2 pr-4 text-gray-400">#{b.id}</td>
                      <td className="py-2 pr-4 font-medium text-gray-900">{b.person}</td>
                      <td className="py-2 pr-4 text-gray-600">{b.ledger}</td>
                      <td className="py-2 pr-4 text-gray-900">{fmtAmt(b.amount)}</td>
                      <td className="py-2 text-gray-400">{b.date ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm">
                <p className="font-medium text-gray-900">This XML will create {preview.vouchers} voucher{preview.vouchers === 1 ? "" : "s"} · {fmtAmt(preview.total)}</p>
                {preview.new_ledgers.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                    <p className="font-medium">It will also CREATE {preview.new_ledgers.length} new ledger{preview.new_ledgers.length === 1 ? "" : "s"} in the live chart of accounts:</p>
                    <ul className="mt-1 list-inside list-disc text-xs">
                      {preview.new_ledgers.map((l) => <li key={l.name}>{l.name} <span className="opacity-70">under {l.parent}</span></li>)}
                    </ul>
                  </div>
                )}
                {preview.skipped.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Skipped: {preview.skipped.map((s) => `#${s.bill_id} (${s.reasons.join("; ")})`).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {exports.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Past exports</h3>
            <div className="space-y-1.5">
              {exports.map((e) => (
                <div key={e.ref} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-gray-500">{e.ref}</span>
                  <span className="text-gray-600">{e.bill_count} bills · {fmtAmt(e.total)}</span>
                  {e.imported
                    ? <Badge tone="green">imported</Badge>
                    : (
                      <>
                        <button type="button" onClick={() => markImported(e.ref)} className="text-xs text-brand hover:underline">mark imported</button>
                        <button type="button" onClick={() => voidExport(e.ref)} className="text-xs text-gray-400 hover:text-red-600 hover:underline">Tally rejected it — void</button>
                      </>
                    )}
                  <a className="text-xs text-brand hover:underline" href={`${API}/exports/${encodeURIComponent(e.ref)}/download`}>XML</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
