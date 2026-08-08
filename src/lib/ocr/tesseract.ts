"use client";

// Tesseract, in the browser, via WebAssembly.
//
// This is the same engine automation/app/ocr/engine.py drives natively, so
// output quality is unchanged — but it needs no binary, no Python and no
// service, and the bill image never leaves the clerk's machine. That last part
// is the reason to prefer it: every other provider ships financial documents to
// a third party.
//
// Browser-only on purpose. Running WASM Tesseract inside a Vercel function
// means paying a multi-second cold start and loading ~15 MB of language data
// per invocation, against a 60-second ceiling, for a worse answer than the
// clerk's laptop gives for free.

import {
  assertCanRead, meanOf, toLines,
  type OcrInput, type OcrProvider, type OcrResult, type OcrWord,
} from "./types";

export class TesseractBrowserProvider implements OcrProvider {
  readonly name = "tesseract-wasm";
  /** It cannot. See the refusal in run(). */
  readonly readsHandwriting = false;

  async run(input: OcrInput): Promise<OcrResult> {
    // quality.py's finding, enforced rather than commented. The check runs
    // before the WASM engine is imported, so a refusal costs nothing.
    assertCanRead(this, input);

    // The worker API, not the one-shot Tesseract.recognize(): only the worker
    // takes an output-formats argument, and per-word confidence lives behind
    // `blocks: true`. Without it v7 returns page text and nothing to score.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const blob = new Blob([input.data as BlobPart], { type: input.mimeType });
      const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });

      // blocks -> paragraphs -> lines -> words. Confidences are 0..100 here and
      // 0..1 in the contract.
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const w of line.words ?? []) {
              words.push({
                text: w.text,
                confidence: typeof w.confidence === "number" ? w.confidence / 100 : null,
              });
            }
          }
        }
      }

      const text = data.text ?? "";
      return {
        text,
        words,
        lines: toLines(text),
        // Prefer the per-word mean; fall back to the page score when the engine
        // returned no word breakdown. Still null if neither exists - an
        // unscored bill must reach a human, not a default.
        meanConfidence: meanOf(words)
          ?? (typeof data.confidence === "number" ? data.confidence / 100 : null),
        engine: this.name,
      };
    } finally {
      // The worker holds a WASM instance and a web worker thread; leaking one
      // per bill would grind the tab to a halt over a long stack.
      await worker.terminate();
    }
  }
}
