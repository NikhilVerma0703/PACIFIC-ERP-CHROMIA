import "server-only";

// Orchestration: upload -> OCR -> extract -> dedupe -> classify -> review.
//
// automation/app/pipeline.py, reshaped for serverless. Nothing here is clever;
// the intelligence lives in the modules this calls. The job of this file is to
// run them in the right order, short-circuit early when a bill cannot proceed,
// and make sure every decision is written to the database with enough context
// to explain it later.
//
// WHAT SERVERLESS CHANGES, AND WHAT IT DOES NOT
// ---------------------------------------------
// The Python had a disk, a background thread and a process that stayed alive.
// None of those exist on Vercel, so:
//
//   * Page images live in fin_bill_image (bytea) instead of data/uploads.
//   * `register` does no OCR and returns immediately, exactly as before - but
//     the work that follows is driven by the browser polling `processQueued`
//     rather than by a worker thread. Same contract, different engine: the ERP
//     already polls /batches/{id} every 1-2s (API.md section 3).
//   * A PDF page is never rasterised. Rendering to pixels needs a canvas, which
//     needs a native module, which is the whole thing this port exists to
//     avoid. A page with a text layer needs no OCR at all; a page without one
//     is handed to Claude as PDF bytes, which it reads natively. Under Google
//     Vision, which cannot, such a page is honestly marked needs_reupload.
//
// WHAT IS DELIBERATELY NOT PORTED
// -------------------------------
//   * OCR preprocessing variants (grayscale/adaptive/otsu), the best-of-N run,
//     the rescue pass and variant self-tuning. Every one of them was a
//     Tesseract accuracy workaround; the hosted providers do their own
//     preprocessing and expose no equivalent knob, so running three variants
//     would be three times the API bill for one answer.
//   * Perceptual hashing (dedupe layer 2). It needed a pHash implementation and
//     was only ever a warning; layer 1 (exact sha256, here) and layer 3
//     (business key, here) both survive.
//   * Auto-posting. The Python wrote Tally XML by itself for auto-approved
//     bills. Export here is an explicit, human-triggered batch operation, and
//     nothing in this file writes a voucher.
//
// Route handlers that call processBill/processQueued must set
// `export const runtime = "nodejs"` and a maxDuration long enough for the OCR
// call - this module needs Node's crypto, sharp and Buffer, and a hosted OCR
// round trip is seconds, not milliseconds.

import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

import { prisma } from "@/lib/prisma";
import { serverProvider, type OcrProvider, type OcrResult } from "@/lib/ocr";
import { installPdfjsDomMatrix } from "@/lib/pdf/domMatrix";

import { AGENT, CLASSIFY, DEDUPE, INGEST, QUALITY } from "./config";
import { buildQueryText, Memory, vendorKey, type Suggestion } from "./classify";
import { findDuplicates } from "./dedupe";
import { extract, hasValue, overallConfidence, type Extraction } from "./extract";
import { tokenise } from "./ledgers";
import {
  anomalyVerdict, autoApprovalVerdict, isoDate, ocrVerdict, pageLabel,
  pageMimeFor, REUPLOAD_TIPS, sanitiseFilename, splitDecision, staleReclaim,
  STALE_PROCESSING_MS, usableTextLayer,
} from "./pipelineRules";
import {
  buildClassifier, commitMemory, learningTokens, loadMemory,
  loadPersonAmountHistory, loadRecentBillFacts, logEvent, snapshotMemory,
} from "./store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterOptions {
  /** The clerk's "mostly handwritten" hint. Sends the page straight to manual
   *  entry - see below. */
  handwritten?: boolean;
  /** Groups the pages of one upload so the ERP can poll them as a batch. */
  batchId?: string;
}

export interface RegisterResult {
  batchId: string;
  billIds: number[];
  /** Files refused before any bill row existed - wrong type, empty, too big.
   *  One bad file must not lose the rest of the stack (API.md section 2). */
  rejected: Array<{ filename: string; reason: string }>;
}

export interface ProcessResult {
  billId: number;
  status: string;
  messages: string[];
  suggestions: Suggestion[];
  /** Bill ids this one was flagged against. */
  duplicates: number[];
  ocrConfidence: number | null;
  ocrVariant: string;
}

/** One page, ready to store. */
interface PageBlob {
  bytes: Buffer;
  mime: string;
  /** Embedded PDF text for this page, when there is enough of it to trust. */
  textLayer: string | null;
}

export function newBatchId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Split one uploaded file into one QUEUED bill per page. Fast - no OCR.
 *
 * ONE PAGE = ONE BILL (pipeline.py:131). A stack of receipts scanned or
 * photographed into a single 11-page PDF is eleven separate claims, each with
 * its own vendor, amount and expense ledger. Treating the file as one bill -
 * and picking the "best" page out of it - produced a single garbled record that
 * matched none of the eleven receipts.
 *
 * Returns as soon as the rows exist so the browser has something to render; the
 * reading happens afterwards through processQueued.
 */
export async function register(
  bytes: Uint8Array,
  filename: string,
  user: string,
  person: string,
  opts: RegisterOptions = {},
): Promise<RegisterResult> {
  const batchId = opts.batchId || newBatchId();
  const safeName = sanitiseFilename(filename);

  const decision = splitDecision(safeName, bytes.byteLength, {
    allowedExtensions: INGEST.allowedExtensions,
    maxUploadBytes: INGEST.maxUploadBytes,
  });
  if (decision.kind === "rejected") {
    // Refused before a row exists: the clerk gets it back in `rejected` and can
    // re-scan. Writing an error BILL for a .docx would put a permanent
    // non-bill in the review queue.
    return { batchId, billIds: [], rejected: [{ filename: safeName, reason: decision.reason! }] };
  }

  let pages: PageBlob[];
  try {
    pages = decision.kind === "pdf"
      ? await splitPdfPages(bytes)
      : [{ bytes: await normaliseImage(bytes), mime: "image/jpeg", textLayer: null }];
  } catch (err) {
    // A corrupt or empty PDF must become a visible ERROR bill, not a 500. The
    // clerk sees "could not be read" in the batch list next to the pages that
    // worked; an exception here used to take the whole upload down with it.
    const id = await insertErrorBill(safeName, batchId, person, user, bytes, describeError(err));
    return { batchId, billIds: [id], rejected: [] };
  }

  if (!pages.length) {
    const id = await insertErrorBill(
      safeName, batchId, person, user, bytes, "The PDF contains no pages.",
    );
    return { batchId, billIds: [id], rejected: [] };
  }

  const multi = pages.length > 1;
  const billIds: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNo = i + 1;
    // Hash the PAGE, not the source file, so duplicate detection works per
    // receipt. The same receipt re-photographed inside a different PDF is
    // still caught.
    const pageSha = sha256(page.bytes);
    const label = pageLabel(safeName, pageNo, multi);

    const exact = DEDUPE.enabled
      ? await prisma.financeBill.findFirst({
        where: { fileSha256: pageSha, status: { not: "rejected" } },
        select: { id: true, filename: true, createdAt: true, status: true },
        orderBy: { id: "asc" },
      })
      : null;

    const created = await prisma.financeBill.create({
      data: {
        filename: label,
        sourceFile: safeName,
        pageNo,
        batchId,
        fileSha256: pageSha,
        // A duplicate page is stored without its text layer: it is never going
        // to be processed, and the column is the input to OCR, not evidence.
        textLayer: exact ? null : page.textLayer,
        person: person || null,
        pageCount: 1,
        status: exact
          ? "duplicate"
          // The handwriting hint bypasses OCR entirely rather than letting a
          // provider produce confident nonsense on it (ocr/types.ts).
          : opts.handwritten ? "manual_entry" : "queued",
        error: exact
          ? `Already uploaded as '${exact.filename}' on ` +
            `${exact.createdAt.toISOString().slice(0, 10)} (status: ${exact.status})`
          : null,
        createdBy: user,
        // new Uint8Array(...) rather than the Buffer directly: Prisma's Bytes
        // input is typed Uint8Array<ArrayBuffer>, and Node's Buffer is
        // Uint8Array<ArrayBufferLike>. Same bytes, no copy of consequence.
        image: { create: { mime: page.mime, bytes: new Uint8Array(page.bytes) } },
      },
      select: { id: true },
    });
    billIds.push(created.id);
  }

  return { batchId, billIds, rejected: [] };
}

async function insertErrorBill(
  filename: string, batchId: string, person: string, user: string,
  bytes: Uint8Array, error: string,
): Promise<number> {
  const row = await prisma.financeBill.create({
    data: {
      filename,
      sourceFile: filename,
      pageNo: 1,
      batchId,
      fileSha256: sha256(bytes),
      person: person || null,
      status: "error",
      error: error.slice(0, 500),
      createdBy: user,
    },
    select: { id: true },
  });
  return row.id;
}

function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const msg = err instanceof Error ? err.message : String(err);
  return `File could not be opened (${name}: ${msg}). Is it a valid PDF or image?`;
}

/**
 * One single-page PDF per page of the upload, plus each page's text layer.
 *
 * The page is kept as a PDF rather than rasterised, which is the single biggest
 * structural difference from the Python (which rendered every page to a PNG at
 * 200 DPI with PyMuPDF). There is no rasteriser here that does not drag in a
 * native canvas, and for the two things a page is actually used for it does not
 * matter: a text layer is read straight out of the PDF, and Claude reads PDF
 * bytes natively. The browser can display a one-page PDF too.
 */
async function splitPdfPages(bytes: Uint8Array): Promise<PageBlob[]> {
  // ignoreEncryption: a "protected" PDF from a supplier portal is usually only
  // owner-password protected (printing/copying flags), and refusing to read it
  // would be refusing a perfectly legible bill.
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const count = src.getPageCount();
  if (!count) return [];
  if (count > INGEST.maxPagesPerFile) {
    throw new Error(
      `This PDF has ${count} pages; the limit is ${INGEST.maxPagesPerFile} per upload. ` +
      "Split it and upload in parts.",
    );
  }

  const layers = await pdfTextLayers(bytes, count);
  const out: PageBlob[] = [];

  for (let i = 0; i < count; i++) {
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(src, [i]);
    doc.addPage(copied);

    // DETERMINISTIC BYTES, and this is load-bearing rather than tidy.
    // pdf-lib stamps CreationDate/ModDate/Producer on a new document, so the
    // same page split twice would produce different bytes, a different sha256,
    // and the exact-duplicate check at register would never fire for PDFs -
    // silently, and only for PDFs. Pinning the metadata makes the page hash a
    // function of the page content alone.
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    doc.setProducer("");
    doc.setCreator("");

    out.push({
      bytes: Buffer.from(await doc.save({ useObjectStreams: false })),
      mime: pageMimeFor("pdf"),
      textLayer: layers[i],
    });
  }
  return out;
}

/**
 * Embedded PDF text, per page. A digital invoice needs no OCR at all - it is
 * the publisher's own characters, which no OCR engine can improve on.
 *
 * pdfjs-dist is loaded from its LEGACY build (no top-level await, no modern
 * syntax the Vercel Node runtime might not parse) and with the worker
 * neutralised: pdf.js in Node disables the web worker and falls back to loading
 * the worker module by a RELATIVE path, which does not survive bundling. Giving
 * it `globalThis.pdfjsWorker` up front makes it use that instead and never
 * attempt the runtime import.
 *
 * Never throws: a PDF whose text cannot be walked simply has no text layer and
 * goes to OCR like any scan.
 */
async function pdfTextLayers(bytes: Uint8Array, count: number): Promise<Array<string | null>> {
  const empty: Array<string | null> = new Array(count).fill(null);
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      // A COPY. pdf.js takes ownership of the buffer it is given and may detach
      // it; the caller still needs these bytes for pdf-lib.
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
    });
    const doc = await task.promise;
    try {
      const out: Array<string | null> = [];
      for (let i = 1; i <= Math.min(count, doc.numPages); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
          text += item.str ?? "";
          text += item.hasEOL ? "\n" : " ";
        }
        out.push(usableTextLayer(text.replace(/[ \t]+\n/g, "\n").trim(), INGEST.textLayerMinChars));
      }
      while (out.length < count) out.push(null);
      return out;
    } finally {
      await task.destroy();
    }
  } catch (err) {
    // Same swallow that hid the fab PO failure for a week: a PDF whose text
    // layer cannot be read is ordinary (a scan), so returning `empty` is right
    // — the caller falls through to OCR. But the LOADER failing is not
    // ordinary, and silence here meant nobody could tell "this bill is a scan"
    // from "pdfjs will not start on this runtime, so every bill looks like a
    // scan". It costs one log line to keep those apart.
    console.error("[finance/pipeline] PDF text layer read failed:", err);
    return empty;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfjsModule = { getDocument: (opts: Record<string, unknown>) => any };

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  // Memoised per lambda instance: the module is a few megabytes to evaluate and
  // pdf.js resolves its fake-worker handler exactly once, on first use.
  pdfjsPromise ??= (async () => {
    // Optional, for the reason given in src/lib/fab/poPdf.ts. It matters more
    // here: a hard failure sends a perfectly readable bill down the OCR path
    // as though it were a scan, so letting pdf.js resolve its own worker is
    // the better of the two outcomes whenever this import is the thing broken.
    try {
      (globalThis as Record<string, unknown>).pdfjsWorker =
        await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } catch (err) {
      console.warn("[finance/pipeline] worker module unavailable, falling back to pdf.js's own:", err);
    }
    // Must run before the main module and not after it: pdf.mjs constructs a
    // DOMMatrix at module scope and the lambda has none to give it, for the
    // reason set out in src/lib/pdf/domMatrix.ts. Without this the import
    // below throws, and the catch at the bottom of pdfTextLayers() cannot tell
    // that apart from a bill with no text layer — every readable invoice would
    // go to OCR as though it were a scan.
    installPdfjsDomMatrix();
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  })().catch((err) => {
    // A rejection must not be what gets memoised — see the same guard in
    // src/lib/fab/poPdf.ts. Here it would be worse than a failed upload: a
    // bill whose text layer could not be read is indistinguishable from a
    // scanned one, so a single early failure would silently send every
    // later bill on that instance down the OCR path.
    pdfjsPromise = null;
    throw err;
  });
  return pdfjsPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Normalise a photographed bill: auto-rotate, bound the long edge, recompress.
 *
 *   rotate()   with no argument applies the EXIF orientation and clears it. A
 *              phone photo is almost always stored landscape with an
 *              orientation tag, and an OCR provider handed the raw pixels reads
 *              a sideways receipt.
 *   resize     to INGEST.maxEdgePx, never enlarging - the Python's target/max
 *              height, for the same reason: below it strokes are too thin to
 *              read, above it every pixel is upload time and provider cost.
 *   jpeg       because these bytes live in Postgres and are paid for on every
 *              backup. Quality 82 is visually identical to 95 on a receipt.
 *
 * failOn "none" keeps a slightly truncated phone JPEG usable. The alternative
 * is an error bill for a file a human can read perfectly well.
 */
async function normaliseImage(bytes: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bytes), { failOn: "none" })
    .rotate()
    .resize({
      width: INGEST.maxEdgePx,
      height: INGEST.maxEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: INGEST.jpegQuality })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Process one bill
// ---------------------------------------------------------------------------

/**
 * Read one registered page and take it as far as it can go on its own.
 *
 * Terminal outcomes: review (the normal one), approved (auto-approval),
 * manual_entry, needs_reupload, error. A bill left `queued` with a note is not
 * a failure - it means OCR belongs in the browser under this configuration and
 * the client-side endpoint will finish it.
 */
export async function processBill(billId: number): Promise<ProcessResult> {
  const bill = await prisma.financeBill.findUnique({
    where: { id: billId },
    include: { image: true },
  });
  if (!bill) throw new Error(`Bill ${billId} does not exist`);

  const result: ProcessResult = {
    billId, status: bill.status, messages: [], suggestions: [],
    duplicates: [], ocrConfidence: null, ocrVariant: "",
  };

  // This page already carries embedded text (a digital PDF, or a scanner set to
  // "searchable PDF"). Nothing to OCR - use it as-is at full confidence.
  if (bill.textLayer) {
    await prisma.financeBill.update({
      where: { id: billId },
      data: {
        ocrText: bill.textLayer,
        ocrConfidence: INGEST.textLayerConfidence,
        ocrVariant: "pdf_text_layer",
        ocrEngine: "pdf_text_layer",
        qualityVerdict: "ok",
        qualityJson: {
          verdict: "ok",
          reasons: [],
          note: "Text read directly from the PDF - no OCR needed",
        },
      },
    });
    result.ocrConfidence = INGEST.textLayerConfidence;
    result.ocrVariant = "pdf_text_layer";
    return afterOcr(bill.id, bill.person, bill.textLayer, splitLines(bill.textLayer),
      INGEST.textLayerConfidence, result);
  }

  if (!bill.image) {
    return setError(result, billId, "The page image is missing - re-upload this bill.");
  }

  const provider = serverProvider();
  if (!provider) {
    // Tesseract mode: the engine runs in the BROWSER, so a server function
    // cannot finish this bill. Leaving it queued is the correct state - the
    // client-side endpoint picks it up and posts the transcription back. The
    // note exists so a queued bill that nobody is polling is diagnosable
    // rather than mysterious.
    await prisma.financeBill.update({
      where: { id: billId },
      data: {
        status: "queued",
        error: "Waiting for browser OCR (OCR_PROVIDER=tesseract). Keep the bills tab open.",
      },
    });
    result.status = "queued";
    result.messages.push("Waiting for the browser to read this page.");
    return result;
  }

  const isPdfPage = bill.image.mime === "application/pdf";
  if (isPdfPage && !providerReadsPdf(provider)) {
    // Google Vision takes images only, and there is no rasteriser here to give
    // it one. Saying so plainly beats a confident empty transcription.
    return setStatus(result, billId, "needs_reupload",
      `This page is a PDF with no text layer, and the ${provider.name} reader cannot open PDFs. ` +
      "Upload a photo or screenshot of the page, or switch OCR_PROVIDER to claude.");
  }

  let ocr: OcrResult;
  try {
    ocr = await provider.run({
      data: new Uint8Array(bill.image.bytes),
      mimeType: bill.image.mime,
      // The handwriting hint routed the bill to manual_entry at register, so a
      // bill reaching here was never marked handwritten.
      handwritten: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void logEvent("error", `OCR failed on bill ${billId}: ${msg}`, billId);
    return setError(result, billId, `OCR failed: ${msg}`);
  }

  // The OcrResult contract is 0..1 (or null); ocr_confidence and every quality
  // threshold are percentages, as in the Python.
  const confidencePct = ocr.meanConfidence === null ? null : ocr.meanConfidence * 100;
  const wordCount = ocr.words.length || countWords(ocr.text);
  const report = ocrVerdict(ocr.text, confidencePct, wordCount, QUALITY);
  const variant = ocr.handwritingSuspected ? `${ocr.engine}/handwriting` : ocr.engine;

  // Persist the OCR output BEFORE branching on the verdict. In the Python this
  // once happened only on the failure paths, so bills that read successfully -
  // the common case - stored no text at all. That left the "What the OCR read"
  // panel blank and, worse, fed empty text to the token learner, so it never
  // learned anything from a good bill.
  await prisma.financeBill.update({
    where: { id: billId },
    data: {
      ocrText: ocr.text,
      ocrConfidence: confidencePct,
      ocrVariant: variant,
      ocrEngine: ocr.engine,
      qualityVerdict: report.verdict,
      qualityJson: {
        verdict: report.verdict,
        reasons: report.reasons,
        confidence: report.confidence,
        plausibility: report.plausibility,
        word_count: report.wordCount,
      },
    },
  });
  result.ocrConfidence = confidencePct;
  result.ocrVariant = variant;

  if (report.verdict === "handwritten") {
    return setStatus(result, billId, "manual_entry", report.reasons.join(" "));
  }
  if (report.verdict === "reupload") {
    const r = await setStatus(result, billId, "needs_reupload", report.reasons.join(" "));
    r.messages.push(...REUPLOAD_TIPS);
    return r;
  }

  return afterOcr(billId, bill.person, ocr.text, ocr.lines, confidencePct, result);
}

/** Claude reads PDF bytes through a document block; Google Vision cannot open
 *  a PDF at all through images:annotate. */
function providerReadsPdf(provider: OcrProvider): boolean {
  return provider.name === "claude";
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function setStatus(
  result: ProcessResult, billId: number, status: string, message?: string,
): Promise<ProcessResult> {
  await prisma.financeBill.update({
    where: { id: billId },
    data: { status, ...(message ? { error: message.slice(0, 500) } : {}) },
  });
  result.status = status;
  if (message) result.messages.push(message);
  return result;
}

async function setError(
  result: ProcessResult, billId: number, message: string,
): Promise<ProcessResult> {
  return setStatus(result, billId, "error", message);
}

// ---------------------------------------------------------------------------
// After OCR - extract, dedupe, classify, decide
// ---------------------------------------------------------------------------

async function afterOcr(
  billId: number,
  person: string | null,
  ocrText: string,
  lines: string[],
  confidencePct: number | null,
  result: ProcessResult,
): Promise<ProcessResult> {
  // extract() takes the OCR confidence as a percentage and derives every
  // field's base confidence from it. A provider that reports nothing gets the
  // Python's own default (60) rather than 0: 0 would floor every field at the
  // 0.30 clamp and make an otherwise perfect read look worthless.
  const ex = extract(ocrText, lines, confidencePct ?? 60.0);

  // ---- Layer 3: the duplicate check that actually matters ------------------
  const duplicates: Array<{ billId: number; score: number; why: string[] }> = [];
  if (DEDUPE.enabled) {
    const recent = await loadRecentBillFacts(billId);
    for (const hit of findDuplicates(
      {
        vendorGstin: ex.vendor_gstin.value,
        vendorName: ex.vendor_name.value,
        invoiceNo: ex.invoice_no.value,
        netAmount: ex.net_amount.value,
        invoiceDate: isoDate(ex.invoice_date.value),
      },
      recent,
    )) {
      duplicates.push({
        billId: hit.bill.billId,
        score: hit.verdict.score,
        why: hit.verdict.why,
      });
    }
    if (duplicates.length) {
      await prisma.financeDuplicate.createMany({
        data: duplicates.map((d) => ({
          billId,
          matchId: d.billId,
          kind: "field_match",
          detail: `${Math.round(d.score * 100)}% - ${d.why.join(", ")}`.slice(0, 500),
        })),
      });
    }
  }
  result.duplicates = duplicates.map((d) => d.billId);

  // ---- Classify ------------------------------------------------------------
  // Reduce the bill to purchase-meaning words before matching. Feeding the raw
  // OCR dump in compresses every score into single digits (classify.ts).
  const query = buildQueryText(ocrText, ex.vendor_name.value, ex.line_items);
  const { classifier } = await buildClassifier({
    vendorKey: vendorKey(ex.vendor_name.value, ex.vendor_gstin.value),
    person,
    // The scope must match what the classifier will actually look up:
    // Memory.tokenScores is called with the tokens of the QUERY text, not of
    // the raw OCR text.
    tokens: tokenise(query),
  });

  const suggestions = classifier.classify(query, ex.vendor_name.value, ex.vendor_gstin.value, {
    natureFilter: new Set(CLASSIFY.allowedNatures),
    topK: CLASSIFY.topK,
    person,
  });
  result.suggestions = suggestions;

  // ---- Anomaly sentinel ----------------------------------------------------
  // Computed BEFORE the extraction row is written, unlike the Python, which
  // inserted the row and then rewrote fields_json with the note. Same outcome
  // in one round trip instead of three: the person's history deliberately
  // excludes this bill either way, so the ordering cannot change the verdict.
  let anomaly = { anomalous: false, message: null as string | null };
  if (person && ex.net_amount.value) {
    const history = await loadPersonAmountHistory(person, billId);
    anomaly = anomalyVerdict(ex.net_amount.value, history, person, {
      factor: AGENT.anomalyFactor,
      minHistory: AGENT.anomalyMinHistory,
    });
    if (anomaly.anomalous && anomaly.message) {
      result.messages.push(anomaly.message);
      ex.notes.push(anomaly.message);
      void logEvent("anomaly", anomaly.message, billId);
    }
  }

  const top = suggestions[0];
  const extraction = await prisma.financeExtraction.create({
    data: {
      billId,
      vendorName: ex.vendor_name.value,
      vendorGstin: ex.vendor_gstin.value,
      invoiceNo: ex.invoice_no.value,
      invoiceDate: ex.invoice_date.value,
      taxableValue: ex.taxable_value.value,
      cgst: ex.cgst.value,
      sgst: ex.sgst.value,
      igst: ex.igst.value,
      roundOff: ex.round_off.value,
      netAmount: ex.net_amount.value,
      hsnSac: ex.hsn_sac.value,
      // Pre-filled for a confident suggestion, exactly as the Python. This is
      // a PROPOSED coding, not a confirmed one - `ledger_confirmed` in the list
      // projection is what tells them apart (see store.ts, which will not call
      // a suggestion confirmed until the bill is approved).
      ledger: top && (top.band === "high" || top.band === "medium") ? top.ledger : null,
      person,
      fieldsJson: JSON.parse(JSON.stringify(ex)),
      suggestionsJson: JSON.parse(JSON.stringify(suggestions)),
      confidence: overallConfidence(ex),
      arithmeticOk: ex.arithmetic_ok,
      createdBy: "system",
    },
    select: { id: true },
  });

  await prisma.financeBill.update({ where: { id: billId }, data: { status: "review" } });
  result.status = "review";

  // ---- Auto-approval -------------------------------------------------------
  // The agent moves the bill to 'approved' itself when the evidence is
  // overwhelming, so a trusted vendor's fifth identical claim needs zero clicks
  // before export. Every guard lives in pipelineRules.autoApprovalVerdict,
  // where it can be tested without a database. Posting to Tally still requires
  // a human: this only removes the confirm step.
  const verdict = autoApprovalVerdict({
    enabled: AGENT.autoApprove,
    person,
    band: top?.band ?? null,
    memoryCount: Math.trunc(Number(top?.signals.memory_count ?? 0)),
    memoryTrustCount: classifier.memoryTrustCount,
    netAmount: ex.net_amount.value,
    arithmeticOk: ex.arithmetic_ok,
    amountConfidence: ex.net_amount.confidence,
    duplicateCount: duplicates.length,
    anomalous: anomaly.anomalous,
    maxAmount: AGENT.autoApproveMaxAmount,
  });

  if (verdict.approve && top && person) {
    const amount = Number(ex.net_amount.value);
    await prisma.$transaction([
      prisma.financeExtraction.update({
        where: { id: extraction.id },
        data: { ledger: top.ledger, person },
      }),
      prisma.financeBill.update({
        where: { id: billId },
        data: { status: "approved", autoApproved: true },
      }),
    ]);
    const memCount = Math.trunc(Number(top.signals.memory_count ?? 0));
    result.status = "approved";
    result.messages.push(
      `Auto-approved: ${top.ledger} - this vendor has ${memCount} confirmed claims ` +
      "and every check passed.",
    );
    void logEvent(
      "auto_approve",
      `${person}: ${top.ledger} for ${amount.toFixed(2)} (vendor confirmed ${memCount}x)`,
      billId,
    );
    return result;
  }

  if (!hasValue(ex.net_amount)) {
    result.messages.push("Could not read the amount - please enter it.");
  }
  if (!top || top.band === "none") {
    result.messages.push(
      "No ledger matched confidently. Choose one, or request a new ledger.",
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface ProcessQueuedResult {
  processed: number[];
  /** Bills another poll had already claimed. Not an error - it is the guard
   *  doing its job. */
  skipped: number;
  failed: Array<{ billId: number; error: string }>;
  /** Queued bills still waiting after this run, so the caller knows to poll. */
  remaining: number;
}

/**
 * Work through queued bills, at most `max` per invocation.
 *
 * `max` exists because the Python's `while True` had a process that could take
 * as long as it liked; a serverless function has a wall clock. The browser
 * polls, so the loop is spread across invocations rather than run to
 * completion inside one.
 *
 * ATOMIC CLAIM. Several polls can be in flight at once - the batch view polls
 * every 1-2 seconds and a slow OCR call outlives the interval - and two of them
 * can SELECT the same queued bill before either updates it. The status guard in
 * the WHERE clause makes the claim exclusive: whoever's UPDATE lands first gets
 * a count of 1, everyone else gets 0 and moves on. Without this the same
 * receipt was OCR'd twice and got two extraction rows.
 *
 * A failure on one page must not stop the rest - a single unreadable receipt in
 * a stack of twenty should not cost the other nineteen.
 */
/**
 * Return bills orphaned in 'processing' to the queue.
 *
 * The claim in processQueued is atomic, and anything processBill throws is
 * caught and recorded. Neither helps when the invocation itself ends —
 * maxDuration reached, or the container recycled — because that leaves the row
 * in 'processing' with nothing anywhere looking at it again.
 *
 * Runs on every poll. When nothing is stale this is one indexed count-shaped
 * read against a status that holds at most a couple of rows.
 */
export async function reclaimStaleProcessing(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const stale = await prisma.financeBill.findMany({
    where: { status: "processing", updatedAt: { lt: cutoff } },
    select: { id: true, error: true },
  });

  let n = 0;
  for (const bill of stale) {
    const verdict = staleReclaim(bill.error);
    // Guarded by status again: a poll that started before this one may have
    // finished the bill in between, and a completed bill must not be dragged
    // back to the queue.
    const moved = await prisma.financeBill.updateMany({
      where: { id: bill.id, status: "processing" },
      data: verdict,
    });
    if (!moved.count) continue;
    n++;
    await logEvent(
      "error",
      `Bill ${bill.id} was left mid-read by an interrupted run; moved to '${verdict.status}'.`,
      bill.id,
    );
  }
  return n;
}

export async function processQueued(
  batchId?: string | null,
  max = 5,
): Promise<ProcessQueuedResult> {
  const out: ProcessQueuedResult = { processed: [], skipped: 0, failed: [], remaining: 0 };
  const where = { status: "queued", ...(batchId ? { batchId } : {}) };

  // Put back anything a dead invocation left mid-flight, BEFORE choosing work:
  // a bill orphaned in 'processing' is invisible to every query below and to
  // the review queue, and its batch never reports finished. See staleReclaim
  // in pipelineRules.ts for why it goes back to 'queued' the first time and to
  // 'manual_entry' the second.
  //
  // Deliberately NOT scoped to batchId. This is a repair pass, not part of the
  // batch's own work, and a stuck bill in a batch whose tab has been closed
  // would never be reached by a scoped one.
  await reclaimStaleProcessing();

  // Bills this call has already had a go at. Needed because a bill does not
  // always LEAVE the queue when it is processed: under OCR_PROVIDER=tesseract
  // processBill deliberately puts the page back to 'queued' for the browser to
  // read. Without this set, `findFirst ... orderBy id asc` returns that same
  // lowest-numbered page on every iteration, so the loop spends its whole
  // budget re-parking one bill and the ones behind it are never reached.
  //
  // That is not merely wasteful. A batch mixing an un-OCRable photo (id 1) with
  // a digital PDF whose text layer this function CAN read (id 2) would leave
  // bill 2 queued forever: every poll re-picks bill 1, and the browser driver
  // skips bill 2 because it is a PDF. Neither side would ever finish it.
  const tried = new Set<number>();

  for (let i = 0; i < max; i++) {
    const next = await prisma.financeBill.findFirst({
      where: tried.size ? { ...where, id: { notIn: [...tried] } } : where,
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!next) break;
    tried.add(next.id);

    const claimed = await prisma.financeBill.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "processing" },
    });
    if (claimed.count === 0) {
      out.skipped++;
      continue; // another poll got there first
    }

    try {
      await processBill(next.id);
      out.processed.push(next.id);
    } catch (err) {
      const msg = `${err instanceof Error ? err.name : "Error"}: ${
        err instanceof Error ? err.message : String(err)}`;
      out.failed.push({ billId: next.id, error: msg });
      // The bill is 'processing' at this point and would sit there forever; a
      // visible error is recoverable, a stuck row is not.
      await prisma.financeBill.update({
        where: { id: next.id },
        data: { status: "error", error: msg.slice(0, 500) },
      }).catch(() => undefined);
      void logEvent("error", `Processing failed on bill ${next.id}: ${msg}`, next.id);
    }
  }

  out.remaining = await prisma.financeBill.count({ where });
  return out;
}

/**
 * Progress for one upload batch - what API.md section 3 polls.
 *
 * `finished` is false while anything is still queued or processing, which is
 * what drives the per-page loader. A bill that ended in error or needs_reupload
 * counts as done: it will not change again on its own.
 */
export async function batchProgress(batchId: string): Promise<{
  total: number; done: number; finished: boolean;
}> {
  const [total, pending] = await Promise.all([
    prisma.financeBill.count({ where: { batchId } }),
    prisma.financeBill.count({ where: { batchId, status: { in: ["queued", "processing"] } } }),
  ]);
  return { total, done: total - pending, finished: pending === 0 };
}

// ---------------------------------------------------------------------------
// The browser-OCR handoff
// ---------------------------------------------------------------------------

export interface BrowserOcrInput {
  text: string;
  /** 0..1, the OcrResult contract. Null when the engine cannot score itself. */
  confidence?: number | null;
  /** Word count from the provider. Falls back to counting whitespace runs,
   *  which is what the Python did when Tesseract reported no word boxes. */
  words?: number | null;
  /** For the audit trail. The browser engine, not this server. */
  engine?: string | null;
}

/**
 * Finish a bill whose OCR ran in the browser.
 *
 * NOT IN api.py - it has no equivalent, because the Python owned Tesseract
 * itself. Here `OCR_PROVIDER=tesseract` means the engine is WASM in the
 * reviewer's tab: `processBill` cannot finish such a bill and deliberately
 * leaves it `queued` with a note. This is the other end of that handoff, and it
 * rejoins the shared path at `afterOcr` so a browser transcription is extracted,
 * deduped, classified and auto-approval-checked by exactly the same code as a
 * Claude one. Anything less and the two providers would drift.
 *
 * The transcription is NOT trusted to be about this bill beyond what the caller
 * says: the client sends text for a bill id, and the only defence against a
 * mismatched pairing is that the client fetched the image from the same id.
 * That is the same trust the upload itself carries, so it is not a new hole -
 * but it is why this refuses to touch a bill that has already moved on.
 */
export async function applyBrowserOcr(
  billId: number,
  input: BrowserOcrInput,
): Promise<ProcessResult> {
  const bill = await prisma.financeBill.findUnique({
    where: { id: billId },
    select: { id: true, person: true, status: true },
  });
  if (!bill) throw new Error(`Bill ${billId} does not exist`);

  const result: ProcessResult = {
    billId, status: bill.status, messages: [], suggestions: [],
    duplicates: [], ocrConfidence: null, ocrVariant: "",
  };

  const text = String(input.text ?? "");
  const confidencePct = input.confidence == null ? null : input.confidence * 100;
  const wordCount = input.words && input.words > 0 ? Math.trunc(input.words) : countWords(text);
  const report = ocrVerdict(text, confidencePct, wordCount, QUALITY);
  const engine = (input.engine || "tesseract-browser").slice(0, 60);

  await prisma.financeBill.update({
    where: { id: billId },
    data: {
      ocrText: text,
      ocrConfidence: confidencePct,
      ocrVariant: engine,
      ocrEngine: engine,
      qualityVerdict: report.verdict,
      qualityJson: {
        verdict: report.verdict,
        reasons: report.reasons,
        confidence: report.confidence,
        plausibility: report.plausibility,
        word_count: report.wordCount,
      },
      // The "Waiting for browser OCR" note has served its purpose. Leaving it
      // would show a reviewed bill as if it were still stuck.
      error: null,
    },
  });
  result.ocrConfidence = confidencePct;
  result.ocrVariant = engine;

  if (report.verdict === "handwritten") {
    return setStatus(result, billId, "manual_entry", report.reasons.join(" "));
  }
  if (report.verdict === "reupload") {
    const r = await setStatus(result, billId, "needs_reupload", report.reasons.join(" "));
    r.messages.push(...REUPLOAD_TIPS);
    return r;
  }

  return afterOcr(billId, bill.person, text, splitLines(text), confidencePct, result);
}

// ---------------------------------------------------------------------------
// Confirmation - pipeline.py:634
// ---------------------------------------------------------------------------

export interface ConfirmInput {
  billId: number;
  ledger: string;
  person: string;
  amount: number;
  /** ISO. Leaves the extracted date alone when absent. */
  date?: string | null;
  narration?: string;
  user: string;
}

export interface ConfirmResult {
  billId: number;
  status: "approved";
  ledger: string;
  person: string;
  amount: number;
  /** What the classifier had proposed, so the UI can say "corrected". */
  suggested: string | null;
  learnedFromCorrection: boolean;
}

/**
 * Save the clerk's decision, and learn from it.
 *
 * LEARNING HAPPENS HERE AND ONLY HERE - on confirmation, never on suggestion.
 * The system learns from what a human accepted or corrected, which is what
 * makes the tenth bill from a vendor land on the right ledger with nobody
 * choosing it. A classifier that learned from its own output would converge on
 * its first mistake.
 *
 * TWO DIVERGENCES FROM THE PYTHON, both deliberate:
 *
 * 1. An extraction row is CREATED when none exists. pipeline.py:658 ran
 *    `UPDATE extractions ... WHERE id = ?` with `row["id"] if row else None`,
 *    which matches nothing - so a bill that never produced an extraction (the
 *    handwritten hint routes straight to manual_entry, before OCR) was approved
 *    with no ledger, no person and no amount anywhere, and then silently
 *    skipped at export as "no ledger". The manual-entry path was a dead end.
 *    Here the confirmation writes the row it needs.
 *
 * 2. The learning step cannot fail the confirmation. The clerk's decision is
 *    the durable fact and it is already written; a lost memory increment
 *    degrades tomorrow's suggestion and is recorded in the agent journal, while
 *    a thrown error would show a failure for work that actually succeeded and
 *    invite a retry that double-counts.
 */
export async function confirmBill(input: ConfirmInput): Promise<ConfirmResult> {
  const { billId, user } = input;
  const ledger = input.ledger.trim();
  const person = input.person.trim();
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const narration = String(input.narration ?? "");
  const date = input.date ?? null;

  const [bill, ex] = await Promise.all([
    prisma.financeBill.findUnique({ where: { id: billId }, select: { ocrText: true } }),
    prisma.financeExtraction.findFirst({ where: { billId }, orderBy: { id: "desc" } }),
  ]);
  if (!bill) throw new Error(`Bill ${billId} does not exist`);

  const suggestions = ex && Array.isArray(ex.suggestionsJson)
    ? (ex.suggestionsJson as Array<{ ledger?: unknown }>)
    : [];
  const first = suggestions[0];
  const suggested = typeof first?.ledger === "string" ? first.ledger : null;

  // "Edited" means the human changed something the machine proposed. It feeds
  // /insights' confirm-rate, which is the only honest measure of whether the
  // classifier is earning its keep.
  const edited = Boolean(ex) && (suggested !== ledger || (ex?.netAmount ?? 0) !== amount);

  await prisma.$transaction(async (tx) => {
    if (ex) {
      await tx.financeExtraction.update({
        where: { id: ex.id },
        data: {
          ledger, person, narration,
          netAmount: amount,
          // COALESCE(?, invoice_date): a blank date field must not erase a date
          // the extractor read correctly.
          invoiceDate: date ?? ex.invoiceDate,
          editedByUser: edited,
        },
      });
    } else {
      await tx.financeExtraction.create({
        data: {
          billId, ledger, person, narration,
          netAmount: amount,
          invoiceDate: date,
          editedByUser: true,
          createdBy: user,
        },
      });
    }
    await tx.financeBill.update({ where: { id: billId }, data: { status: "approved" } });
  });

  const vkey = vendorKey(ex?.vendorName, ex?.vendorGstin);
  const ocrText = bill.ocrText ?? "";
  let learnedFromCorrection = false;
  try {
    // THE SCOPE MUST COME FROM THE OCR TEXT. `learn` walks the tokens of the
    // bill text, and loading the tokens of anything else (the query text, say)
    // would make commitMemory refuse the write - correctly, but only after the
    // work was done.
    const store = await loadMemory({ vendorKey: vkey, person, tokens: learningTokens(ocrText) });
    const before = snapshotMemory(store);
    new Memory(store).learn(vkey, ledger, ocrText, suggested, user, person);
    await commitMemory(before, store, { billId, person, user });
    learnedFromCorrection = Boolean(suggested && suggested !== ledger);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent("error", `Learning failed for bill ${billId} (approved anyway): ${msg}`, billId);
  }

  // AWAITED, unlike the fire-and-forget notes elsewhere in this file. This is
  // the "SHALMAN confirmed this at 14:32" line - the thing that makes the audit
  // trail an audit trail - and a serverless function can be frozen the instant
  // its response resolves, so a floating promise is a journal entry that
  // sometimes exists. logEvent never throws, so awaiting cannot fail the
  // confirmation it is recording.
  await logEvent(
    "confirm",
    `${user} confirmed bill ${billId}: ${ledger} for ${person}, ${amount.toFixed(2)}` +
    (learnedFromCorrection ? ` (corrected from ${suggested})` : ""),
    billId,
  );

  return { billId, status: "approved", ledger, person, amount, suggested, learnedFromCorrection };
}

/** Re-read a bill that has already been processed - after a re-upload, or once
 *  a better OCR provider is configured. A new extraction row is appended rather
 *  than replacing the old one, so what the engine read the first time stays on
 *  the record. */
export async function reprocess(billId: number): Promise<ProcessResult> {
  await prisma.financeBill.update({
    where: { id: billId },
    data: { status: "processing", error: null },
  });
  return processBill(billId);
}

export type { Extraction, Suggestion };
