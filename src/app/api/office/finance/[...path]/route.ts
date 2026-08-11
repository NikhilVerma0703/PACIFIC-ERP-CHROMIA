// The finance engine's HTTP contract, served natively.
//
// WHAT THIS REPLACED
// ------------------
// This file used to be a proxy: it forwarded /api/office/finance/* to a Python
// FastAPI service on the office PC, authenticated with a shared X-API-Key and
// an X-User header. That service, its SQLite database, its disk full of bill
// images and the tunnel that exposed it are all gone. Everything the engine did
// now runs in this app, against Neon, on Vercel.
//
// The CONTRACT did not change. automation/API.md still describes it accurately
// and the three existing components (FinanceBills, LedgerPicker,
// VendorInvoicePanel) were not touched - which is the point of keeping one
// catch-all file rather than splitting into a route tree. Semantics come from
// automation/app/api.py; every deliberate difference is commented where it
// happens and listed at the end of this header.
//
// AUTH IS THE SESSION NOW
// -----------------------
// There is no API key. api.py needed one because the ERP and the engine were
// two processes on a network; here the request already carries a next-auth
// session, and `gate()` reads the acting user straight out of it. Audit fields
// take THAT name and never a client-supplied one - a header a browser can set
// is not an audit trail. Middleware gates the same paths earlier; this is
// defence in depth, matching how the other office APIs gate themselves.
//
// THE POLL IS THE WORKER
// ----------------------
// api.py started a daemon thread after an upload. A serverless function has no
// thread that outlives the response, so GET /batches/{id} - which the browser
// already polls every 1.5s (API.md section 3) - advances the queue itself
// before reporting on it. Bounded to two bills per call so the poll stays well
// inside maxDuration even when both need a hosted OCR round trip.
//
// DIVERGENCES FROM api.py, all deliberate, each also commented at its site:
//   * POST /bills/{id}/ocr-result is NEW - the completion path for
//     OCR_PROVIDER=tesseract, which runs in the reviewer's browser.
//   * GET /batches/{id} advances the queue and reports `ocr.server_side`.
//   * /reject refuses an exported bill (409), as /confirm already did.
//   * /exports/{ref}/void releases a bill only if no OTHER live export holds it.
//   * mark-imported refuses a voided export.
//   * Duplicate warnings carry `bill_id` as well as `matched_bill_id`, and
//     `reasons` parsed out of `detail` (see apiShapes.duplicateView).
//   * `ledger_master` reports the newest fin_ledger.synced_at instead of
//     MASTER.xml's mtime; there is no file here.
//   * /ledger-requests folds the bill id into the reason - fin_ledger_request
//     has no bill_id column.

import { NextRequest, NextResponse } from "next/server";

import { currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { configuredProviderName, serverProvider } from "@/lib/ocr";

import { CLASSIFY, DEDUPE, TALLY } from "@/lib/finance/config";
import {
  clampInt, consequences, duplicateView, IMPORT_INSTRUCTIONS, parseBillIds,
  parseBoolParam, parseStatuses, peopleResponse, rankNames,
} from "@/lib/finance/apiShapes";
import { normKey, voucherNumber } from "@/lib/finance/exportBatch";
import { buildForBills, linesFor, recordExport, xlsxBase64 } from "@/lib/finance/exportRun";
import {
  gstCandidates, isService, summariseGst, vendorSuggestion,
} from "@/lib/finance/gst";
import {
  applyBrowserOcr, confirmBill, newBatchId, processQueued, register,
} from "@/lib/finance/pipeline";
import { isoDate } from "@/lib/finance/pipelineRules";
import {
  knownLedgerNames, loadTaxIndexes, masterInfo, personLedgers, popularLedgers,
  postableLedgerNames,
} from "@/lib/finance/refs";
import {
  loadBillSummaries, loadLedgers, loadPeople, logEvent,
} from "@/lib/finance/store";
import { sectionOf, summariseTds, tdsCandidates } from "@/lib/finance/tds";

// OCR and XML generation need Node's crypto, sharp and Buffer, and a hosted OCR
// round trip is seconds. 60 is the Vercel Hobby ceiling.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/** Every response is JSON, including errors - the ERP should never have to
 *  parse an HTML error page (API.md, Conventions). */
function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** A refusal with a status and a message a clerk can act on. Thrown from any
 *  depth; the dispatcher turns it into the JSON body. */
class HttpError extends Error {
  constructor(readonly status: number, readonly payload: Record<string, unknown>) {
    super(String(payload.error ?? "error"));
    this.name = "HttpError";
  }
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(status, { error, ...extra });
}

/**
 * FINANCE / ACCOUNTS in the Office branch, or an admin. Returns the audit
 * username, or null.
 *
 * This name is written to every confirmation, override and export. It comes
 * from the server-side session and nowhere else: api.py trusted an X-User
 * header because it could not verify ERP sessions, and that header was exactly
 * as trustworthy as whoever could reach the port.
 */
async function gate(): Promise<string | null> {
  const u = await currentUser();
  if (!u) return null;
  const role = (u as { role?: string }).role ?? "";
  const branch = ((u as { branch?: string }).branch as string | undefined) ?? "SHOP_FLOOR";
  const ok = role === "ADMIN" || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
  if (!ok) return null;
  return String(u.name || u.email || "erp-user");
}

/** A JSON body, tolerant of an empty one - api.py's
 *  `await request.json() if await request.body() else {}`. */
async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw fail(400, "Body is not valid JSON");
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** A path segment that must be a positive integer bill id. */
function billIdOf(seg: string): number {
  const n = Number(seg);
  if (!Number.isInteger(n) || n <= 0) throw fail(404, "Unknown bill");
  return n;
}

/** Whether server-side OCR can run at all. `serverProvider()` throws on an
 *  unrecognised OCR_PROVIDER, and a misconfigured env var must not take down
 *  the poll that every other bill depends on. */
function ocrCapability(): { provider: string; server_side: boolean; error: string | null } {
  const provider = configuredProviderName();
  try {
    return { provider, server_side: serverProvider() !== null, error: null };
  } catch (e) {
    return { provider, server_side: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

async function health(user: string) {
  const [grouped, ledgerCount, postable, master] = await Promise.all([
    prisma.financeBill.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financeLedger.count(),
    postableLedgerNames(),
    masterInfo(),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  return json({
    ok: true,
    user,
    company: TALLY.company,
    voucher_type: TALLY.batchVoucherType,
    ledgers: postable.length,
    known_ledgers: ledgerCount,
    // How old the chart of accounts is. A ledger created in Tally today is
    // invisible here until someone re-imports, and the only thing worse than a
    // stale master is a stale master nobody can see the age of.
    ledger_master: master,
    dedupe_enabled: DEDUPE.enabled,
    // Which engine will read the next bill, and whether it can do so here at
    // all. Under tesseract the answer is "in the browser", and an admin looking
    // at a queue that never drains needs to be told that, not left guessing.
    ocr: ocrCapability(),
    bills_by_status: counts,
    awaiting_review: (counts.review ?? 0) + (counts.manual_entry ?? 0),
    ready_to_export: counts.approved ?? 0,
  });
}

async function people(url: URL) {
  // The cap is far above the master's size and `truncated` says so outright
  // when it bites: the ERP loads this list once and filters it in the browser,
  // so a name past the cap is unreachable rather than paginated.
  const limit = clampInt(url.searchParams.get("limit"), 50, 5000);
  // The WHOLE ledger master is offered, claimants first. The people-group rule
  // decides who leads the list, not who is reachable: reimbursements also get
  // filed against directors, contractors and ledgers that live outside the
  // nominated group, and a name that exists in Tally but cannot be picked
  // reads exactly like a missing import. Every name here comes from the
  // master, so /confirm canonicalises it and the export cannot create one.
  const [claimants, all] = await Promise.all([loadPeople(), knownLedgerNames()]);
  const lead = new Set(claimants);
  const names = claimants.concat(all.filter((n) => !lead.has(n)));
  return json(peopleResponse(names, url.searchParams.get("q") ?? "", limit));
}

async function ledgers(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const person = (url.searchParams.get("person") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 25, 200);

  // With no query, what THIS person has claimed before - for a driver that is
  // fuel and tolls, which is usually the answer before anyone types anything.
  if (!q && person) {
    const prior = await personLedgers(person, limit);
    if (prior.length) return json({ ledgers: prior, source: "this person's history" });
  }

  const postable = await postableLedgerNames();

  if (!q) {
    // Fall back to what the company actually uses, not the alphabet. Over-fetch
    // then filter: ledger_usage is built from Tally's Journal Register and
    // contains heads that are not codeable here, and taking `limit` rows before
    // dropping those returns a short list for no reason.
    const pickable = new Set(postable);
    const popular = (await popularLedgers(limit * 4)).filter((l) => pickable.has(l));
    if (popular.length) return json({ ledgers: popular.slice(0, limit), source: "most used" });
    // Nothing learned yet - a fresh deployment. postableLedgerNames() is
    // already expense-only, so this is api.py's "expense heads" branch without
    // needing to sort by nature.
    return json({ ledgers: postable.slice(0, limit), source: "expense heads" });
  }

  // A typed query searches the WHOLE master, expense heads ranked ahead of
  // the rest. Searching postable only left every creditor, bank and asset
  // head unfindable — and the vendor picker comes through here with
  // person="", where the name wanted is by definition not an expense head.
  const known = await knownLedgerNames();
  const pickable = new Set(postable);
  const rest = known.filter((n) => !pickable.has(n));
  const ranked = rankNames(postable, q).concat(rankNames(rest, q));
  return json({ ledgers: ranked.slice(0, limit), source: "search" });
}

// ---------------------------------------------------------------------------
// Agent 2: GST and TDS pickers
//
// PICKERS, not resolvers. Everything derivable from the bill is derived;
// the three things no part of an invoice carries - whether input credit is
// blocked under s.17(5), whether a 9% CGST line is the goods head or the
// services head, and which TDS section applies - are offered as ranked lists.
// Guessing any of them produces a wrong statutory return, which is corrected
// with the department rather than by reversing a journal entry.
// ---------------------------------------------------------------------------

async function gstLookup(url: URL) {
  const { gst } = await loadTaxIndexes();
  const tax = (url.searchParams.get("tax") ?? "").trim();
  const rateRaw = url.searchParams.get("rate");
  const eligible = parseBoolParam(url.searchParams.get("eligible")) ?? true;
  const rcm = parseBoolParam(url.searchParams.get("rcm")) ?? false;

  const out: Record<string, unknown> = { summary: summariseGst(gst) };
  if (tax && rateRaw !== null && Number.isFinite(Number(rateRaw))) {
    out.candidates = gstCandidates(gst, tax, Number(rateRaw), eligible, rcm).map((g) => ({
      ledger: g.name, tax: g.tax, rate: g.rate,
      eligible: g.eligible, rcm: g.rcm, is_service: isService(g),
    }));
  }
  return json(out);
}

async function tdsLookup(url: URL) {
  const { tds } = await loadTaxIndexes();
  const rateRaw = url.searchParams.get("rate");
  return json({
    summary: summariseTds(tds),
    candidates: tdsCandidates(tds, {
      nature: url.searchParams.get("nature") ?? "",
      section: url.searchParams.get("section") ?? "",
      rate: rateRaw !== null && Number.isFinite(Number(rateRaw)) ? Number(rateRaw) : null,
    }).map((t) => ({ ledger: t.name, section: t.section, rate: t.rate, nature: t.nature })),
  });
}

async function vendorSuggest(url: URL) {
  const p = url.searchParams;
  const taxable = Number(p.get("taxable"));
  if (!Number.isFinite(taxable)) throw fail(400, "taxable must be a number");
  const { gst } = await loadTaxIndexes();
  return json(vendorSuggestion(gst, {
    taxable,
    cgst: Number(p.get("cgst")) || 0,
    sgst: Number(p.get("sgst")) || 0,
    igst: Number(p.get("igst")) || 0,
    vendorGstin: p.get("vendor_gstin") ?? "",
    companyGstin: TALLY.companyGstin,
    eligible: parseBoolParam(p.get("eligible")) ?? true,
  }));
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload one person's stack. Returns as soon as the rows exist.
 *
 * PERSON FIRST, deliberately: the claimant is never read off the bill, because
 * a restaurant receipt does not record who paid for it. Multi-page PDFs are
 * split, so `bill_ids` is usually longer than `files` - eleven pages of
 * receipts are eleven claims, each with its own ledger and amount.
 */
async function uploadBills(req: NextRequest, user: string) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw fail(400, "Upload must be multipart/form-data with `files`, and `person` only when reimbursing someone.");
  }

  // PERSON IS OPTIONAL, AND ITS ABSENCE IS THE POINT.
  //
  // Most bills are not reimbursements. A supplier raises an invoice on the
  // company, nobody is out of pocket, and the ledger that matters is the
  // CREDITOR'S — read off the bill itself. Requiring a claimant up front made
  // every such invoice arrive attached to someone as though they had paid for
  // it, which is both wrong in the ledger and extra work at review.
  //
  // Blank means "nobody is being reimbursed": the stack is vendor invoices and
  // the review screen opens on the vendor panel. A name means the opposite —
  // that person paid on the company's behalf and is owed the money.
  //
  // Nothing downstream has to change for this. fin_bill.person is already
  // nullable, register() already writes `person || null`, afterOcr() already
  // guards its person-history and auto-approve paths on it, and buildBatch
  // already refuses a reimbursement line with "no person" rather than crediting
  // an empty ledger — so a vendor bill that never gets confirmed as one is
  // SKIPPED at export, not posted to nobody.
  const person = str(form.get("person"));
  const handwritten = ["true", "1", "on", "yes"].includes(str(form.get("handwritten")).toLowerCase());

  // "files" is what the ERP sends; the fallback picks up any File under any key
  // so a curl with -F file=@bill.pdf is not a silent no-op.
  let files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    files = [...form.values()].filter((v): v is File => v instanceof File);
  }
  if (!files.length) throw fail(400, "Attach at least one bill as `files`.");

  const batchId = newBatchId();
  const billIds: number[] = [];
  const rejected: Array<{ filename: string; reason: string }> = [];

  for (const f of files) {
    if (!f.name) continue;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      // register() applies the extension allowlist and the size cap itself and
      // reports them in `rejected`; a corrupt-but-allowed file becomes a
      // visible ERROR bill instead, which a clerk can re-scan.
      const r = await register(bytes, f.name, user, person, { handwritten, batchId });
      billIds.push(...r.billIds);
      rejected.push(...r.rejected);
    } catch (err) {
      // One unreadable file must not lose the other nine in the stack.
      rejected.push({
        filename: f.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!billIds.length) throw fail(400, "Nothing could be accepted", { rejected });

  void logEvent("upload", `${user} uploaded ${billIds.length} page(s) for ${person}`);

  // No background thread starts here - there is nowhere for one to live. The
  // browser's existing poll of `poll` drives the OCR (see batch() below).
  return json({
    batch_id: batchId,
    bill_ids: billIds,
    count: billIds.length,
    person,
    rejected,
    poll: `/api/office/finance/batches/${batchId}`,
  });
}

/**
 * Poll this while OCR runs - and it is the poll that RUNS the OCR.
 *
 * Two bills per call. The number is a budget, not a preference: a hosted OCR
 * round trip on a photographed bill is a few seconds, the function ceiling is
 * 60, and the browser calls this again 1.5s after each answer. Raising it makes
 * one poll likelier to time out and lose the work it had already claimed;
 * lowering it makes a twenty-page stack crawl.
 */
async function batch(batchId: string) {
  try {
    await processQueued(batchId, 2);
  } catch (err) {
    // Reporting the batch is more important than advancing it. A poll that 500s
    // stops the UI's interval dead (FinanceBills clears it on error), which
    // would strand every remaining page in the stack.
    void logEvent("error", `Queue run failed for batch ${batchId}: ${
      err instanceof Error ? err.message : String(err)}`);
  }

  const { bills } = await loadBillSummaries({ batchId, limit: 500 });
  if (!bills.length) throw fail(404, "Unknown batch");
  // Page order, not newest-first: this list is a progress display for one
  // upload and it should read the way the PDF did.
  bills.sort((a, b) => a.id - b.id);

  const pending = bills.filter((b) => b.status === "queued" || b.status === "processing").length;
  const sum = bills
    .filter((b) => b.status !== "duplicate" && b.status !== "error")
    .reduce((s, b) => s + (b.amount ?? 0), 0);

  const ocr = ocrCapability();

  return json({
    batch_id: batchId,
    person: bills[0].person,
    bills,
    total: bills.length,
    done: bills.length - pending,
    finished: pending === 0,
    sum: Math.round(sum * 100) / 100,
    // Under OCR_PROVIDER=tesseract nothing here can read a page, and the bills
    // stay queued forever unless the browser posts transcriptions back to
    // /bills/{id}/ocr-result. The client needs to know which world it is in.
    ocr,
    // The same fact as `ocr.server_side`, negated, because that is the question
    // the client is actually asking: "must I run Tesseract in this tab?".
    // FinanceBills.needsBrowserOcr() prefers this flag and otherwise sniffs the
    // queued bills' `error` note for "browser ocr" - a text match on a message
    // written for humans, which is the kind of coupling that survives until
    // somebody rewords the message.
    browser_ocr: !ocr.server_side,
  });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

async function listBills(url: URL) {
  const limit = clampInt(url.searchParams.get("limit"), 50, 500);
  const offset = clampInt(url.searchParams.get("offset"), 0, 100_000, 0);
  const { bills, total } = await loadBillSummaries({
    status: parseStatuses(url.searchParams.get("status")),
    person: url.searchParams.get("person"),
    batchId: url.searchParams.get("batch_id"),
    exported: parseBoolParam(url.searchParams.get("exported")),
    limit,
    offset,
  });
  return json({ bills, total, limit, offset });
}

/**
 * Everything the review screen needs, in one round trip.
 *
 * Includes the raw OCR text. That panel matters more than it looks: when a
 * suggestion is wrong, the clerk can see instantly whether the OCR misread the
 * bill or the classifier misjudged good text - and those need different fixes.
 */
async function billDetail(billId: number) {
  const bill = await prisma.financeBill.findUnique({
    where: { id: billId },
    select: {
      id: true, filename: true, pageNo: true, pageCount: true, batchId: true,
      status: true, error: true, person: true, autoApproved: true,
      fileSha256: true, ocrConfidence: true, ocrText: true, qualityJson: true,
      createdAt: true,
    },
  });
  if (!bill) throw fail(404, "Unknown bill");

  const [ex, dupes, exp, img] = await Promise.all([
    prisma.financeExtraction.findFirst({ where: { billId }, orderBy: { id: "desc" } }),
    prisma.financeDuplicate.findMany({
      where: { billId, overridden: false },
      select: { matchId: true, kind: true, detail: true },
      orderBy: { id: "asc" },
    }),
    prisma.financeExportBill.findFirst({
      where: { billId },
      // ref embeds a timestamp, so lexical order IS chronological order.
      orderBy: { ref: "desc" },
      select: { ref: true, voucherNo: true, export: { select: { status: true } } },
    }),
    // Mime only - the bytes are megabytes and belong to /image. The review pane
    // needs to know BEFORE it renders whether this page is a PDF, because a PDF
    // page is never rasterised (pipeline.ts) and an <img> cannot decode it.
    // Without this the UI finds out from the <img> onError, i.e. after showing
    // a broken image to the reviewer.
    prisma.financeBillImage.findUnique({
      where: { billId }, select: { mime: true },
    }),
  ]);

  const quality = (bill.qualityJson ?? {}) as { reasons?: unknown };
  const reasons = Array.isArray(quality.reasons) ? quality.reasons : [];

  return json({
    id: bill.id,
    filename: bill.filename,
    page_no: bill.pageNo,
    page_count: bill.pageCount,
    batch_id: bill.batchId,
    status: bill.status,
    error: bill.error,
    // The extraction's person wins: a confirmation may have corrected the
    // claimant the stack was uploaded under.
    person: ex?.person || bill.person,
    auto_approved: bill.autoApproved,
    // KEEP THE /api/v1 PREFIX. FinanceBills.tsx builds the real URL as
    // `${API}${image_url.replace(/^\/api\/v1/, "")}`, so a path that already
    // read /api/office/finance/... would be concatenated onto itself and 404.
    // The prefix is a contract artefact now, not a real route.
    image_url: `/api/v1/bills/${bill.id}/image`,
    // "application/pdf" for any page split out of a PDF, image/jpeg or
    // image/png for a photo. Null when ingest stored no page at all.
    image_mime: img?.mime ?? null,
    sha256: bill.fileSha256,
    ocr: {
      confidence: Math.round(bill.ocrConfidence ?? 0),
      text: bill.ocrText,
      quality: bill.qualityJson ?? {},
      needs_reupload: bill.status === "needs_reupload",
      reasons,
    },
    extracted: ex
      ? {
        vendor: ex.vendorName,
        gstin: ex.vendorGstin,
        invoice_no: ex.invoiceNo,
        date: isoDate(ex.invoiceDate),
        taxable: ex.taxableValue,
        cgst: ex.cgst,
        sgst: ex.sgst,
        igst: ex.igst,
        amount: ex.netAmount,
        // True means taxable + CGST + SGST reconciles to the total, so the
        // amount is arithmetically verified, not merely read.
        arithmetic_ok: ex.arithmeticOk,
        fields: ex.fieldsJson,
      }
      : null,
    ledger: ex?.ledger ?? null,
    narration: ex?.narration ?? null,
    suggestions: ex && Array.isArray(ex.suggestionsJson) ? ex.suggestionsJson : [],
    duplicates: dupes.map(duplicateView),
    export: exp
      ? { ref: exp.ref, voucher_no: exp.voucherNo, imported: exp.export.status === "imported" }
      : null,
    created_at: bill.createdAt.toISOString(),
  });
}

/** The page image, straight out of fin_bill_image.
 *
 *  Stored bytes rather than a file path: Vercel has no disk. The mime is
 *  whatever ingest produced - image/jpeg for a photo, application/pdf for a
 *  split PDF page, which the browser renders inline just as happily. */
async function billImage(billId: number): Promise<Response> {
  const img = await prisma.financeBillImage.findUnique({ where: { billId } });
  if (!img) return json({ error: "No image for that bill" }, 404);
  const bytes = new Uint8Array(img.bytes);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": img.mime || "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="bill-${billId}"`,
      // A bill image is somebody's expense claim. It must not sit in a shared
      // cache, and it never changes, so the browser may hold it for the session.
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A bill whose voucher is in an exported file cannot be edited: our records
 *  and Tally would disagree with no way to tell which is right. */
async function assertNotExported(billId: number): Promise<void> {
  const row = await prisma.financeExportBill.findFirst({
    where: { billId }, select: { ref: true },
  });
  if (row) throw fail(409, "This bill has already been exported to Tally", { ref: row.ref });
}

async function confirm(billId: number, body: Record<string, unknown>, user: string) {
  const ledger = str(body.ledger);
  const person = str(body.person);
  if (!ledger || !person) throw fail(400, "ledger and person are required");

  const amountRaw = Number(body.amount);
  if (!Number.isFinite(amountRaw)) throw fail(400, "amount must be a number");
  const amount = Math.round(amountRaw * 100) / 100;
  if (amount <= 0) throw fail(400, "amount must be greater than zero");

  const date = str(body.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // The wire format is ISO (API.md, Conventions). Anything else reaching the
    // extraction row would come back out through isoDate() as null and the
    // voucher would silently post today.
    throw fail(400, "date must be ISO YYYY-MM-DD");
  }

  const exists = await prisma.financeBill.findUnique({ where: { id: billId }, select: { id: true } });
  if (!exists) throw fail(404, "Unknown bill");
  await assertNotExported(billId);

  // THE LEDGER IS CHECKED, NOT REQUIRED TO EXIST.
  // Requiring it would break a documented feature: API.md section 8 promises
  // the preview names every ledger the export will CREATE, and a clerk may type
  // a head that is not in the master yet. What must not happen is a second
  // ledger differing from a real one only in whitespace or case, so the name is
  // canonicalised to the master's spelling when it matches - Tally resolves
  // <LEDGERNAME> byte for byte.
  const known = await knownLedgerNames();
  const canonical = new Map(known.map((n) => [normKey(n), n.trim()]));
  const exact = new Set(known.map((n) => n.trim()));
  const resolved = exact.has(ledger) ? ledger : canonical.get(normKey(ledger)) ?? ledger;
  const isNewLedger = !canonical.has(normKey(resolved));
  const isNewPerson = !canonical.has(normKey(person));

  const result = await confirmBill({
    billId, ledger: resolved, person, amount,
    date: date || null,
    narration: str(body.narration),
    user,
  });

  if (isNewLedger) {
    await logEvent(
      "ledger_request",
      `${user} confirmed bill ${billId} against '${resolved}', which is not in the Tally ` +
      `master - the export will create it under ${TALLY.newLedgerParent}`,
      billId,
    );
  }

  return json({
    ok: true,
    bill_id: billId,
    status: result.status,
    ledger: result.ledger,
    person: result.person,
    amount: result.amount,
    suggested: result.suggested,
    learned_from_correction: result.learnedFromCorrection,
    // Surfaced so the UI can warn before the preview does. Both are created by
    // the export, under new_ledger_parent / new_person_parent.
    new_ledger: isNewLedger,
    new_person: isNewPerson,
  });
}

/**
 * Approve a bill as a VENDOR INVOICE - Agent 2.
 *
 * Deliberately a separate endpoint from /confirm rather than a mode flag.
 * /confirm feeds the learning loop built around "which expense head does this
 * claimant's bill go to"; a purchase invoice answers a different question and
 * carries statutory decisions with it, so running it through the same path
 * would teach the reimbursement classifier from data that is not about
 * reimbursements.
 *
 * EVERYTHING IS REVALIDATED SERVER-SIDE even though the panel already checked
 * it. The browser can be wrong, replayed or bypassed, and the cost of a bad row
 * is a wrong input-credit claim. In particular every ledger named must exist in
 * the master: a tax or TDS head that does not is refused here rather than
 * surfacing as a skipped invoice at export time, hours later.
 */
async function confirmVendor(billId: number, body: Record<string, unknown>, user: string) {
  const exists = await prisma.financeBill.findUnique({ where: { id: billId }, select: { id: true } });
  if (!exists) throw fail(404, "Unknown bill");
  await assertNotExported(billId);

  const vendor = str(body.vendor_ledger);
  const expense = str(body.expense_ledger);
  const invoiceNo = str(body.invoice_no);
  if (!vendor || !expense) throw fail(400, "vendor_ledger and expense_ledger are required");
  if (!invoiceNo) {
    // Without it the creditor's outstandings never tie back to their statement,
    // and a later payment cannot be settled against this bill.
    throw fail(400, "invoice_no is required - it is the bill reference Tally allocates against");
  }

  const taxableRaw = Number(body.taxable);
  if (!Number.isFinite(taxableRaw)) throw fail(400, "taxable must be a number");
  const taxable = Math.round(taxableRaw * 100) / 100;
  if (taxable <= 0) throw fail(400, "taxable must be greater than zero");

  const known = new Set((await knownLedgerNames()).map(normKey));

  const rawLines = body.tax_lines;
  if (rawLines !== undefined && !Array.isArray(rawLines)) throw fail(400, "tax_lines must be a list");
  const taxLines: Array<{ ledger: string; amount: number; tax: string; rate: number | null }> = [];
  for (const [i, raw] of (Array.isArray(rawLines) ? rawLines : []).entries()) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const led = str(t.ledger);
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) throw fail(400, `tax line ${i + 1} has a non-numeric amount`);
    if (!led) throw fail(400, `tax line ${i + 1} has no ledger`);
    const rounded = Math.round(amt * 100) / 100;
    if (rounded <= 0) throw fail(400, `tax line ${i + 1} has a zero amount`);
    if (!known.has(normKey(led))) {
      throw fail(400,
        `'${led}' is not a ledger in Tally. Statutory heads are never created ` +
        "automatically - open it in Tally first.");
    }
    const rate = Number(t.rate);
    taxLines.push({
      ledger: led,
      amount: rounded,
      tax: str(t.tax).toUpperCase(),
      rate: Number.isFinite(rate) ? rate : null,
    });
  }

  const tdsLedger = str(body.tds_ledger);
  const tdsRaw = Number(body.tds_amount ?? 0);
  if (!Number.isFinite(tdsRaw)) throw fail(400, "tds_amount must be a number");
  const tdsAmount = Math.round(tdsRaw * 100) / 100;
  if (tdsLedger && !known.has(normKey(tdsLedger))) {
    throw fail(400, `'${tdsLedger}' is not a ledger in Tally`);
  }
  if ((tdsAmount > 0) !== Boolean(tdsLedger)) {
    throw fail(400, "TDS needs both a ledger and an amount, or neither");
  }

  const taxTotal = Math.round(taxLines.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const invoiceTotal = Math.round((taxable + taxTotal) * 100) / 100;
  if (tdsAmount >= invoiceTotal) {
    throw fail(400,
      `TDS ${tdsAmount.toFixed(2)} is not less than the invoice total ${invoiceTotal.toFixed(2)}`);
  }

  const date = str(body.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, "date must be ISO YYYY-MM-DD");

  const byTax = (name: string): number =>
    Math.round(taxLines.filter((t) => t.tax === name).reduce((s, t) => s + t.amount, 0) * 100) / 100;

  // fin_vendor_entry has no unique key on bill_id, so api.py's
  // "ON CONFLICT(bill_id) DO UPDATE" becomes replace-in-a-transaction. Same
  // outcome - one live row per bill - without an index change on a live table.
  await prisma.$transaction(async (tx) => {
    await tx.financeVendorEntry.deleteMany({ where: { billId } });
    await tx.financeVendorEntry.create({
      data: {
        billId,
        vendorLedger: vendor,
        expenseLedger: expense,
        taxable,
        cgst: byTax("CGST"),
        sgst: byTax("SGST"),
        igst: byTax("IGST"),
        // The chosen heads verbatim. (tax, rate, eligible) does not identify
        // one ledger, so re-deriving these at export time would overrule the
        // reviewer on the goods-vs-services call the panel exists to ask.
        taxLinesJson: taxLines,
        tdsLedger: tdsLedger || null,
        tdsSection: tdsLedger ? sectionOf(tdsLedger) || null : null,
        tdsAmount,
        invoiceNo,
        invoiceDate: date || null,
        narration: str(body.narration) || null,
        createdBy: user,
      },
    });
    await tx.financeBill.update({ where: { id: billId }, data: { status: "approved" } });
  });

  await logEvent(
    "confirm",
    `${user} confirmed bill ${billId} as a vendor invoice (${vendor}, inv ${invoiceNo}, ` +
    `${invoiceTotal.toFixed(2)}${tdsAmount ? `, TDS ${tdsAmount.toFixed(2)}` : ""})`,
    billId,
  );

  return json({
    ok: true, bill_id: billId, status: "approved", kind: "vendor",
    vendor_ledger: vendor, expense_ledger: expense, invoice_no: invoiceNo,
    taxable, tax_total: taxTotal, invoice_total: invoiceTotal,
    tds_amount: tdsAmount,
    payable: Math.round((invoiceTotal - tdsAmount) * 100) / 100,
  });
}

async function rejectBill(billId: number, body: Record<string, unknown>, user: string) {
  const reason = str(body.reason);
  const exists = await prisma.financeBill.findUnique({ where: { id: billId }, select: { id: true } });
  if (!exists) throw fail(404, "Unknown bill");
  // DIVERGENCE from api.py, which let any bill be rejected. A bill whose
  // voucher is already in Tally cannot be un-spent by changing a row here; the
  // entry has to be reversed in Tally, and marking it 'rejected' would just
  // hide it from the only screen that could tell someone it exists.
  await assertNotExported(billId);

  await prisma.financeBill.update({
    where: { id: billId },
    data: { status: "rejected", error: (reason || "rejected in the ERP").slice(0, 500) },
  });
  await logEvent("error", `${user} rejected bill ${billId}${reason ? `: ${reason}` : ""}`, billId);
  return json({ ok: true, bill_id: billId, status: "rejected" });
}

/**
 * Accept a bill the duplicate check flagged. A reason is mandatory.
 *
 * Genuine repeats happen - the same person eats at the same place twice in a
 * week for the same amount. But a duplicate payment is real money, so the
 * override is recorded with who and why, and the bill returns to REVIEW rather
 * than being approved outright.
 */
async function overrideDuplicate(billId: number, body: Record<string, unknown>, user: string) {
  const reason = str(body.reason);
  if (reason.length < 4) throw fail(400, "A reason is required to override a duplicate");

  const n = await prisma.financeDuplicate.updateMany({
    where: { billId, overridden: false },
    data: { overridden: true, overrideReason: `${user}: ${reason}`.slice(0, 500), overrideBy: user },
  });
  if (!n.count) throw fail(404, "No open duplicate warning on that bill");

  await prisma.financeBill.updateMany({
    where: { id: billId, status: "duplicate" },
    data: { status: "review", error: null },
  });
  await logEvent("anomaly", `${user} overrode the duplicate warning on bill ${billId}: ${reason}`, billId);
  return json({ ok: true, bill_id: billId, status: "review" });
}

/**
 * The browser-OCR completion path. NOT in api.py - see the file header.
 *
 * Confidence is on the OcrResult scale (0..1) and is rejected outside it rather
 * than coerced: 88 could mean 88% or a broken client, and guessing would either
 * send a good bill to re-upload or wave a bad one through the quality gate.
 */
async function ocrResult(billId: number, body: Record<string, unknown>, user: string) {
  const bill = await prisma.financeBill.findUnique({
    where: { id: billId }, select: { status: true },
  });
  if (!bill) throw fail(404, "Unknown bill");
  if (["approved", "posted", "rejected"].includes(bill.status)) {
    throw fail(409, `This bill is already '${bill.status}' - a transcription cannot change it now`);
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) throw fail(400, "text is required - post the transcription the browser produced");

  let confidence: number | null = null;
  if (body.confidence !== undefined && body.confidence !== null) {
    const c = Number(body.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw fail(400, "confidence must be between 0 and 1 (the OcrResult scale), or omitted");
    }
    confidence = c;
  }

  const words = Number(body.words);
  const result = await applyBrowserOcr(billId, {
    text,
    confidence,
    words: Number.isFinite(words) && words > 0 ? words : null,
    engine: str(body.engine) || null,
  });

  void logEvent(
    "ocr", `${user}'s browser read bill ${billId} (${result.ocrVariant}) -> ${result.status}`, billId,
  );

  return json({
    ok: true,
    bill_id: billId,
    status: result.status,
    messages: result.messages,
    suggestions: result.suggestions,
    duplicates: result.duplicates,
    confidence: result.ocrConfidence,
  });
}

// ---------------------------------------------------------------------------
// Batch export - the point of the whole system
// ---------------------------------------------------------------------------

function billIdsFromBody(body: Record<string, unknown>): number[] {
  const ids = parseBillIds(body.bill_ids);
  if (!ids.length) throw fail(400, "bill_ids is required");
  return ids;
}

const reimbVoucherNo = (billId: number, d: Date | null | undefined): string =>
  voucherNumber(billId, d, TALLY.voucherNoPrefix);

/**
 * Dry run. Changes nothing, so the ERP can show a confirmation screen.
 *
 * This is the last point at which a mistake is cheap: once the XML is in Tally,
 * unwinding it is manual work in someone's evening. So the preview names every
 * ledger that will be CREATED in the live chart of accounts, not just the
 * vouchers that will be posted.
 */
async function exportPreview(body: Record<string, unknown>) {
  const ids = billIdsFromBody(body);
  return json(consequences(await buildForBills(ids), ids.length, reimbVoucherNo));
}

async function runExport(body: Record<string, unknown>, user: string) {
  const ids = billIdsFromBody(body);
  const result = await buildForBills(ids);
  if (!result.vouchers) {
    throw fail(400, "Nothing to export", {
      skipped: result.skipped.map((s) => ({ bill_id: s.billId, reasons: s.reasons })),
    });
  }

  const recorded = await recordExport(result, user);

  await logEvent(
    "auto_post",
    `${user} exported ${result.vouchers} voucher(s) totalling ${result.total.toFixed(2)} as ` +
    `${recorded.ref}${result.newLedgers.length ? `, creating ${result.newLedgers.length} ledger(s)` : ""}`,
  );

  return json({
    ...consequences(result, ids.length, reimbVoucherNo),
    ok: true,
    ref: recorded.ref,
    filename: `${recorded.ref}.xml`,
    download_url: `/api/office/finance/exports/${encodeURIComponent(recorded.ref)}/download`,
    import_instructions: IMPORT_INSTRUCTIONS,
  });
}

async function listExports(url: URL) {
  const rows = await prisma.financeExport.findMany({
    orderBy: { createdAt: "desc" },
    take: clampInt(url.searchParams.get("limit"), 25, 200),
    select: {
      ref: true, vouchers: true, total: true, status: true, note: true,
      createdBy: true, createdAt: true, _count: { select: { bills: true } },
    },
  });
  return json({
    exports: rows.map((e) => ({
      ref: e.ref,
      voucher_type: TALLY.batchVoucherType,
      // The UI's column. A voided export has no bill rows left, so this reads
      // 0 - which is exactly what "those bills were released" means.
      bill_count: e._count.bills,
      vouchers: e.vouchers,
      total: e.total,
      status: e.status,
      imported: e.status === "imported",
      imported_note: e.note,
      created_by: e.createdBy,
      created_at: e.createdAt.toISOString(),
    })),
  });
}

async function exportDetail(ref: string) {
  const e = await prisma.financeExport.findUnique({
    where: { ref },
    select: {
      ref: true, vouchers: true, total: true, newLedgers: true, status: true,
      note: true, createdBy: true, createdAt: true,
      bills: { orderBy: { billId: "asc" }, select: { billId: true, voucherNo: true } },
    },
  });
  if (!e) throw fail(404, "Unknown export");

  // fin_export_bill has no amount column (the SQLite table did). The figure a
  // reviewer wants is the confirmed one, so it is read back from the extraction
  // rather than left out or re-derived from the XML.
  const amounts = new Map<number, number | null>();
  if (e.bills.length) {
    const rows = await prisma.financeExtraction.findMany({
      where: { billId: { in: e.bills.map((b) => b.billId) } },
      orderBy: { id: "desc" },
      select: { billId: true, netAmount: true },
    });
    for (const r of rows) if (!amounts.has(r.billId)) amounts.set(r.billId, r.netAmount);
  }

  return json({
    ref: e.ref,
    voucher_type: TALLY.batchVoucherType,
    bill_count: e.bills.length,
    vouchers: e.vouchers,
    total: e.total,
    new_ledgers: e.newLedgers ?? [],
    status: e.status,
    imported: e.status === "imported",
    imported_note: e.note,
    created_by: e.createdBy,
    created_at: e.createdAt.toISOString(),
    bills: e.bills.map((b) => ({
      bill_id: b.billId,
      voucher_no: b.voucherNo,
      amount: amounts.get(b.billId) ?? null,
    })),
    download_url: `/api/office/finance/exports/${encodeURIComponent(e.ref)}/download`,
  });
}

/**
 * Fetch the file. fmt=xml is the import; fmt=xlsx is a review sheet only.
 *
 * The distinction is enforced rather than explained: Tally's Excel import
 * cannot create masters, so importing the .xlsx would fail confusingly on any
 * batch containing a new ledger. The filename says REVIEW_ONLY for the same
 * reason - it survives being emailed to somebody who did not read the UI.
 */
async function downloadExport(ref: string, url: URL): Promise<Response> {
  const e = await prisma.financeExport.findUnique({
    where: { ref },
    select: { ref: true, xml: true, xlsxBase64: true, newLedgers: true },
  });
  if (!e) return json({ error: "Unknown export" }, 404);

  const attach = (name: string) => `attachment; filename="${name}"`;

  if ((url.searchParams.get("fmt") ?? "xml").toLowerCase() === "xlsx") {
    let b64 = e.xlsxBase64;
    if (!b64) {
      // Regenerate for an export written before the sheet was stored.
      // Eligibility is NOT re-applied: this sheet reviews an export that
      // already happened, so its bills are 'posted' by definition.
      const rows = await prisma.financeExportBill.findMany({
        where: { ref }, select: { billId: true },
      });
      const { lines } = await linesFor(rows.map((r) => r.billId), false);
      b64 = xlsxBase64(
        lines,
        (e.newLedgers as Array<{ name: string; parent: string }> | null) ?? [],
      );
    }
    const bytes = Buffer.from(b64, "base64");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": attach(`${ref}_REVIEW_ONLY.xlsx`),
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response(e.xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": attach(`${ref}.xml`),
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Record that Tally accepted the file.
 *
 * Deliberately a human confirmation, not an assumption. Nothing here can learn
 * the outcome by itself, and quietly showing exports as "in Tally" when nobody
 * checked would make the ERP's records confidently wrong - worse than showing
 * nothing.
 */
async function markImported(ref: string, body: Record<string, unknown>, user: string) {
  const e = await prisma.financeExport.findUnique({ where: { ref }, select: { status: true } });
  if (!e) throw fail(404, "Unknown export");
  if (e.status === "voided") {
    // DIVERGENCE: api.py had no void, so it could not hit this. A voided export
    // has released its bills; marking it imported would claim vouchers are in
    // Tally for bills that are queued to be exported again.
    throw fail(409, "This export was voided - its bills were released and must be exported again");
  }
  await prisma.financeExport.update({
    where: { ref },
    data: { status: "imported", note: `${user}: ${str(body.note) || "confirmed imported"}`.slice(0, 500) },
  });
  await logEvent("auto_post", `${user} marked export ${ref} as imported in Tally`);
  return json({ ok: true, ref, imported: true, status: "imported" });
}

/**
 * Release a batch that Tally rejected, or that was never imported.
 *
 * Bills are locked the moment the XML is generated, which is right - it stops
 * tomorrow's batch sweeping up the same claim. But Tally can refuse a file (a
 * bad ledger name, a closed period), and without this the bills stay locked
 * forever: the reimbursement simply never happens and nobody can re-export it.
 *
 * Refused once the export is marked imported. At that point the vouchers are in
 * the books and must be reversed in Tally, not unpicked here.
 */
async function voidExport(ref: string, body: Record<string, unknown>, user: string) {
  const reason = str(body.reason);
  if (reason.length < 4) throw fail(400, "A reason is required to void an export");

  const e = await prisma.financeExport.findUnique({
    where: { ref },
    select: { status: true, bills: { select: { billId: true } } },
  });
  if (!e) throw fail(404, "Unknown export");
  if (e.status === "imported") {
    throw fail(409,
      "This export is marked imported in Tally - reverse the vouchers in Tally " +
      "instead of voiding here.");
  }
  if (e.status === "voided") throw fail(409, "This export has already been voided");

  const billIds = e.bills.map((b) => b.billId);

  // A bill can sit in two exports only if the first was voided and it was
  // re-exported - but "voided" is a state, not a deletion, and re-export
  // deletes nothing. So before releasing anything, find the bills some OTHER
  // live export still holds: releasing those would put a bill back in the
  // approved queue while its voucher is in a file somebody is about to import.
  const heldElsewhere = billIds.length
    ? new Set((await prisma.financeExportBill.findMany({
      where: {
        billId: { in: billIds },
        ref: { not: ref },
        export: { status: { not: "voided" } },
      },
      select: { billId: true },
    })).map((r) => r.billId))
    : new Set<number>();

  const releasable = billIds.filter((id) => !heldElsewhere.has(id));

  await prisma.$transaction(async (tx) => {
    await tx.financeExportBill.deleteMany({ where: { ref } });
    if (releasable.length) {
      await tx.financeBill.updateMany({
        where: { id: { in: releasable }, status: "posted" },
        data: { status: "approved" },
      });
    }
    await tx.financeExport.update({
      where: { ref },
      data: { status: "voided", note: `VOIDED by ${user}: ${reason}`.slice(0, 500) },
    });
  });

  await logEvent(
    "auto_post",
    `${user} voided export ${ref} (${releasable.length} bill(s) released back to approved` +
    `${heldElsewhere.size ? `, ${heldElsewhere.size} held by another export` : ""}): ${reason}`,
  );

  return json({
    ok: true, ref, status: "voided",
    released: releasable.length,
    held_by_other_export: [...heldElsewhere],
  });
}

// ---------------------------------------------------------------------------
// Ledger requests, insights, events
// ---------------------------------------------------------------------------

/**
 * Ask for a ledger that does not exist yet.
 *
 * A clerk can also just type the name at confirm time and the export will
 * create it - but that puts chart-of-accounts decisions in the hands of whoever
 * is clearing the fastest. This route lets the ERP route it to someone who owns
 * the chart instead.
 */
async function ledgerRequest(body: Record<string, unknown>, user: string) {
  const name = str(body.name);
  if (!name) throw fail(400, "name is required");
  const billId = Number(body.bill_id);
  const reason = str(body.reason);

  const row = await prisma.financeLedgerRequest.create({
    data: {
      name,
      parent: str(body.parent) || TALLY.newLedgerParent,
      // fin_ledger_request has no bill_id column. The id is the whole context -
      // which bill needed this head - so it goes into the reason rather than
      // being dropped.
      reason: [reason, Number.isInteger(billId) && billId > 0 ? `(bill #${billId})` : ""]
        .filter(Boolean).join(" ") || null,
      createdBy: user,
    },
    select: { id: true },
  });
  await logEvent("ledger_request", `${user} requested a new ledger: ${name}`, null);
  return json({ ok: true, id: row.id, name, status: "pending" });
}

/**
 * What the system can honestly report about its own accuracy.
 *
 * No estimates - every number is a count over recorded decisions. Ported from
 * agent.py:317; `ledger_usage.in_master` does not exist here, so "missing
 * ledgers" is computed as usage rows with no matching fin_ledger row, which is
 * the same question asked of the data we have.
 */
async function insights() {
  const [
    confirmedTotal, editedTotal, autoApproved, hotspots, variants,
    vendorKeys, personKeys, tokenCount, usageCount, statusGroups, ledgerList,
  ] = await Promise.all([
    prisma.financeExtraction.count({ where: { ledger: { not: null } } }),
    prisma.financeExtraction.count({ where: { ledger: { not: null }, editedByUser: true } }),
    prisma.financeBill.count({ where: { autoApproved: true } }),
    prisma.financeCorrection.groupBy({
      by: ["suggested", "corrected"],
      where: { suggested: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { suggested: "desc" } },
      take: 15,
    }),
    prisma.financeBill.groupBy({
      by: ["ocrVariant"],
      where: { ocrVariant: { not: null } },
      _count: { _all: true },
      _avg: { ocrConfidence: true },
    }),
    prisma.financeVendorMemory.groupBy({ by: ["vendorKey"], _max: { count: true } }),
    prisma.financePersonMemory.groupBy({ by: ["person"] }),
    prisma.financeTokenWeight.count(),
    prisma.financeLedgerUsage.count(),
    prisma.financeBill.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.financeLedger.findMany({ select: { name: true } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const g of statusGroups) statusCounts[g.status] = g._count._all;

  // Alias mining: tokens that confirmed bills keep associating with a ledger,
  // but which appear nowhere in that ledger's search text. Adding them to the
  // seed aliases makes the FIRST bill from a new vendor classify correctly, not
  // just repeats. PROPOSED to a human, never applied - a learning system that
  // rewrites its own matching rules unreviewed is how one bad week becomes
  // permanent.
  const heavyTokens = await prisma.financeTokenWeight.findMany({
    where: { weight: { gte: 3 } },
    orderBy: { weight: "desc" },
    take: 400,
  });
  const aliasSuggestions: Array<{ token: string; ledger: string; weight: number }> = [];
  if (heavyTokens.length) {
    const searchText = new Map((await loadLedgers()).map((l) => [l.name, l.searchText]));
    for (const t of heavyTokens) {
      const st = searchText.get(t.ledger);
      if (st !== undefined && t.token.length >= 4 && !st.includes(t.token)) {
        aliasSuggestions.push({ token: t.token, ledger: t.ledger, weight: t.weight });
      }
      if (aliasSuggestions.length >= 20) break;
    }
  }

  // Ledgers Tally's own history says are alive but that no suggestion can ever
  // offer, because they are absent from the imported master.
  const inMaster = new Set(ledgerList.map((l) => l.name));
  const missing = (await prisma.financeLedgerUsage.findMany({
    orderBy: { count: "desc" }, take: 400,
  })).filter((u) => !inMaster.has(u.ledger)).slice(0, 15);

  return json({
    confirmed_total: confirmedTotal,
    accepted_unchanged: confirmedTotal - editedTotal,
    confirm_rate: confirmedTotal
      ? Math.round(((confirmedTotal - editedTotal) / confirmedTotal) * 1000) / 10
      : null,
    auto_approved: autoApproved,
    // Where the clerk keeps overriding us: each row is a lesson.
    correction_hotspots: hotspots.map((h) => ({
      suggested: h.suggested, chosen: h.corrected, n: h._count._all,
    })),
    variant_wins: variants
      .filter((v) => (v.ocrVariant ?? "") !== "")
      .map((v) => ({
        ocr_variant: v.ocrVariant,
        n: v._count._all,
        avg_conf: v._avg.ocrConfidence === null ? null : Math.round(v._avg.ocrConfidence * 10) / 10,
      }))
      .sort((a, b) => b.n - a.n),
    memory: {
      vendors: vendorKeys.length,
      trusted_vendors: vendorKeys.filter((v) => (v._max.count ?? 0) >= CLASSIFY.memoryTrustCount).length,
      people: personKeys.length,
      tokens: tokenCount,
      usage_ledgers: usageCount,
    },
    status_counts: statusCounts,
    alias_suggestions: aliasSuggestions,
    missing_ledgers: missing.map((m) => ({ ledger: m.ledger, count: m.count })),
  });
}

/** The agent's journal - what it did without being asked. */
async function events(url: URL) {
  const kind = (url.searchParams.get("kind") ?? "").trim();
  const rows = await prisma.financeAgentEvent.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { id: "desc" },
    take: clampInt(url.searchParams.get("limit"), 50, 500),
  });
  return json({
    events: rows.map((e) => ({
      id: e.id, kind: e.kind, bill_id: e.billId, message: e.message,
      created_at: e.createdAt.toISOString(),
    })),
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: NextRequest, path: string[], user: string): Promise<Response> {
  const url = new URL(req.url);
  const [a, b, c] = path;
  const post = req.method === "POST";

  if (!post) {
    if (!a || a === "health") return health(user);
    if (a === "people" && !b) return people(url);
    if (a === "ledgers" && !b) return ledgers(url);
    if (a === "gst" && !b) return gstLookup(url);
    if (a === "tds" && !b) return tdsLookup(url);
    if (a === "vendor" && b === "suggest" && !c) return vendorSuggest(url);
    if (a === "batches" && b && !c) return batch(b);
    if (a === "bills" && !b) return listBills(url);
    if (a === "bills" && b && !c) return billDetail(billIdOf(b));
    if (a === "bills" && b && c === "image") return billImage(billIdOf(b));
    if (a === "exports" && !b) return listExports(url);
    if (a === "exports" && b && !c) return exportDetail(b);
    if (a === "exports" && b && c === "download") return downloadExport(b, url);
    if (a === "insights" && !b) return insights();
    if (a === "events" && !b) return events(url);
    throw fail(404, "Unknown finance route");
  }

  // Multipart before JSON: reading the body twice is not possible, and only the
  // upload is multipart.
  if (a === "bills" && !b) return uploadBills(req, user);

  const body = await readJson(req);
  if (a === "bills" && b && c === "confirm") return confirm(billIdOf(b), body, user);
  if (a === "bills" && b && c === "confirm-vendor") return confirmVendor(billIdOf(b), body, user);
  if (a === "bills" && b && c === "reject") return rejectBill(billIdOf(b), body, user);
  if (a === "bills" && b && c === "override-duplicate") return overrideDuplicate(billIdOf(b), body, user);
  if (a === "bills" && b && c === "ocr-result") return ocrResult(billIdOf(b), body, user);
  if (a === "export" && b === "preview" && !c) return exportPreview(body);
  if (a === "export" && !b) return runExport(body, user);
  if (a === "exports" && b && c === "mark-imported") return markImported(b, body, user);
  if (a === "exports" && b && c === "void") return voidExport(b, body, user);
  if (a === "ledger-requests" && !b) return ledgerRequest(body, user);
  throw fail(404, "Unknown finance route");
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const user = await gate();
  if (!user) return json({ error: "Forbidden" }, 403);

  const { path } = await ctx.params;
  try {
    return await dispatch(req, path ?? [], user);
  } catch (err) {
    if (err instanceof HttpError) return json(err.payload, err.status);
    // Anything else is a bug, not a refusal. The message is returned because
    // the only readers are Finance and Accounts staff behind the gate above,
    // and "Request failed (500)" gives a clerk nothing to report.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[finance]", req.method, (path ?? []).join("/"), err);
    await logEvent("error", `${req.method} /${(path ?? []).join("/")} failed: ${message}`);
    return json({ error: `The finance engine hit an error: ${message}` }, 500);
  }
}

export { handler as GET, handler as POST };
