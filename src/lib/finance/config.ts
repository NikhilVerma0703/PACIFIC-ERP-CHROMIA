// Runtime configuration for the in-app finance engine.
//
// This is automation/config.yaml, minus the parts that only made sense for a
// long-lived Python process on the office PC (host/port, data_dir, the watch
// folder, the shared API key, the Tally HTTP gateway). What survives is every
// value that still DECIDES something: what Tally will accept, what the
// classifier weighs, when the agent is allowed to approve without a human.
//
// The comments are carried over from config.yaml deliberately. Each number here
// exists because a specific mistake happened without it, and a bare constant
// with no reason attached is a number the next person will "clean up".
//
// WHY CONSTANTS RATHER THAN A TABLE OR A YAML FILE
// ------------------------------------------------
// The Python read config.yaml at startup because it ran as a service someone
// could restart. On Vercel there is no such moment: every request is a cold
// module load, so a file read would be per-invocation I/O for values that
// change once a year. These are typed constants, which also means a typo in a
// weight name is a compile error rather than a silently-ignored key - which is
// exactly the bug config.yaml had (weights were duplicated in code and in the
// file, so tuning the file changed nothing).
//
// Env overrides exist ONLY where an operator needs to change behaviour without
// a deploy: the two autonomy switches, the duplicate master switch, and the
// Tally company string (which differs between the live company and a test one).
// Everything else is a code change on purpose - a reviewable diff.

/** `true`/`1`/`yes`/`on` (case-insensitive) enable; `false`/`0`/`no`/`off`
 *  disable; anything else (including unset) leaves the default alone. */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  // A malformed override must not silently become NaN and disable a ceiling:
  // `amount <= NaN` is false, which would block every auto-approval, but the
  // same pattern elsewhere (`amount > NaN`) would let everything through.
  return Number.isFinite(n) ? n : fallback;
}

/** Guarded so a client component importing a band threshold does not explode:
 *  Next inlines `process.env.X` in browser bundles but `process` itself may be
 *  absent depending on the runtime. */
function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

// ---------------------------------------------------------------------------
// Tally identity
// ---------------------------------------------------------------------------

export const TALLY = {
  // Must match the company name in Tally EXACTLY, including the suffixes Tally
  // appends. Taken verbatim from data/SAMPLE_VOUCHER.xml - Tally matches this
  // string literally, so an import fails outright on "no company" if a single
  // character differs. Copy it from the Tally title bar if that ever happens.
  company: readEnv("FINANCE_TALLY_COMPANY")
    ?? "Pacific Engineered Surfaces Pvt Ltd- FAB - (from 1-Apr-21) - (from 1-Apr-22) - (from 1-Apr-23)",

  // GST identity, verified from the voucher export. Stamped on each voucher so
  // an imported entry behaves exactly like one typed by hand.
  companyGstin: readEnv("FINANCE_COMPANY_GSTIN") ?? "33AALCP2750N1Z3",
  gstRegistration: "Tamil Nadu Registration",
  gstState: "Tamil Nadu",

  // Journal: Dr expense / Cr person. Books the payable; the existing payment
  //          run settles it later against the bank. This is how PESPL already
  //          handles reimbursements.
  // Payment: Dr expense / Cr cashLedger. Only if reimbursing immediately.
  voucherType: "Journal",
  cashLedger: "Cash", // only used when voucherType is Payment

  // BATCH EXPORT voucher type. DELIBERATELY Tally's standard "Journal", not a
  // custom type: reimbursements today and payments later both use the voucher
  // type PESPL already uses, so nothing new appears in the chart of accounts
  // and nobody has to learn a house convention.
  //
  // The trade-off, stated plainly: a custom type could carry
  // PREVENTDUPLICATE=Yes, which makes Tally itself REJECT a second import of
  // the same file. On the standard Journal it cannot, and Tally will happily
  // create duplicates - proven on live data, where five imports of one test
  // file produced ten vouchers without a complaint.
  //
  // So duplicate control lives ENTIRELY on our side. Two layers, both required:
  //   1. DEDUPE.enabled below - stops the same BILL being claimed twice.
  //   2. the export guard - a bill exported once is marked and re-exporting it
  //      warns loudly. See exportBatch.ts.
  batchVoucherType: "Journal",
  createVoucherType: false,
  voucherTypeParent: "Journal",

  // Later, when reimbursements are paid rather than accrued, this becomes the
  // voucher type for the payment run. Tally's standard "Payment", same reason.
  paymentVoucherType: "Payment",

  // Voucher number format: <prefix>/<FY>/<bill id>, e.g. REIMB/26-27/00042.
  // The bill id makes every Tally line traceable back to the scanned image.
  voucherNoPrefix: "REIMB",

  // Tally group holding the staff who can be reimbursed. VERIFIED from the All
  // Masters export: VIJAY KIRAN GAUTARAJ and 334 other staff/claimant ledgers
  // sit under this group, NOT plain "Sundry Creditors" (33 names, mostly trade
  // creditors).
  //
  // DIVERGENCE from config.yaml: the 233-name `people:` allowlist is NOT ported.
  // The claimant list now comes from FinanceLedger rows with isPerson = true,
  // which the MASTER.xml import populates - one source of truth instead of a
  // list in a tracked file that drifts from Tally.
  peopleGroup: "SUNDRY CRS FOR SUNDRY EXPENSES",

  // Groups that brand-new masters are created under in the batch export.
  // Both verified to exist in the chart of accounts.
  newLedgerParent: "ADMINISTRATION EXPENSES", // new expense heads
  newPersonParent: "SUNDRY CRS FOR SUNDRY EXPENSES", // new claimants
} as const;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const CLASSIFY = {
  // Read by LedgerClassifier - changing them here changes behaviour.
  weights: {
    memory: 0.42, // vendor -> ledger history. Highest because it is fact, not guess.
    person: 0.14, // which ledgers THIS claimant's bills go to. Known before the
                  // bill is even read. Kept low on purpose: a person's habit
                  // should narrow the field, never override the bill.
    fuzzy: 0.18,  // token-set ratio
    tfidf: 0.16,  // word-level TF-IDF cosine
    ngram: 0.10,  // char 3-5 gram cosine, the OCR-noise backstop
  },
  bands: {
    high: 0.85,   // pre-filled, one-click confirm
    medium: 0.60, // pre-filled, alternatives shown
    low: 0.35,    // nothing pre-filled, clerk must choose
  },
  topK: 5,

  // Confirmations of the same vendor -> ledger pair before memory
  // short-circuits. One confirmation could be a clerk clicking through
  // carelessly; three is a pattern.
  memoryTrustCount: 3,

  // A correction multiplies the old mapping's weight by this. Without decay a
  // wrong mapping learned early competes forever. (Memory.DECAY in classify.ts
  // holds the same number; this is the documented source of it.)
  correctionDecay: 0.55,

  // Ledger natures a reimbursement may be coded to. "asset" is here so a
  // capital purchase can be coded properly - a laptop is Computers &
  // Peripherals, not an expense head.
  allowedNatures: ["expense", "asset"] as readonly string[],

  // ...but "asset" also means CURRENT assets, and PESPL's are 284 customer
  // ledgers, 49 bank deposits and 9 bank accounts. None of those is something a
  // bill is ever coded to, and offering them made the picker open on
  // "4M MARBLE PRIVATE LIMITED" while the classifier scored every food bill
  // against 284 debtors. Excluded by ROOT group - Tally's 28 primary groups are
  // fixed names, so this keeps working if sub-groups are renamed.
  excludedRootGroups: ["Current Assets"] as readonly string[],
} as const;

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export const DEDUPE = {
  // MASTER SWITCH.
  // false = every duplicate check is skipped, so the same file can be uploaded
  //         over and over. Useful while tuning OCR; the UI shows a banner so
  //         nobody forgets it is off.
  //
  // ON as of the ERP rollout. Expect false positives in the first week: a
  // person who eats at the same canteen for the same amount two days running
  // trips the business-key check. That is the correct trade - the reviewer
  // overrides with a reason, which is recorded, whereas a missed duplicate is
  // money out the door that nobody notices.
  //
  // Overridable by env because it is the one setting an operator may need to
  // flip mid-incident (a bad MASTER import flagging everything) without waiting
  // for a deploy.
  enabled: envFlag("FINANCE_DEDUPE", true),

  businessKeyThreshold: 0.72, // mirrors dedupe.ts FLAG_THRESHOLD
  phashMaxDistance: 8,        // layer 2; not ported to the web engine, see below
  amountTolerance: 1.0,
  dateToleranceDays: 1,

  /**
   * How many recent extractions the business-key check scores a new bill
   * against. The Python queried SQLite with no bound because the whole database
   * was local; here every row crosses the network from Neon, so the window is
   * explicit. 400 covers roughly a quarter of PESPL's reimbursement volume,
   * which is far beyond the days-to-weeks window in which a genuine double
   * claim is ever filed.
   */
  recentWindow: 400,
} as const;

// ---------------------------------------------------------------------------
// The autonomous parts
// ---------------------------------------------------------------------------

export const AGENT = {
  // AUTO-APPROVAL. Skip the confirm click - but only when every guard passes:
  //   - the vendor->ledger mapping is trusted (memoryTrustCount confirms)
  //   - the suggestion is in the "high" band
  //   - the amount was read confidently (or verified by arithmetic)
  //   - no duplicate warnings
  //   - amount <= autoApproveMaxAmount
  // Auto-approved bills are marked, listed, and still editable before posting.
  // Posting to Tally always remains a human action.
  //
  // Env-overridable: this is the switch you want to be able to pull in one
  // minute if the classifier starts being confidently wrong.
  autoApprove: envFlag("FINANCE_AUTO_APPROVE", true),
  autoApproveMaxAmount: envNumber("FINANCE_AUTO_APPROVE_MAX", 5000),

  // ANOMALY SENTINEL. A claim more than anomalyFactor x this person's median
  // confirmed claim is flagged for a human and never auto-approved. Needs at
  // least anomalyMinHistory confirmed claims before it judges anyone - two data
  // points are not a pattern.
  anomalyFactor: 3.0,
  anomalyMinHistory: 5,
  /** How far back the sentinel looks. The Python's LIMIT 60. */
  anomalyHistoryLimit: 60,

  // NOT PORTED, and deliberately so:
  //   auto_post_file_mode - the Python wrote Tally XML for auto-approved bills
  //     by itself, which was safe there because "file mode" meant an accountant
  //     still had to import the file. Here export is a batch operation a human
  //     starts from the UI, so there is no equivalent hands-free path and
  //     nothing writes a voucher without a click.
  //   watch_enabled / watch_dir / poll_seconds - a watch folder needs a
  //     long-lived process and a disk. Uploads arrive over HTTP instead.
  //   rescue_pass, variant_autotune, autotune_* , explore_every - all
  //     Tesseract preprocessing concerns. The cloud providers do their own.
  //   maintenance_minutes - no daemon to run maintenance on.
} as const;

// ---------------------------------------------------------------------------
// Quality gates
//
// The Python measured blur, contrast and brightness on the image itself with
// OpenCV before OCR, then re-judged on the OCR output. Only the POST-OCR half
// is meaningful here: the pre-OCR half needed cv2 (no pure-JS equivalent worth
// the bundle), and the vision providers already refuse or flag what they cannot
// read. The image-side numbers are kept for reference - if a Laplacian-variance
// check is ever added in sharp, these are the calibrated thresholds to use.
// ---------------------------------------------------------------------------

export const QUALITY = {
  // Pre-OCR image checks. Loose on purpose - real filtering happens after OCR,
  // where the evidence is much stronger. NOT currently evaluated; see above.
  blurMin: 18.0,
  contrastMin: 12.0,
  brightnessMin: 30.0,
  brightnessMax: 248.0,
  minWidth: 450,
  minHeight: 450,

  // Post-OCR checks. Confidences are PERCENTAGES (0-100) to match the Python
  // and the `ocr_confidence` column; the OcrResult contract is 0-1, so the
  // pipeline scales before comparing.
  confReupload: 45.0,
  confPoor: 62.0,
  plausReupload: 0.40,
  plausPoor: 0.55,
  minWords: 8,

  // Handwriting needs BOTH signals to trip. Measured on real bills: stroke
  // variation alone cannot separate handwriting from a badly photographed
  // printed receipt.
  hwStrokeVariation: 1.00,
  hwPlausibility: 0.30,
} as const;

// ---------------------------------------------------------------------------
// Ingest - the values the Python kept under `ocr:` that still apply
// ---------------------------------------------------------------------------

export const INGEST = {
  /** Longest edge fed to a provider. The Python's ocr.target_height (2200) for
   *  the same reason: below this, text strokes are too thin to read; above it,
   *  every extra pixel is upload time and provider cost for no accuracy. */
  maxEdgePx: 2200,

  /** JPEG quality for the stored page. 82 is the knee of the curve - visually
   *  indistinguishable from 95 on a receipt, roughly a third of the bytes, and
   *  those bytes sit in Postgres where they are paid for on every backup. */
  jpegQuality: 82,

  /** A PDF page whose embedded text is at least this long is trusted as the
   *  transcription and never sent to OCR. The Python's threshold (80 chars):
   *  short enough to catch a small receipt, long enough that a scanner's
   *  one-line "Scanned by ..." stamp does not masquerade as a text layer. */
  textLayerMinChars: 80,

  /** Confidence recorded for a PDF text layer. Not a measurement - it is the
   *  publisher's own characters, so there is no OCR error to estimate. */
  textLayerConfidence: 99.0,

  /** Extension allowlist rather than magic-byte sniffing, on purpose: a corrupt
   *  or unreadable file must still become a visible ERROR bill a clerk can
   *  re-scan, not a silent rejection. */
  allowedExtensions: [
    ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".heic",
  ] as readonly string[],

  /** 25 MB. A phone photo is ~5 MB; without a cap one mistaken 4 GB upload
   *  fills the request budget and the row it would write is unusable anyway. */
  maxUploadBytes: 25 * 1024 * 1024,

  /** Hard cap on pages per uploaded PDF. The Python had none because it had a
   *  background thread and a disk; a serverless function has neither, and a
   *  300-page PDF would time out halfway and leave a half-registered batch.
   *  Refusing it up front is a message a clerk can act on. */
  maxPagesPerFile: 60,
} as const;

/** Everything above, as one object, for callers that want to pass the whole
 *  config around (and for parity with the Python's single `cfg` dict). */
export const FINANCE_CONFIG = {
  tally: TALLY,
  classify: CLASSIFY,
  dedupe: DEDUPE,
  agent: AGENT,
  quality: QUALITY,
  ingest: INGEST,
} as const;

export type FinanceConfig = typeof FINANCE_CONFIG;
