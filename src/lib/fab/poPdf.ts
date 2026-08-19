// Getting the text runs out of a purchase-order PDF. The untestable half of
// the PO intake: bytes in, {text, x, y, width} runs per page out, straight into
// parsePoPieceTable() next door in poParser.ts.
//
// The split is the same one flatSheetParser / flatSheetWorkbook make. Every
// decision about what the document MEANS lives in poParser.ts, which imports
// nothing but flatSheetParser and is therefore reachable from `node --test`;
// this file holds the one thing that cannot be tested without a real PDF —
// reading it. Keep it that way.
//
// HOW pdfjs IS LOADED, AND WHY IT LOOKS LIKE THIS. Copied deliberately from
// src/lib/finance/pipeline.ts, which learned it the hard way:
//
//   * The LEGACY build. No top-level await and no modern syntax the Vercel Node
//     runtime might refuse to parse.
//   * globalThis.pdfjsWorker is set BEFORE getDocument is ever called. In Node
//     pdf.js disables the web worker and falls back to loading the worker module
//     by a RELATIVE path, which does not survive bundling; handing it the module
//     up front makes it use that and never attempt the runtime import.
//   * Memoised per lambda instance — the module is a few megabytes to evaluate
//     and pdf.js resolves its fake-worker handler exactly once, on first use.
//   * next.config.mjs already lists pdfjs-dist in serverExternalPackages for the
//     same reason; do not import it any other way.
//
// COORDINATES. pdf.js hands each run a transform matrix; e (index 4) is the left
// edge and f (index 5) is the BASELINE, measured UP from the bottom of the page.
// poParser groups runs into visual lines by that baseline and assigns them to
// columns by horizontal centre, so both numbers have to arrive unrounded and in
// the producer's own units (PDF points). Nothing here normalises them.

import { installPdfjsDomMatrix } from "@/lib/pdf/domMatrix";

import { parsePoPieceTable, type PoPage, type PoPieceTableResult, type PoTextItem } from "./poParser";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfjsModule = { getDocument: (opts: Record<string, unknown>) => any };

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    // THE WORKER IS AN OPTIMISATION, NOT A REQUIREMENT. Seeding it up front
    // stops pdf.js reaching for the worker module by a relative path that does
    // not survive bundling — but if this import is itself what fails, pdf.js
    // can still resolve its own fake worker, and refusing to read the PDF at
    // all would be choosing the worse outcome. Warn and carry on; only the
    // main module is load-bearing.
    try {
      (globalThis as Record<string, unknown>).pdfjsWorker =
        await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } catch (err) {
      console.warn("[fab/poPdf] worker module unavailable, falling back to pdf.js's own:", err);
    }
    // BEFORE THE MAIN MODULE, NOT AFTER. pdf.mjs constructs a DOMMatrix at
    // module scope, and in the lambda it has none to construct — the package
    // it would get one from is loaded through a runtime require the Next
    // tracer cannot see, so it is never shipped. See src/lib/pdf/domMatrix.ts;
    // without this the import below throws ReferenceError and no purchase
    // order can be read at all. The worker import above needs nothing.
    installPdfjsDomMatrix();
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  })().catch((err) => {
    // NEVER MEMOISE A REJECTION. `??=` keeps whatever the first call produced,
    // and a rejected promise is a permanent answer: every upload for the rest
    // of that lambda instance's life would fail with the first one's reason,
    // so "try again" could not succeed even after the cause had gone. Throw
    // the memo away and let the next upload load the module for itself.
    pdfjsPromise = null;
    throw err;
  });
  return pdfjsPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The one line about a loader failure worth putting in front of a person.
 *
 * "Tell IT" is not a fault report. A manager who can read back
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'pdfjs-dist'` has handed IT the
 * whole diagnosis; a manager who can only say "it said tell you" has handed
 * them a morning of guessing. The code (or class) and the first line of the
 * message are enough to name the cause and carry no stack and no paths.
 */
function describeLoadFailure(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" && e.code ? e.code
    : typeof e?.name === "string" && e.name ? e.name
    : "Error";
  const first = String(e?.message ?? err ?? "").split("\n")[0]!.trim();
  const text = first ? `${code}: ${first}` : code;
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

export interface PoPdfReadResult {
  pages: PoPage[];
  /**
   * Operator-readable, null when the read succeeded. Never a stack trace: the
   * manager can act on "this is not a PDF" and cannot act on
   * "InvalidPDFException: Invalid PDF structure".
   */
  error: string | null;
}

/** Enough of a text run to place it. Anything without a string `str` is a
 *  marked-content marker, not text, and is dropped. */
interface PdfTextItem {
  str?: unknown;
  width?: unknown;
  transform?: unknown;
}

function toNumberOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function itemsOf(content: { items?: unknown }): PoTextItem[] {
  const raw = Array.isArray(content?.items) ? (content.items as PdfTextItem[]) : [];
  const out: PoTextItem[] = [];
  for (const item of raw) {
    if (typeof item?.str !== "string") continue;       // marked-content marker
    if (item.str === "") continue;                     // no glyphs, no position worth keeping
    const t = Array.isArray(item.transform) ? (item.transform as unknown[]) : [];
    out.push({
      text: item.str,
      x: toNumberOr(t[4], 0),
      y: toNumberOr(t[5], 0),
      width: toNumberOr(item.width, 0),
    });
  }
  return out;
}

/**
 * Read every page's text runs out of a PDF.
 *
 * NEVER THROWS. A purchase order that cannot be opened is an ordinary thing for
 * a manager to have uploaded — the wrong file, a scan, a password-protected
 * copy — and the caller has to put a sentence on screen, not catch an exception
 * it will only stringify. A PDF that opens but carries no text at all comes back
 * as pages with empty `items`, which poParser refuses by name.
 */
export async function readPoPdfPages(bytes: Uint8Array): Promise<PoPdfReadResult> {
  let pdfjs: PdfjsModule;
  try {
    pdfjs = await loadPdfjs();
  } catch (err) {
    // SAY WHY, ON SCREEN. The first version of this told the manager to "tell
    // IT" and told IT nothing, and the cause then had to be guessed at from
    // the outside — which produced one wrong fix (a Node version that was
    // never the problem; the runtime was already 24.x) before anyone thought
    // to make the failure report itself. The reason goes both to the log, for
    // whoever can read it, and to the screen, for whoever cannot.
    console.error("[fab/poPdf] pdfjs failed to load:", err);
    return {
      pages: [],
      error: `The PDF reader could not be started on the server. Nothing was imported — tell IT: ${describeLoadFailure(err)}`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let task: any = null;
  try {
    task = pdfjs.getDocument({
      // A COPY. pdf.js takes ownership of the buffer it is given and may detach
      // it; the caller still holds these bytes.
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
    });
    const doc = await task.promise;
    const pages: PoPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push({ pageNumber: i, items: itemsOf(content) });
    }
    return { pages, error: null };
  } catch {
    return {
      pages: [],
      error:
        "That file could not be opened as a PDF. Upload the purchase order exactly as the customer sent it — " +
        "not a photograph of it, not a password-protected copy, and not a file renamed to .pdf.",
    };
  } finally {
    if (task) await task.destroy().catch(() => {});
  }
}

/* -- The whole upload, end to end ------------------------------------------- */

/** 10 MB, the same ceiling the Excel intake uses. A two-page purchase order is
 *  tens of kilobytes; anything near this is the wrong file. */
export const PO_PDF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * An uploaded file, read and parsed down to the piece table.
 *
 * Both the preview route and the confirm route call THIS, on the file the
 * manager hands them, and neither trusts anything the browser says about what
 * is in it — the confirm step re-uploads the PDF and re-parses it rather than
 * posting back the rows the preview showed. Rows that arrive as JSON from a
 * browser are rows a browser could have edited, and the whole point of the
 * totals-row reconciliation is that nobody edits the numbers between the
 * customer's document and the requirement rows.
 *
 * Never throws.
 */
export async function parsePoPdfUpload(file: File): Promise<PoPieceTableResult> {
  const refuse = (message: string): PoPieceTableResult => ({
    ok: false, rows: [], skippedZeroQtyRows: [],
    totals: { rowCount: 0, totalPieces: 0, totalSqft: 0, totalSqftRounded: 0 },
    stated: null, errors: [message], warnings: [],
  });

  if (file.size === 0) return refuse("That file is empty. Upload the purchase-order PDF.");
  if (file.size > PO_PDF_MAX_BYTES) {
    return refuse(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB — a purchase order is a few hundred kilobytes, so this is probably the wrong file.`);
  }
  // Browsers disagree about the type they put on a .pdf, and some send none at
  // all, so the name is checked too rather than instead.
  const looksPdf = file.type === "application/pdf"
    || file.type === "application/octet-stream"
    || file.type === ""
    || /\.pdf$/i.test(file.name ?? "");
  if (!looksPdf) return refuse("Only a PDF is accepted here. This is the customer's purchase order, exactly as they sent it.");

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return refuse("That file could not be read off the upload. Try again.");
  }

  const read = await readPoPdfPages(bytes);
  if (read.error) return refuse(read.error);
  return parsePoPieceTable(read.pages);
}
