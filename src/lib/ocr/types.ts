// The OCR contract, ported from automation/app/ocr/engine.py so the Python
// engine and this in-ERP implementation stay comparable field for field.
//
// Providers are interchangeable: swapping one is a config change, not a code
// change at the call site. That is the same promise engine.py makes, and the
// reason its CloudEngine stub exists.

export interface OcrWord {
  text: string;
  /** 0..1. Null when the provider cannot report per-word confidence. */
  confidence: number | null;
}

export interface OcrResult {
  /** Full transcription, newline-separated in reading order. */
  text: string;
  words: OcrWord[];
  lines: string[];
  /**
   * 0..1, or NULL when the provider does not measure confidence.
   *
   * Null is not zero and must never be coerced to a number. The Python
   * pipeline routes a bill to a human on low `mean_conf`
   * (pipeline.py:299), so a provider that cannot score itself — a vision
   * model transcribing an image, for instance — has to say "unknown" and let
   * that bill go to review. Substituting 1.0 here would silently auto-approve
   * every bill the model was least sure about.
   */
  meanConfidence: number | null;
  /** Provider that produced this, for the audit trail. */
  engine: string;
  /** Set when the provider believes it was handed handwriting. See below. */
  handwritingSuspected?: boolean;
}

export interface OcrInput {
  /** Raw image bytes. PNG/JPEG; PDFs must be rasterised before this point. */
  data: Uint8Array;
  mimeType: string;
  /**
   * The clerk's "Mostly handwritten bills" hint from the upload form.
   *
   * It matters because classical OCR does not degrade gracefully on
   * handwriting — quality.py puts it exactly right: it "emits confident
   * nonsense, which in a finance system is" worse than failing outright. A
   * classical provider must refuse rather than guess; a vision model may
   * proceed.
   */
  handwritten?: boolean;
}

export interface OcrProvider {
  readonly name: string;
  /** True when the provider can read handwriting rather than inventing it. */
  readonly readsHandwriting: boolean;
  run(input: OcrInput): Promise<OcrResult>;
}

/** Thrown when a provider is handed work it cannot do honestly. */
export class OcrUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrUnsupportedError";
  }
}

/**
 * The one rule every provider obeys: if it cannot read handwriting, it refuses
 * the job instead of guessing at it.
 *
 * Lives here rather than in each provider so the policy is stated once and can
 * be tested without loading a browser engine or calling a paid API. Adding a
 * fourth provider means declaring `readsHandwriting` honestly and calling this
 * — the rule then applies for free.
 */
export function assertCanRead(
  provider: Pick<OcrProvider, "name" | "readsHandwriting">,
  input: OcrInput,
): void {
  if (input.handwritten && !provider.readsHandwriting) {
    throw new OcrUnsupportedError(
      `${provider.name} cannot read handwriting — it returns confident nonsense. ` +
      "Use manual entry, or switch OCR_PROVIDER to a vision model (claude, google).",
    );
  }
}

/** Split a transcription into non-empty trimmed lines. */
export function toLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Mean of the confidences that exist. Returns null when none do, so "no
 * provider confidence" survives all the way to the caller rather than
 * becoming a misleading 0.
 */
export function meanOf(words: OcrWord[]): number | null {
  const scored = words.map((w) => w.confidence).filter((c): c is number => c !== null);
  if (!scored.length) return null;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}
