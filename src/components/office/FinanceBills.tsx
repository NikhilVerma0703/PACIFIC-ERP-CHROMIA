"use client";
// Bill automation for the Office branch (Finance / Accounts): upload a stack of
// bills, the engine OCRs and classifies them, a human confirms three fields, and
// one Tally-importable XML comes out per batch. All engine calls go through
// /api/office/finance/* so the API key stays server-side.
//
// A stack is VENDOR INVOICES by default — the company owes the supplier, and the
// ledger is matched from whoever raised the bill. Naming a claimant on upload is
// the exception, for when someone paid out of their own pocket. Either way the
// per-bill toggle at review can correct a stack that turns out to be mixed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { SearchableSelect } from "@/components/robo/SearchableSelect";
import { VendorInvoicePanel } from "@/components/office/VendorInvoicePanel";
import { LedgerPicker } from "@/components/office/LedgerPicker";
import { LedgerMasterCard } from "@/components/office/LedgerMasterCard";
import { isJsonBody } from "@/lib/httpJson";

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
  bills: {
    id: number; status: string; vendor: string | null; amount: number | null;
    /** The pipeline parks its "waiting for the browser" note here. See
     *  needsBrowserOcr below - it is the fallback signal when the batch
     *  response carries no explicit flag. */
    error?: string | null;
  }[];
  /**
   * True when the SERVER cannot run OCR — OCR_PROVIDER=tesseract, so
   * serverProvider() returns null and processBill leaves every page `queued`
   * (pipeline.ts). The browser then has to do the reading.
   *
   * GET /batches/{id} sends this (it is `!ocr.server_side`). Still optional in
   * the type, and needsBrowserOcr() keeps its error-note fallback, only so a
   * browser holding this page against an older deployment of the route degrades
   * to the old behaviour instead of silently never starting.
   */
  browser_ocr?: boolean;
}
interface Suggestion { ledger: string; score: number; band: string; reasons?: string[] }
interface BillDetail {
  person: string; status: string; image_url: string;
  /**
   * The stored page's mime, straight from `fin_bill_image.mime`.
   *
   * A PDF page is NEVER rasterised (pipeline.ts: rendering needs a canvas,
   * which needs a native module), so this is "application/pdf" for any page
   * split out of a PDF and an <img> cannot show it. GET /bills/{id} sends the
   * field; the <img> onError swap to <object> stays as the backstop for an
   * older route and for a mime that was recorded wrongly at ingest.
   */
  image_mime?: string | null;
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

/**
 * True when the batch still needs the BROWSER to read its pages.
 *
 * Preferred signal is the explicit flag; the fallback exists because the batch
 * route does not send it yet. A bill parked by pipeline.ts in tesseract mode is
 * `queued` and carries "Waiting for browser OCR…" in `error`, which is a far
 * safer tell than "queued for a while" — a page genuinely mid-OCR on the server
 * is also queued, and kicking off a browser transcription for it would produce
 * two extractions for one receipt.
 */
function needsBrowserOcr(b: BatchState): boolean {
  if (typeof b.browser_ocr === "boolean") return b.browser_ocr;
  return b.bills.some((x) => x.status === "queued" && /browser ocr/i.test(x.error ?? ""));
}

export function FinanceBills({ isAdmin = false }: { isAdmin?: boolean }) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [engineDown, setEngineDown] = useState<string>("");
  /** Nothing in the claimant list means no ledger master. Distinguished from
   *  "not loaded yet" so the banner cannot flash on a slow first paint. */
  const [peopleLoaded, setPeopleLoaded] = useState(false);

  // upload
  const [person, setPerson] = useState("");
  /** Opt IN to a reimbursement. Unticked (the default) means these are vendor
   *  invoices and no person is posted — see the upload card. */
  const [reimbursing, setReimbursing] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [batch, setBatch] = useState<BatchState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // browser OCR (OCR_PROVIDER=tesseract)
  const [browserOcr, setBrowserOcr] = useState({ done: 0, total: 0, current: 0, note: "" });
  /** One transcription at a time. The batch poll fires every 1.5s and this
   *  effect keys off `batch`, so without the guard a 20-second Tesseract run
   *  would be started a dozen times over on the same page. */
  const ocrBusy = useRef(false);
  /** Bills this browser already tried and could not finish. Retrying them on
   *  every poll would spin the tab forever on the one page that cannot be read. */
  const ocrFailed = useRef<Set<number>>(new Set());
  /** Set when the handoff itself is broken (no /ocr-result endpoint, or the
   *  server rejected the transcription). Stops the loop dead rather than
   *  re-reading every page in the batch against an endpoint that is not there. */
  const [ocrStopped, setOcrStopped] = useState("");

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
  /** Who to reimburse, when the bill arrived without a claimant and the
   *  reviewer is flipping it from vendor invoice to reimbursement. Empty for a
   *  bill that already names one — detail.person is used then. */
  const [claimant, setClaimant] = useState("");
  const [reason, setReason] = useState("");
  /** Render the page with <object> instead of <img>. Set from image_mime when
   *  the detail route sends it, or by the <img> failing on PDF bytes. */
  const [pdfView, setPdfView] = useState(false);

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
        setPeopleLoaded(true);
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

  // ---- browser OCR (OCR_PROVIDER=tesseract) --------------------------------
  //
  // With no server-side provider, processBill parks every page as `queued` and
  // says so; the reading has to happen here. That is not a fallback, it is the
  // default configuration: WASM Tesseract on the clerk's laptop is free, needs
  // no key, and the bill never leaves the machine — which for financial
  // documents is the better answer, not merely the cheaper one.
  //
  // ONE PAGE AT A TIME, deliberately. Each run holds a WASM instance and a web
  // worker; three in parallel on a ten-page stack locks the tab up, and the
  // clerk is watching this screen. Sequential also means the batch poll's
  // progress bar advances page by page instead of jumping at the end.
  useEffect(() => {
    if (!batch || batch.finished || ocrStopped) return;
    if (!needsBrowserOcr(batch)) return;
    if (ocrBusy.current) return;

    const pending = batch.bills
      .filter((b) => b.status === "queued" && !ocrFailed.current.has(b.id))
      .map((b) => b.id);
    if (!pending.length) return;

    ocrBusy.current = true;
    void (async () => {
      // Loaded on demand: the WASM engine and its language data must not be in
      // the bundle for the (majority) case where the server reads the bills.
      const { TesseractBrowserProvider } = await import("@/lib/ocr/tesseract");
      const engine = new TesseractBrowserProvider();

      for (let i = 0; i < pending.length; i++) {
        const id = pending[i];
        setBrowserOcr((p) => ({ ...p, done: i, total: pending.length, current: id }));
        try {
          const res = await fetch(`${API}/bills/${id}/image`, { cache: "no-store" });
          if (!res.ok) throw new Error(`page image unavailable (${res.status})`);
          const blob = await res.blob();

          // A PDF page that reached here has no text layer and no server
          // provider to read it. Tesseract takes pixels, so render it to pixels
          // first — pdfjs-dist is already a dependency and the page never
          // leaves the machine, which is the whole reason tesseract is the
          // default. This used to give up with "set OCR_PROVIDER=claude, or
          // re-upload them as photos": an environment variable and a re-scan,
          // neither of which is something the clerk reading the message can do.
          let data: Uint8Array;
          let mimeType: string;
          if (blob.type === "application/pdf") {
            const { rasterisePdf } = await import("@/lib/ocr/pdfRaster");
            const pages = await rasterisePdf(new Uint8Array(await blob.arrayBuffer()));
            if (!pages.length) throw new Error("that PDF has no pages to read");
            // Bills are split to one page at ingest, so page 1 IS the bill. A
            // multi-page file here is misfiled; read its first page and let the
            // clerk see the rest in the viewer rather than silently OCRing a
            // document that should have been split.
            data = pages[0].data;
            mimeType = pages[0].mimeType;
          } else {
            data = new Uint8Array(await blob.arrayBuffer());
            mimeType = blob.type || "image/jpeg";
          }

          const r = await engine.run({
            data,
            mimeType,
            // The handwriting hint already routed such pages to manual_entry at
            // register, so nothing reaching here was flagged.
            handwritten: false,
          });

          // CONTRACT — POST /bills/{id}/ocr-result
          //   text:       the transcription
          //   confidence: 0..1 — the OcrResult scale, sent through UNSCALED —
          //               or null when the engine scored nothing.
          //   words:      the engine's own word count. Better than counting
          //               whitespace runs in `text`, which is the server's
          //               fallback when this is absent.
          //   engine:     recorded as ocr_variant / ocr_engine.
          //
          // THE SCALE IS 0..1 AND THE SERVER ENFORCES IT (400 outside the
          // range). fin_bill.ocr_confidence stores a percentage and every
          // QUALITY threshold is expressed in one, but that conversion belongs
          // to applyBrowserOcr(), which multiplies by 100 on the way in. This
          // used to post `meanConfidence * 100`, which meant every page a
          // browser could actually read — anything scoring above 0.01 — came
          // back 400 and was added to ocrFailed, permanently disabling the
          // in-browser path for the whole session.
          //
          // `lines` is deliberately NOT sent: OcrResult.lines is toLines(text)
          // and the server recomputes exactly that with its own splitLines, so
          // the field was a second copy of the transcription on the wire that
          // no handler read.
          const post = await fetch(`${API}/bills/${id}/ocr-result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: r.text,
              confidence: r.meanConfidence,
              words: r.words.length || undefined,
              engine: r.engine,
            }),
          });
          // An expired session never reaches this route: middleware redirects
          // every unauthenticated request, including /api/*, to /login, and
          // fetch follows redirects — so the browser gets 200 and the login
          // page's HTML. Without this the transcription is thrown away and the
          // page is marked read. Same trap postJson() guards for the fab
          // screens; this call predates that helper and cannot use it (it needs
          // the raw Response to tell a missing ROUTE from a missing BILL).
          if (post.ok && !isJsonBody(post)) {
            throw new Error("your session has ended — sign in again in another tab, then re-upload this stack");
          }
          if (!post.ok) {
            const d = await post.json().catch(() => null) as { error?: string } | null;
            const why = d?.error ?? `HTTP ${post.status}`;
            // A 404 IS NOT NECESSARILY A MISSING ENDPOINT. ocrResult() answers
            // 404 "Unknown bill" for a bill that has been deleted or rejected
            // out from under the batch, and treating that as "the route does
            // not exist" stopped the WHOLE stack and told the clerk in-browser
            // reading was unavailable — which was false, and stuck until the
            // page was reloaded. Our 404 carries the API's JSON error shape; a
            // route that genuinely is not there returns the framework's HTML.
            const routeMissing = post.status === 404 && !d?.error;
            throw Object.assign(new Error(why), { fatal: routeMissing });
          }
        } catch (e) {
          ocrFailed.current.add(id);
          const err = e as Error & { fatal?: boolean };
          if (err.fatal) {
            setOcrStopped(
              `In-browser reading cannot hand pages back: ${err.message}. ` +
              "POST /bills/{id}/ocr-result is not available.",
            );
            break;
          }
          setBrowserOcr((p) => ({ ...p, note: `Bill #${id}: ${err.message}` }));
        }
      }
      setBrowserOcr((p) => ({ ...p, done: pending.length, current: 0 }));
    })().finally(() => { ocrBusy.current = false; });
  }, [batch, ocrStopped]);

  const upload = async () => {
    setUploadError("");
    // A name is required only when reimbursing. Ticking the box and then not
    // naming anyone is the one genuinely ambiguous state — it says a person
    // paid but not who — so it is caught here rather than posted as a vendor
    // stack, which is what an empty `person` would otherwise mean.
    if (reimbursing && !person) {
      setUploadError("Name the person being reimbursed, or untick the box if the company owes the vendor.");
      return;
    }
    if (!files?.length) { setUploadError("Choose at least one bill (photo or PDF)."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("person", reimbursing ? person : "");
      fd.set("handwritten", String(handwritten));
      for (const f of Array.from(files)) fd.append("files", f);
      const d = await j<{ batch_id: string; count: number; rejected: { filename: string; reason: string }[] }>(
        `${API}/bills`, { method: "POST", body: fd });
      // A fresh stack gets a fresh browser-OCR slate: a page that failed to
      // read last time is unrelated to this upload, and carrying the block over
      // would silently skip a bill that shares an id with nothing.
      ocrFailed.current = new Set();
      setBrowserOcr({ done: 0, total: 0, current: 0, note: "" });
      setBatch({ id: d.batch_id, person: reimbursing ? person : "", total: d.count, done: 0, finished: d.count === 0, sum: 0, bills: [] });
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
    setSelected(id); setDetail(null); setActionError(""); setRejectOpen(false); setReason(""); setVendorMode(false); setClaimant("");
    setPdfView(false);
    try {
      const d = await j<BillDetail>(`${API}/bills/${id}`);
      setDetail(d);
      // OPEN ON THE KIND THE BILL WAS UPLOADED AS. A bill with no claimant was
      // filed as a vendor invoice, so the vendor panel is the right first
      // screen — defaulting every bill to "Reimbursement" made the reviewer
      // switch on each one, and switching is exactly the step that gets
      // forgotten. Still only a DEFAULT: the toggle above it is unchanged, so a
      // stack that turns out to be mixed can be corrected bill by bill.
      setVendorMode(!(d.person || "").trim());
      setPdfView(d.image_mime === "application/pdf");
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
    // detail.person is empty on a bill uploaded as a vendor invoice. Caught
    // here so the reviewer sees which field to fill, rather than the server's
    // "ledger and person are required" with no clue which one is missing.
    const payee = (detail.person || "").trim() || claimant.trim();
    if (!payee) { setActionError("Name who gets reimbursed, or switch this bill to Vendor invoice."); return; }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { setActionError("Amount must be greater than zero."); return; }
    setSaving(true);
    try {
      await j(`${API}/bills/${selected}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ledger: form.ledger, person: payee, amount: amt, date: form.date || undefined, narration: form.narration || undefined }),
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

      {/* The ledger master is what makes every other card work. Admins get the
          importer; everyone else gets told why the screen is empty and who to
          ask, rather than a claimant dropdown that silently finds no names. */}
      {isAdmin && <LedgerMasterCard />}
      {!isAdmin && peopleLoaded && people.length === 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">The chart of accounts has not been imported yet.</p>
          <p className="mt-1 text-red-700">
            There are no claimants to pick and no ledgers to suggest, so bills cannot be
            filed. Ask an administrator to import MASTER.xml from Tally on this page.
          </p>
        </div>
      )}

      {/* ---- 1 · upload a stack ---- */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">1 · Upload bills</h2>
        {uploadError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{uploadError}</div>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* REIMBURSEMENT IS THE EXCEPTION, so it is the thing you opt IN to.
              The common bill is a supplier's invoice on the company: nobody is
              out of pocket, and the ledger that matters is the creditor's, read
              off the bill. Naming a claimant used to be mandatory, which
              attached every such invoice to someone as though they had paid it.
              Leave this alone and the stack is filed as vendor invoices. */}
          <div>
            <span className={label}>Who paid?</span>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={reimbursing}
                onChange={(e) => {
                  setReimbursing(e.target.checked);
                  // Clearing on un-tick matters: a name left behind in state
                  // would still be posted and would silently turn a stack of
                  // supplier invoices into somebody's expense claim.
                  if (!e.target.checked) setPerson("");
                }}
              />
              <span>
                <span className="block font-medium text-gray-700">Someone paid for these personally</span>
                <span className="block text-xs text-gray-400">Tick only to reimburse a person. Otherwise the company owes the vendor.</span>
              </span>
            </label>
            {reimbursing && (
              <div className="mt-2">
                <SearchableSelect value={person} options={people} placeholder="Search any Tally ledger…" onSelect={setPerson} />
                <p className="mt-1 text-xs text-gray-400">Every Tally ledger is searchable, staff claimants first — the import can’t fail on a name.</p>
              </div>
            )}
            {!reimbursing && (
              <p className="mt-1 text-xs text-gray-400">Vendor invoices — the ledger is matched from whoever raised the bill.</p>
            )}
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
              {/* A vendor stack has no person, and "​ — 3 of 11 read" with a
                  blank in front of the dash reads as a bug. Name the kind. */}
              <span className="text-gray-700">{batch.person || "Vendor invoices"} — {batch.done} of {batch.total} read{batch.finished ? " · done" : "…"}</span>
              {batch.sum > 0 && <span className="font-medium text-gray-900">{fmtAmt(batch.sum)}</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }} />
            </div>

            {/* In-browser reading. Said out loud because it changes what the
                clerk must do: this tab has to stay open and on this page, and
                the first page of the day pays a ~15 MB language-data download. */}
            {!batch.finished && needsBrowserOcr(batch) && !ocrStopped && (
              <p className="mt-2 text-xs text-gray-500">
                {browserOcr.current
                  ? <>Reading bill #{browserOcr.current} in this browser — {browserOcr.done + 1} of {browserOcr.total}.{" "}</>
                  : <>Reading these bills in this browser…{" "}</>}
                Keep this tab open. The first bill downloads the language data (~15 MB).
              </p>
            )}
            {ocrStopped && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{ocrStopped}</p>
            )}
            {browserOcr.note && !ocrStopped && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{browserOcr.note}</p>
            )}

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
                  {/* A page split out of a PDF is STORED as a one-page PDF —
                      nothing rasterises it (pipeline.ts), so an <img> shows a
                      broken icon and the reviewer has no bill to read. <object>
                      hands it to the browser's PDF viewer and, unlike <embed>,
                      carries a fallback for a browser that has none. The onError
                      swap covers the detail route not sending image_mime yet:
                      PDF bytes in an <img> fail to decode, which is the signal. */}
                  {pdfView ? (
                    <object data={`${API}${detail.image_url.replace(/^\/api\/v1/, "")}`}
                      type="application/pdf"
                      aria-label={`Bill ${selected}`}
                      className="h-[480px] w-full rounded-lg border border-gray-200">
                      <p className="p-4 text-sm text-gray-500">
                        This page is a PDF and this browser will not display it inline.{" "}
                        <a className="font-medium text-brand underline" target="_blank" rel="noreferrer"
                          href={`${API}${detail.image_url.replace(/^\/api\/v1/, "")}`}>
                          Open it in a new tab
                        </a>{" "}to read it while you fill the form.
                      </p>
                    </object>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={`${API}${detail.image_url.replace(/^\/api\/v1/, "")}`} alt={`Bill ${selected}`}
                      onError={() => setPdfView(true)}
                      className="max-h-[480px] w-full rounded-lg border border-gray-200 object-contain" />
                  )}
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

                  {/* A bill uploaded as a VENDOR invoice carries no claimant,
                      so flipping it to a reimbursement here has to name one —
                      that is the mixed stack: an envelope of supplier invoices
                      with one receipt somebody paid for. Without this the
                      confirm posted an empty person and came back 400 "ledger
                      and person are required" with nothing on screen to fix. */}
                  {!(detail.person || "").trim() && (
                    <div>
                      <span className={label}>Who gets reimbursed</span>
                      <SearchableSelect value={claimant} options={people} placeholder="Search any Tally ledger…" onSelect={setClaimant} />
                      <p className="mt-1 text-xs text-gray-400">
                        This bill was uploaded as a vendor invoice. Name the person only if they paid for it themselves.
                      </p>
                    </div>
                  )}

                  <div>
                    <span className={label}>Expense ledger</span>
                    <LedgerPicker value={form.ledger} person={detail.person || claimant} onSelect={(l) => setForm((p) => ({ ...p, ledger: l }))} />
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
