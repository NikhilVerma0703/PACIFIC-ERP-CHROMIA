import "server-only";

// Server-side provider selection. One env var picks the engine, which is the
// same promise config.yaml makes for the Python side: "cloud provider is one
// line in config.yaml - no calling code changes".
//
// The browser provider is deliberately NOT reachable from here — it must be
// imported directly by the client component that runs it, or Next would try to
// pull WASM Tesseract into a serverless bundle.

import { ClaudeOcrProvider } from "./claude";
import { GoogleVisionProvider } from "./google";
import type { OcrProvider } from "./types";

export type ServerOcrProviderName = "claude" | "google";

/** OCR_PROVIDER=claude|google|tesseract. Default tesseract (browser, free). */
export function configuredProviderName(): string {
  return (process.env.OCR_PROVIDER ?? "tesseract").trim().toLowerCase();
}

/**
 * The server-side provider, or null when the configured one runs in the
 * browser. Null is a valid answer, not a failure — it tells the caller the
 * work belongs on the client.
 */
export function serverProvider(): OcrProvider | null {
  switch (configuredProviderName()) {
    case "claude": return new ClaudeOcrProvider();
    case "google": return new GoogleVisionProvider();
    case "tesseract": return null;
    default:
      throw new Error(
        `Unknown OCR_PROVIDER "${configuredProviderName()}". Use tesseract, claude or google.`,
      );
  }
}

export * from "./types";
