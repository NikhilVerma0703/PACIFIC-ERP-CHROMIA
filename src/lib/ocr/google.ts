import "server-only";

// Google Cloud Vision — the free-tier alternative that reads handwriting.
//
// DOCUMENT_TEXT_DETECTION is the dense-document model, not the sparse
// scene-text one, and it is the variant that handles handwritten receipts.
// Free monthly quota at the time of writing; confirm the current limit before
// relying on it, because it is Google's to change and not ours.
//
// Uses a plain API key (GOOGLE_VISION_API_KEY) rather than a service account:
// one env var, no key file to mount, and the call is server-side so the key
// never reaches the browser.

import {
  meanOf, toLines, type OcrInput, type OcrProvider, type OcrResult, type OcrWord,
} from "./types";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

export class GoogleVisionProvider implements OcrProvider {
  readonly name = "google-vision";
  readonly readsHandwriting = true;

  async run(input: OcrInput): Promise<OcrResult> {
    const key = process.env.GOOGLE_VISION_API_KEY;
    if (!key) throw new Error("GOOGLE_VISION_API_KEY is not set — cannot use the Google Vision provider.");

    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: Buffer.from(input.data).toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Google Vision failed (HTTP ${res.status}). ${detail.slice(0, 300)}`);
    }

    const json = await res.json();
    // Vision reports per-request errors inside a 200 body, so the HTTP status
    // alone does not tell you the call worked.
    const err = json?.responses?.[0]?.error;
    if (err) throw new Error(`Google Vision error: ${err.message ?? JSON.stringify(err).slice(0, 200)}`);

    const ann = json?.responses?.[0]?.fullTextAnnotation;
    const text: string = ann?.text ?? "";

    // Confidence lives per-word deep in the page/block/paragraph tree.
    const words: OcrWord[] = [];
    for (const page of ann?.pages ?? []) {
      for (const block of page.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const w of para.words ?? []) {
            const symbols = (w.symbols ?? []).map((s: { text?: string }) => s.text ?? "").join("");
            words.push({
              text: symbols,
              confidence: typeof w.confidence === "number" ? w.confidence : null,
            });
          }
        }
      }
    }

    return {
      text,
      words,
      lines: toLines(text),
      meanConfidence: meanOf(words),
      engine: this.name,
    };
  }
}
