"use client";

// Turn a PDF page into pixels, in the browser, so Tesseract can read it.
//
// WHY THIS EXISTS. OcrInput's contract says "PDFs must be rasterised before
// this point", and under OCR_PROVIDER=tesseract nothing was doing it: the
// browser loop fetched the stored page, saw application/pdf, and gave up with
// "set OCR_PROVIDER=claude, or re-upload them as photos". Both of those are
// things a clerk cannot do — one is an environment variable and the other is
// re-scanning a bill they already scanned — so a scanned PDF with no text layer
// was simply unreadable on the default configuration.
//
// It is done here rather than by switching provider on purpose. The reason
// tesseract is the default is written in tesseract.ts: it is free, needs no
// key, and the bill never leaves the clerk's machine, which for somebody's
// expense claim is the better answer and not merely the cheaper one. Sending
// the page to a hosted model to work around a missing rasteriser would trade
// that away for a problem the browser can solve itself — pdfjs-dist is already
// a dependency, used server-side to read text layers.

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfjsModule = { getDocument: (opts: Record<string, unknown>) => any };

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** The LEGACY build with the worker neutralised, exactly as pipeline.ts loads
 *  it server-side. The modern build wants to fetch its worker by URL, which
 *  needs bundler-specific asset handling and breaks differently in dev and on
 *  Vercel; the fake worker renders on the main thread instead. That is a real
 *  cost, but rendering one page is tens of milliseconds against the seconds
 *  Tesseract then spends on it, and it is the same pattern already proven in
 *  this repo. */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as Record<string, unknown>).pdfjsWorker = worker;
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  })();
  return pdfjsPromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Longest edge of a rasterised page. INGEST.maxEdgePx, restated rather than
 *  imported: config.ts is server configuration and pulling it into a client
 *  bundle drags the rest of the finance config with it. Kept in step by name. */
const MAX_EDGE_PX = 2200;

/** Pages beyond this are not rendered. A bill is one page; a stack that arrived
 *  as one PDF is split during ingest, so anything with many pages here is a
 *  misfiled document, and rendering all of it would lock the tab. */
const MAX_PAGES = 10;

export interface RasterPage {
  /** PNG bytes, ready for OcrInput.data. PNG not JPEG: this is going straight
   *  to OCR, where compression artefacts around thin strokes cost accuracy and
   *  the file is never stored. */
  data: Uint8Array;
  mimeType: "image/png";
  pageNumber: number;
}

/**
 * Render every page of a PDF to a PNG.
 *
 * Throws rather than returning empty when the document cannot be opened: the
 * caller distinguishes "this PDF is unreadable" from "this PDF has no pages",
 * and a silent empty array would look like the second.
 */
export async function rasterisePdf(bytes: Uint8Array): Promise<RasterPage[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // A COPY — pdf.js takes ownership of the buffer and may detach it.
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
  });
  const doc = await task.promise;
  try {
    const pages: RasterPage[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);

      // Scale so the LONG edge lands on MAX_EDGE_PX. A PDF's natural units are
      // 72 dpi, at which receipt text is far too thin for Tesseract; this is
      // the same target the server-side image path resizes to.
      const base = page.getViewport({ scale: 1 });
      const scale = MAX_EDGE_PX / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale: Math.max(1, scale) });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas to draw the PDF page on.");

      // A PDF page is transparent where nothing is drawn, and a transparent
      // PNG flattens to BLACK in some decoders — which hands Tesseract a black
      // rectangle. Paint the sheet white first.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // `canvas`, not `canvasContext`: in pdfjs 6 the context form is kept only
      // "for backwards compatibility" and the canvas is the documented one.
      await page.render({ canvas, viewport }).promise;

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      // Free the backing store immediately: ten 2200px canvases held at once is
      // ~200 MB, and the clerk's laptop is also running a WASM OCR engine.
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error("Could not turn the rendered PDF page into an image.");

      pages.push({
        data: new Uint8Array(await blob.arrayBuffer()),
        mimeType: "image/png",
        pageNumber: n,
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
