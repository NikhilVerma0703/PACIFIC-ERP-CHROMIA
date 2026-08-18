// Pins src/lib/finance/pipelineRules.ts - the decisions the bill pipeline
// makes - to the behaviour of automation/app/pipeline.py, ocr/quality.py and
// api.py.
//
// These are the rules worth testing precisely because they are the ones that
// run with nobody watching: whether a page is split, whether a transcription is
// trusted, and whether a payable is approved without a human. The Prisma side
// of the pipeline is exercised by the routes; every rule below is pure and
// needs neither a database nor a bill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  amountTrusted, anomalyVerdict, autoApprovalVerdict, extensionOf, isoDate,
  ocrVerdict, pageLabel, pageMimeFor, sanitiseFilename, splitDecision,
  textPlausibility, usableTextLayer,
} from "../src/lib/finance/pipelineRules.ts";

const UPLOAD = {
  allowedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".heic"],
  maxUploadBytes: 25 * 1024 * 1024,
};

const QUALITY = {
  confReupload: 45.0, confPoor: 62.0,
  plausReupload: 0.40, plausPoor: 0.55, minWords: 8,
};

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

test("filename sanitisation strips paths, both separators", () => {
  // pipeline.py:146 - Path(...).name does not strip Windows separators on
  // Linux, which is the whole reason the explicit filter exists.
  assert.equal(sanitiseFilename("..\\..\\evil.pdf"), "evil.pdf");
  assert.equal(sanitiseFilename("../../../etc/passwd"), "passwd");
  assert.equal(sanitiseFilename("C:\\Users\\clerk\\Desktop\\bill.jpg"), "bill.jpg");
  assert.equal(sanitiseFilename("/var/tmp/scan (2).pdf"), "scan (2).pdf");
});

test("filename sanitisation neutralises markup and control characters", () => {
  assert.equal(sanitiseFilename("bill\n<script>.pdf"), "bill__script_.pdf");
  assert.equal(sanitiseFilename('re"ceipt.png'), "re_ceipt.png");
});

test("filename sanitisation keeps non-English names readable", () => {
  // Python's \w is Unicode-aware, so accents survive. An ASCII-only filter
  // would turn a Polish supplier's invoice into a row of underscores.
  assert.equal(sanitiseFilename("Fatura_café.pdf"), "Fatura_café.pdf");
});

test("filename sanitisation caps length and never returns empty", () => {
  const long = `${"a".repeat(300)}.pdf`;
  assert.equal(sanitiseFilename(long).length, 120);
  assert.equal(sanitiseFilename(""), "upload");
  assert.equal(sanitiseFilename(null), "upload");
  assert.equal(sanitiseFilename("///"), "upload");
});

test("page labels only mention a page number for multi-page uploads", () => {
  assert.equal(pageLabel("stack.pdf", 3, true), "stack.pdf - page 3");
  assert.equal(pageLabel("receipt.jpg", 1, false), "receipt.jpg");
});

// ---------------------------------------------------------------------------
// The page-split decision
// ---------------------------------------------------------------------------

test("a PDF is split, an image is one page, everything else is refused", () => {
  assert.equal(splitDecision("stack.PDF", 1024, UPLOAD).kind, "pdf");
  assert.equal(splitDecision("receipt.jpeg", 1024, UPLOAD).kind, "image");
  assert.equal(splitDecision("photo.HEIC", 1024, UPLOAD).kind, "image");

  const doc = splitDecision("expenses.docx", 1024, UPLOAD);
  assert.equal(doc.kind, "rejected");
  assert.match(doc.reason!, /not a bill/);

  const none = splitDecision("scan", 1024, UPLOAD);
  assert.equal(none.kind, "rejected");
});

test("empty and oversized uploads are refused with a reason a clerk can act on", () => {
  const empty = splitDecision("bill.pdf", 0, UPLOAD);
  assert.equal(empty.kind, "rejected");
  assert.match(empty.reason!, /empty/);

  const big = splitDecision("bill.pdf", 26 * 1024 * 1024, UPLOAD);
  assert.equal(big.kind, "rejected");
  assert.match(big.reason!, /larger than 25 MB/);
});

test("the split decision reads the SANITISED extension", () => {
  // Otherwise "invoice.pdf\u0000.exe" is judged on an extension the stored
  // filename does not have.
  assert.equal(extensionOf("../x/INVOICE.PdF"), ".pdf");
  assert.equal(extensionOf("no-extension"), "");
});

test("a page kept as PDF keeps its type; images become JPEG", () => {
  assert.equal(pageMimeFor("pdf"), "application/pdf");
  assert.equal(pageMimeFor("image"), "image/jpeg");
});

test("a short text layer is not a text layer", () => {
  // pipeline.py:235 - a scanner's one-line stamp must not masquerade as the
  // bill and skip OCR.
  assert.equal(usableTextLayer("Scanned by CamScanner", 80), null);
  assert.equal(usableTextLayer("", 80), null);
  assert.equal(usableTextLayer(null, 80), null);
  const real = "TAX INVOICE ".repeat(10);
  assert.equal(usableTextLayer(real, 80), real);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("dates normalise to ISO or to nothing at all", () => {
  assert.equal(isoDate("2026-07-30"), "2026-07-30");
  assert.equal(isoDate("30-07-2026"), "2026-07-30");
  assert.equal(isoDate("30/07/2026"), "2026-07-30");
  assert.equal(isoDate("2026/07/30"), "2026-07-30");
  assert.equal(isoDate("30-Jul-2026"), "2026-07-30");
  assert.equal(isoDate("30 Jul 2026"), "2026-07-30");
  // Python's %y pivot: 00-68 -> 2000s, 69-99 -> 1900s.
  assert.equal(isoDate("30-07-26"), "2026-07-30");
  assert.equal(isoDate("05-04-69"), "1969-04-05");
});

test("an impossible date is null, never a nearby guess", () => {
  // A wrong date is invisible in the UI; a missing one is obvious.
  assert.equal(isoDate("31-02-2026"), null);
  assert.equal(isoDate("2026-13-01"), null);
  assert.equal(isoDate("last tuesday"), null);
  assert.equal(isoDate(""), null);
  assert.equal(isoDate(null), null);
});

// ---------------------------------------------------------------------------
// The post-OCR quality gate
// ---------------------------------------------------------------------------

const GOOD_TEXT = "TOTAL AMOUNT 250.00 HOTEL SITARA GRAND INVOICE DATE 30-07-2026 CASH PAID";
const NOISE_TEXT = "xkq wvb zzt hgfd bcdf mnpq vwxz jklm rstv bcdg";

test("plausibility separates a real transcription from noise", () => {
  assert.ok(textPlausibility(GOOD_TEXT) > 0.9, "bill vocabulary and digits should score high");
  assert.equal(textPlausibility(NOISE_TEXT), 0);
  assert.equal(textPlausibility(""), 0);
});

test("a good read at a good confidence is ok", () => {
  const r = ocrVerdict(GOOD_TEXT, 88, 12, QUALITY);
  assert.equal(r.verdict, "ok");
  assert.deepEqual(r.reasons, []);
});

test("almost no text is a re-upload before anything else is judged", () => {
  const r = ocrVerdict("TOTAL 250", 95, 3, QUALITY);
  assert.equal(r.verdict, "reupload");
  assert.match(r.reasons[0], /almost no text/);
});

test("low confidence alone is 'poor', not a re-upload", () => {
  // quality.py:230 needs BOTH low confidence and low plausibility to demand a
  // new photograph - a legible bill read hesitantly is still a bill.
  const r = ocrVerdict(GOOD_TEXT, 20, 12, QUALITY);
  assert.equal(r.verdict, "poor");
});

test("low confidence AND unreadable output is a re-upload", () => {
  const r = ocrVerdict(NOISE_TEXT, 20, 10, QUALITY);
  assert.equal(r.verdict, "reupload");
  assert.match(r.reasons[0], /retake the photo/);
});

test("a provider that reports no confidence is judged on plausibility alone", () => {
  // The divergence that matters: Claude and Vision-without-word-scores report
  // null. Treating "unknown" as "fine" would send unreadable pages to a clerk
  // as if they had been read.
  const ok = ocrVerdict(GOOD_TEXT, null, 12, QUALITY);
  assert.equal(ok.verdict, "ok");
  assert.equal(ok.confidence, null);

  const bad = ocrVerdict(NOISE_TEXT, null, 10, QUALITY);
  assert.equal(bad.verdict, "reupload");
  // The message must not invent a confidence figure it does not have.
  assert.doesNotMatch(bad.reasons[0], /confidence/);
});

test("the clerk's handwriting checkbox short-circuits every other check", () => {
  const r = ocrVerdict(GOOD_TEXT, 95, 12, QUALITY, true);
  assert.equal(r.verdict, "handwritten");
});

// ---------------------------------------------------------------------------
// The anomaly sentinel
// ---------------------------------------------------------------------------

test("the sentinel refuses to judge anyone on thin history", () => {
  const r = anomalyVerdict(50_000, [100, 100, 100, 100], "VIJAY", { factor: 3, minHistory: 5 });
  assert.equal(r.anomalous, false);
  assert.equal(r.median, null);
});

test("the sentinel uses the UPPER median, as pipeline.py does", () => {
  // sorted[n // 2] on an even count. A different tie-break moves the threshold
  // exactly where the sentinel is most delicate - on small samples.
  const r = anomalyVerdict(100, [10, 10, 10, 100, 100, 100], "VIJAY", { factor: 3, minHistory: 5 });
  assert.equal(r.median, 100);
  assert.equal(r.anomalous, false);
});

test("a claim far above a person's median is flagged, with the arithmetic shown", () => {
  const r = anomalyVerdict(400, [100, 100, 100, 100, 100], "VIJAY", { factor: 3, minHistory: 5 });
  assert.equal(r.anomalous, true);
  assert.match(r.message!, /4\.0x VIJAY's median claim of 100\.00/);

  // Exactly at the factor is not above it.
  assert.equal(
    anomalyVerdict(300, [100, 100, 100, 100, 100], "VIJAY", { factor: 3, minHistory: 5 }).anomalous,
    false,
  );
});

// ---------------------------------------------------------------------------
// Auto-approval - the five guards
// ---------------------------------------------------------------------------

const APPROVABLE = {
  enabled: true,
  person: "VIJAY KIRAN GAUTARAJ",
  band: "high",
  memoryCount: 3,
  memoryTrustCount: 3,
  netAmount: 1200,
  arithmeticOk: true,
  amountConfidence: 0.5,
  duplicateCount: 0,
  anomalous: false,
  maxAmount: 5000,
};

test("every guard passing is the only way a bill approves itself", () => {
  const r = autoApprovalVerdict(APPROVABLE);
  assert.equal(r.approve, true);
  assert.deepEqual(r.blockedBy, []);
});

test("each guard blocks on its own, and says which one did", () => {
  const cases: Array<[Partial<typeof APPROVABLE>, RegExp]> = [
    [{ enabled: false }, /switched off/],
    [{ person: "" }, /no claimant/],
    [{ band: "medium" }, /not 'high'/],
    [{ band: null }, /no ledger suggestion/],
    [{ memoryCount: 2 }, /confirmed 2x, needs 3/],
    [{ arithmeticOk: false, amountConfidence: 0.5 }, /not arithmetically verified/],
    [{ duplicateCount: 1 }, /1 duplicate warning/],
    [{ netAmount: 5001 }, /above the 5000 ceiling/],
    [{ anomalous: true }, /anomaly sentinel/],
  ];
  for (const [override, expected] of cases) {
    const r = autoApprovalVerdict({ ...APPROVABLE, ...override });
    assert.equal(r.approve, false, `${JSON.stringify(override)} should block`);
    assert.ok(
      r.blockedBy.some((b) => expected.test(b)),
      `${JSON.stringify(override)} -> ${JSON.stringify(r.blockedBy)}`,
    );
  }
});

test("the ceiling is inclusive, matching the Python's <=", () => {
  assert.equal(autoApprovalVerdict({ ...APPROVABLE, netAmount: 5000 }).approve, true);
  assert.equal(autoApprovalVerdict({ ...APPROVABLE, netAmount: 5000.01 }).approve, false);
});

test("a missing amount can never be trusted, and neither can a zero", () => {
  // A zero on a reimbursement is a misread, not a free lunch someone is
  // claiming for.
  assert.equal(amountTrusted(0, true, 0.99), false);
  assert.equal(amountTrusted(null, true, 0.99), false);
  assert.equal(amountTrusted(250, false, 0.79), false);
  assert.equal(amountTrusted(250, false, 0.80), true);
  assert.equal(amountTrusted(250, true, 0.10), true);
  assert.equal(autoApprovalVerdict({ ...APPROVABLE, netAmount: null }).approve, false);
});

// ---------------------------------------------------------------------------
// Page splitting must produce byte-identical pages
// ---------------------------------------------------------------------------

test("splitting the same PDF twice yields identical page bytes", async () => {
  // Not a style point. The exact-duplicate check at register hashes the PAGE,
  // so if pdf-lib stamped a fresh CreationDate on every split the same receipt
  // would get a different sha256 each upload and layer 1 of duplicate
  // detection would silently never fire - for PDFs only. pipeline.ts pins the
  // metadata; this test is what stops someone removing those four lines.
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (const label of ["receipt one", "receipt two"]) {
    source.addPage([300, 200]).drawText(label, { x: 20, y: 100, size: 12, font });
  }
  const sourceBytes = await source.save();

  const splitOnce = async (index: number): Promise<string> => {
    const src = await PDFDocument.load(sourceBytes);
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(src, [index]);
    doc.addPage(copied);
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    doc.setProducer("");
    doc.setCreator("");
    const bytes = await doc.save({ useObjectStreams: false });
    return createHash("sha256").update(bytes).digest("hex");
  };

  assert.equal(await splitOnce(0), await splitOnce(0));
  assert.notEqual(await splitOnce(0), await splitOnce(1));
});
