// The decisions pipeline.ts makes, separated from the I/O that surrounds them.
//
// Everything in this file is PURE: same inputs, same answer, no Prisma, no
// fetch, no fs. That is not tidiness for its own sake - the auto-approval
// predicate decides whether a payable is booked with nobody looking at it, and
// a rule that can only be exercised by uploading a real bill to a real database
// is a rule that never gets tested. Here each one is a function call.
//
// It is also why this module imports NOTHING. `node --test` resolves ESM
// strictly, so a relative import without a .ts extension fails at runtime while
// adding the extension fights the Next build; every unit-tested module in this
// repo is self-contained for that reason (see the same note in classify.ts).
// Configuration is passed in as arguments rather than imported from config.ts.

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/**
 * Make an uploaded filename safe to store and display.
 *
 * Carried over from pipeline.py:146, and the reasoning is unchanged even though
 * nothing here touches a filesystem any more. Browsers normally send a bare
 * name, but nothing stops a crafted multipart request sending
 * "..\\..\\evil.pdf" - and Python's `Path(...).name` does not strip Windows
 * separators on Linux, which is what made the explicit character filter
 * necessary in the first place.
 *
 * On this side the value is written to a database column and rendered into
 * HTML, so the same filter is doing a different job: it keeps a filename from
 * carrying markup, control characters or a path that would look like one in the
 * UI. Cheap, and it removes a whole class of question.
 *
 * The Python's exact behaviour is reproduced: basename first, then everything
 * outside [word . - space ( )] becomes an underscore, then a 120-character cap,
 * and an empty result becomes "upload" rather than an empty string.
 */
export function sanitiseFilename(filename: string | null | undefined): string {
  const raw = String(filename ?? "");
  // Basename across BOTH separators - the upload may come from a Windows
  // browser while this runs on Linux, so splitting on the host's separator
  // alone is exactly the bug the Python comment warns about.
  const base = raw.split(/[\\/]/).pop() ?? "";
  // \w in Python's re (str, no re.ASCII) is Unicode-aware, so "Fatura_café.pdf"
  // keeps its accents. The u-flag class below matches that rather than ASCII
  // \w, which would mangle any non-English name into underscores.
  const cleaned = base.replace(/[^\p{L}\p{N}_.\- ()]/gu, "_").slice(0, 120);
  return cleaned || "upload";
}

/** "invoices.pdf - page 3" for a multi-page upload, plain name for a single. */
export function pageLabel(filename: string, pageNo: number, multiPage: boolean): string {
  return multiPage ? `${filename} - page ${pageNo}` : filename;
}

/** Lowercase extension including the dot, or "" when there is none. */
export function extensionOf(filename: string): string {
  const base = sanitiseFilename(filename);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// The page-split decision
// ---------------------------------------------------------------------------

export type SplitKind = "pdf" | "image" | "rejected";

export interface SplitDecision {
  kind: SplitKind;
  /** Populated for `rejected`; the message a clerk sees on the error bill. */
  reason?: string;
}

/**
 * What to do with an uploaded file, decided before a single byte is decoded.
 *
 * ONE PAGE = ONE BILL (pipeline.py:131). A stack of receipts scanned or
 * photographed into a single 11-page PDF is eleven separate claims, each with
 * its own vendor, amount and expense ledger. Treating the file as one bill -
 * and picking the "best" page out of it - produced a single garbled record that
 * matched none of the eleven receipts. So a PDF is split; an image is already
 * exactly one page and is taken as-is.
 *
 * Extension-based rather than content-sniffing, matching api.py's `_spool`: a
 * corrupt file must still become a visible error BILL a clerk can re-scan, not
 * a silent rejection, so only the type and the size are gates here.
 */
export function splitDecision(
  filename: string,
  byteLength: number,
  opts: { allowedExtensions: readonly string[]; maxUploadBytes: number },
): SplitDecision {
  const ext = extensionOf(filename);
  if (!opts.allowedExtensions.includes(ext)) {
    return {
      kind: "rejected",
      reason: `${ext || "That file"} is not a bill - upload a PDF or a photo.`,
    };
  }
  if (byteLength <= 0) {
    return { kind: "rejected", reason: "The file is empty." };
  }
  if (byteLength > opts.maxUploadBytes) {
    const mb = Math.round(opts.maxUploadBytes / (1024 * 1024));
    return { kind: "rejected", reason: `File is larger than ${mb} MB.` };
  }
  return { kind: ext === ".pdf" ? "pdf" : "image" };
}

/** A page kept as PDF keeps its type; everything else is recompressed to JPEG.
 *  A single-page PDF is NOT rasterised - see the note in pipeline.ts. */
export function pageMimeFor(kind: Exclude<SplitKind, "rejected">): string {
  return kind === "pdf" ? "application/pdf" : "image/jpeg";
}

/** A text layer only counts when there is enough of it to be the bill rather
 *  than a scanner's "Scanned by CamScanner" stamp. pipeline.py:235. */
export function usableTextLayer(
  text: string | null | undefined,
  minChars: number,
): string | null {
  const t = (text ?? "").trim();
  return t.length > minChars ? text! : null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => [number, number, number]]> = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  // Two-digit years: Python's %y maps 00-68 to 2000-2068 and 69-99 to
  // 1969-1999. Reproduced so a bill dated "05-04-69" lands where the Python
  // engine put it rather than 70 years away.
  [/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/, (m) => [+m[3] <= 68 ? 2000 + +m[3] : 1900 + +m[3], +m[2], +m[1]]],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Normalise whatever the extractor produced into ISO, or null. api.py:171.
 *
 * Dates read off a bill by OCR are the least trustworthy field in the system,
 * so anything unparseable becomes null rather than a guess. A missing date is
 * obvious in the UI; a wrong one is not.
 */
export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let parts: [number, number, number] | null = null;
  for (const [re, pick] of DATE_PATTERNS) {
    const m = re.exec(s);
    if (m) { parts = pick(m); break; }
  }
  if (!parts) {
    // "%d-%b-%Y" and "%d %b %Y": 30-Jul-2026, 30 Jul 2026.
    const m = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(s);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (mon) parts = [+m[3], mon, +m[1]];
    }
  }
  if (!parts) return null;

  const [y, mo, d] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject 31-Feb rather than letting Date roll it forward into March, which is
  // how a misread day silently becomes a plausible-looking wrong date.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The post-OCR quality gate - ported from automation/app/ocr/quality.py
//
// quality.py had two halves. The pre-OCR half measured blur, contrast and
// stroke-width variation on the pixels with OpenCV; none of that survives the
// port, because there is no cv2 here and no pure-JS Laplacian worth the bundle
// size. The post-OCR half is pure text and ports exactly, and it was always the
// half that made the decision - the module's own docstring says so.
//
// One branch is therefore missing: handwriting detection needed BOTH low
// plausibility AND high stroke-width variation to agree, and stroke variation
// is a pixel measurement. Rather than fire on plausibility alone - which the
// calibration notes explicitly warn flags badly-photographed printed bills -
// the automatic handwriting verdict is dropped. The upload form's "mostly
// handwritten" checkbox remains, and quality.py already called that "more
// reliable than any heuristic".
// ---------------------------------------------------------------------------

/** Vocabulary that appears on essentially every Indian commercial bill. Used to
 *  judge whether OCR output is real text or noise. */
export const BILL_VOCAB = new Set(`
total amount net gross sub subtotal gst cgst sgst igst utgst cess tax taxable
invoice bill no number date time qty quantity rate item items description
rs inr rupees cash card upi paid due balance change round off charges charge
service hotel restaurant fuel diesel petrol litre price value hsn sac gstin
phone mobile address thank you visit again please customer name table covers
discount advance received payment ref reference vendor supplier buyer seller
state code place supply reverse mode terms delivery order challan eway
`.split(/\s+/).filter(Boolean));

const TOKEN_RE = /[A-Za-z]{2,}|\d+[.,]?\d*/g;
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{4}/;

/**
 * Fraction of OCR tokens that look like real content rather than noise.
 *
 * Three ways a token counts as plausible:
 *   - it is a number (receipts are mostly numbers, and OCR reads digits well)
 *   - it is known bill vocabulary
 *   - it is word-shaped: has a vowel, no implausible consonant run
 *
 * A printed bill photographed badly still scores 0.45-0.70 because the digits
 * and the standard vocabulary survive. Genuine noise scores far lower because
 * almost nothing survives. On this side it does more work than it did in the
 * Python: a vision provider reports no per-word confidence at all, so for those
 * bills this is the ONLY evidence about whether the transcription is real.
 */
export function textPlausibility(text: string): number {
  const toks = String(text ?? "").toLowerCase().match(TOKEN_RE) ?? [];
  if (!toks.length) return 0.0;
  let good = 0;
  for (const t of toks) {
    const digits = t.replace(/[,.]/g, "");
    if (digits.length > 0 && /^\d+$/.test(digits)) good++;
    else if (BILL_VOCAB.has(t)) good++;
    else if (t.length >= 4 && /[aeiou]/.test(t) && !CONSONANT_RUN.test(t)) good++;
  }
  return good / toks.length;
}

export type QualityVerdict = "ok" | "poor" | "reupload" | "handwritten";

export interface QualityThresholds {
  confReupload: number;
  confPoor: number;
  plausReupload: number;
  plausPoor: number;
  minWords: number;
}

export interface QualityReport {
  verdict: QualityVerdict;
  reasons: string[];
  plausibility: number;
  /** 0-100, or null when the provider does not measure confidence. */
  confidence: number | null;
  wordCount: number;
}

/**
 * The post-OCR verdict. quality.py:199 `finalise`, minus the image signals.
 *
 * DIVERGENCE, and the important one: `confidence` may be null, which the Python
 * never had to handle because Tesseract always reports a number. A vision model
 * transcribing a receipt reports nothing (see ocr/types.ts, which refuses to
 * fabricate a score). Where the Python required confidence AND plausibility to
 * both be bad, a null confidence makes plausibility the sole judge at the same
 * thresholds - a transcription that is mostly nonsense is mostly nonsense
 * whether or not the model was willing to say so. The alternative, treating
 * "unknown" as "fine", would send unreadable pages to a clerk as if they had
 * been read.
 */
export function ocrVerdict(
  text: string,
  confidencePct: number | null,
  wordCount: number,
  t: QualityThresholds,
  userSaysHandwritten = false,
): QualityReport {
  const plaus = Math.round(textPlausibility(text) * 1000) / 1000;
  const base = {
    plausibility: plaus,
    confidence: confidencePct === null ? null : Math.round(confidencePct * 10) / 10,
    wordCount,
  };

  if (userSaysHandwritten) {
    return {
      ...base,
      verdict: "handwritten",
      reasons: ["Marked as handwritten at upload - sent to manual entry"],
    };
  }

  if (wordCount < t.minWords) {
    return { ...base, verdict: "reupload", reasons: ["OCR found almost no text on this page"] };
  }

  const confKnown = confidencePct !== null;
  const confBad = confKnown && confidencePct < t.confReupload;
  if ((confBad || !confKnown) && plaus < t.plausReupload) {
    return {
      ...base,
      verdict: "reupload",
      reasons: [
        confKnown
          ? `OCR confidence ${confidencePct.toFixed(0)}% and most of the output is unreadable - please retake the photo`
          : "Most of the output is unreadable - please retake the photo",
      ],
    };
  }

  if ((confKnown && confidencePct < t.confPoor) || plaus < t.plausPoor) {
    return {
      ...base,
      verdict: "poor",
      reasons: [
        confKnown
          ? `Partly readable (confidence ${confidencePct.toFixed(0)}%) - please check every field before submitting`
          : "Partly readable - please check every field before submitting",
      ],
    };
  }

  return { ...base, verdict: "ok", reasons: [] };
}

export const REUPLOAD_TIPS: readonly string[] = [
  "Lay the bill flat - smooth out folds and curl",
  "Place it on a dark, plain surface so the edges stand out",
  "Use bright, even light and avoid casting your own shadow",
  "Hold the phone directly above the bill, not at an angle",
  "Fill the frame with the bill and keep fingers off the text",
  "Tap the screen to focus before taking the photo",
];

// ---------------------------------------------------------------------------
// The anomaly sentinel
// ---------------------------------------------------------------------------

export interface AnomalyVerdict {
  anomalous: boolean;
  /** null when there was not enough history to judge. */
  median: number | null;
  /** Ready to show a human and to write into the extraction notes. */
  message: string | null;
}

/**
 * Is this claim far outside what this person normally claims?
 *
 * A person's own history is a baseline no rule-book can match. A claim far
 * above their median is not necessarily wrong - a hotel stay among fuel bills -
 * but it is exactly the bill a human should look at, so it is flagged and
 * excluded from auto-approval. Judgement only begins after `minHistory`
 * confirmed claims; two data points are not a pattern.
 *
 * `history` is the person's previous CONFIRMED claim amounts. The median is the
 * upper one for an even count (`sorted[n // 2]`), matching pipeline.py exactly -
 * a different tie-break would move the threshold on small samples, which is
 * precisely where the sentinel is most delicate.
 */
export function anomalyVerdict(
  amount: number | null | undefined,
  history: readonly number[],
  person: string,
  opts: { factor: number; minHistory: number },
): AnomalyVerdict {
  if (!amount || !person) return { anomalous: false, median: null, message: null };
  if (history.length < opts.minHistory) return { anomalous: false, median: null, message: null };

  const sorted = [...history].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0) || amount <= opts.factor * median) {
    return { anomalous: false, median, message: null };
  }
  const fmt = (n: number) => n.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return {
    anomalous: true,
    median,
    message:
      `Amount ${fmt(amount)} is ${(amount / median).toFixed(1)}x ${person}'s ` +
      `median claim of ${fmt(median)} - please check`,
  };
}

// ---------------------------------------------------------------------------
// Auto-approval
// ---------------------------------------------------------------------------

export interface AutoApprovalInput {
  /** agent.autoApprove. */
  enabled: boolean;
  /** The claimant. Auto-approval is impossible without one - the credit side of
   *  the voucher would have nowhere to go. */
  person: string | null | undefined;
  /** The top suggestion's band, or null when nothing was suggested. */
  band: string | null | undefined;
  /** signals.memory_count on the top suggestion: how many times this vendor has
   *  been confirmed to this ledger. */
  memoryCount: number;
  /** classify.memoryTrustCount. */
  memoryTrustCount: number;
  netAmount: number | null | undefined;
  /** taxable + taxes reconcile to the total. */
  arithmeticOk: boolean;
  /** 0..1 confidence on the amount field itself. */
  amountConfidence: number;
  duplicateCount: number;
  anomalous: boolean;
  maxAmount: number;
}

export interface AutoApprovalVerdict {
  approve: boolean;
  /** Every guard that failed, in the order they are checked. Written to the
   *  agent journal on the near-misses so "why was this NOT auto-approved?" is
   *  answerable, which is the question people actually ask. */
  blockedBy: string[];
}

/**
 * All five guards, from pipeline.py:473. Each exists because its absence would
 * let a specific mistake through:
 *
 *   trusted mapping  - one careless confirm must not create an autopilot
 *   high band        - a text-only guess is never certain enough
 *   amount trusted   - arithmetic-verified, or read at high confidence
 *   no duplicates    - a flagged twin needs eyes, full stop
 *   amount ceiling   - a misread 91,500 must never sail through
 *
 * Plus the two preconditions the Python checks in the same `if`: the feature is
 * on, and the sentinel did not flag the bill.
 *
 * This only removes the CONFIRM step. Nothing here posts to Tally - export is
 * an explicit, human-triggered batch operation, and that is the whole reason
 * this predicate is allowed to exist at all.
 */
export function autoApprovalVerdict(i: AutoApprovalInput): AutoApprovalVerdict {
  const blockedBy: string[] = [];
  if (!i.enabled) blockedBy.push("auto-approval is switched off");
  if (!i.person) blockedBy.push("no claimant on the bill");
  if (!i.band) blockedBy.push("no ledger suggestion");
  if (i.anomalous) blockedBy.push("flagged by the anomaly sentinel");
  if (i.band && i.band !== "high") blockedBy.push(`suggestion is '${i.band}', not 'high'`);
  if (i.memoryCount < i.memoryTrustCount) {
    blockedBy.push(
      `vendor mapping confirmed ${i.memoryCount}x, needs ${i.memoryTrustCount}`,
    );
  }
  if (!amountTrusted(i.netAmount, i.arithmeticOk, i.amountConfidence)) {
    blockedBy.push("amount not arithmetically verified or confidently read");
  }
  if (i.duplicateCount > 0) blockedBy.push(`${i.duplicateCount} duplicate warning(s)`);
  if (!(Number(i.netAmount ?? 0) <= i.maxAmount)) {
    blockedBy.push(`amount above the ${i.maxAmount} ceiling`);
  }
  return { approve: blockedBy.length === 0, blockedBy };
}

/**
 * An amount is trusted when the arithmetic proves it (taxable + taxes = total)
 * or the reader was very sure of it. 0.80 is the Python's threshold.
 *
 * Note the `Boolean(amount)` first term, ported as-is: a zero amount is not
 * trusted, because a zero on a reimbursement is always a misread rather than a
 * free lunch someone is claiming for.
 */
export function amountTrusted(
  amount: number | null | undefined,
  arithmeticOk: boolean,
  amountConfidence: number,
): boolean {
  return Boolean(amount) && (arithmeticOk || amountConfidence >= 0.80);
}
