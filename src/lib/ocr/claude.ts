import "server-only";

// Claude as the OCR provider — the alternative that reads handwriting.
//
// Uses ANTHROPIC_API_KEY, already configured for the Telegram /ask bot, so this
// adds no new account and no new secret. Costs pennies per bill rather than
// nothing, which is the trade against Tesseract.
//
// Server-side only: the key must never reach browser JavaScript, the same rule
// the finance proxy follows.

import {
  toLines, type OcrInput, type OcrProvider, type OcrResult,
} from "./types";

const MODEL = process.env.OCR_CLAUDE_MODEL ?? "claude-opus-5";

const PROMPT =
  "Transcribe this bill or receipt exactly as printed or written. " +
  "Preserve line breaks and the reading order. Output ONLY the transcription " +
  "— no preamble, no commentary, no markdown fences. If part of it is " +
  "illegible, write [illegible] in place of that part rather than guessing a " +
  "number: a wrong figure on a reimbursement is worse than a gap a human fills in.";

export class ClaudeOcrProvider implements OcrProvider {
  readonly name = "claude";
  readonly readsHandwriting = true;

  async run(input: OcrInput): Promise<OcrResult> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set — cannot use the Claude OCR provider.");

    const b64 = Buffer.from(input.data).toString("base64");

    // A single-page PDF is sent AS a PDF, not as an image.
    //
    // types.ts says "PDFs must be rasterised before this point", and that is
    // still true of every other provider — but there is nothing on Vercel to
    // rasterise with. Rendering a PDF page to pixels needs a canvas, which
    // means a native module, which is exactly what the in-app port exists to
    // avoid. Claude reads PDF bytes natively through a `document` block, so the
    // page goes over as-is, text layer and all. Google Vision cannot, and the
    // pipeline routes those pages to needs_reupload rather than pretending.
    const isPdf = input.mimeType === "application/pdf";
    const source = { type: "base64", media_type: input.mimeType, data: b64 };
    const attachment = isPdf
      ? { type: "document", source }
      : { type: "image", source };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        // Transcription is not a reasoning task; thinking would add latency and
        // tokens for no gain. Disabled explicitly — on Claude Opus 5 thinking is
        // ON by default, so omitting this would silently enable it. Accepted at
        // effort "high" or below; pairing disabled thinking with xhigh/max is a 400.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{
          role: "user",
          content: [
            attachment,
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Claude OCR failed (HTTP ${res.status}). ${detail.slice(0, 300)}`);
    }

    const json = await res.json();

    // A safety decline is a 200 with stop_reason "refusal" and empty content.
    // Reading content[0] without checking would throw on an unrelated line and
    // send someone hunting the wrong bug.
    if (json?.stop_reason === "refusal") {
      throw new Error("Claude declined to transcribe this image. Use manual entry for this bill.");
    }

    const text: string = (json?.content ?? [])
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("")
      .trim();

    return {
      text,
      // The API returns no per-token confidence, so there is nothing honest to
      // put here. Null keeps the bill in the human-review queue instead of
      // fabricating a score that would auto-approve it. See types.ts.
      words: [],
      lines: toLines(text),
      meanConfidence: null,
      engine: this.name,
    };
  }
}
