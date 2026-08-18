"use client";

import { useState } from "react";
import type { OcrResult } from "@/lib/ocr/types";

/** Where the work happens depends on the configured provider, and the panel
 *  says so rather than hiding it: with tesseract the bill never leaves this
 *  machine, with the others it is uploaded. That is a difference the person
 *  handling financial documents should be able to see. */
export function OcrPanel({ provider }: { provider: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [ms, setMs] = useState<number | null>(null);

  const inBrowser = provider === "tesseract";

  async function run() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null); setManual(false); setMs(null);
    const started = performance.now();
    try {
      if (inBrowser) {
        // Loaded on demand so the WASM engine is not in the page bundle for
        // anyone who never runs OCR.
        const { TesseractBrowserProvider } = await import("@/lib/ocr/tesseract");
        const data = new Uint8Array(await file.arrayBuffer());
        setResult(await new TesseractBrowserProvider().run({
          data, mimeType: file.type || "image/jpeg", handwritten,
        }));
      } else {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("handwritten", String(handwritten));
        const res = await fetch("/api/office/ocr", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) { setManual(Boolean(json?.manualEntry)); throw new Error(json?.error ?? `HTTP ${res.status}`); }
        setResult(json as OcrResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OCR failed.";
      setError(msg);
      if (/manual entry/i.test(msg)) setManual(true);
    } finally {
      setMs(Math.round(performance.now() - started));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-500">
          Engine: <span className="font-mono font-semibold text-gray-800">{provider}</span>
          {inBrowser
            ? " — runs in this browser. The bill is never uploaded."
            : " — runs on the server. The bill is sent to the provider."}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }}
          className="text-sm text-gray-600"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={handwritten} onChange={(e) => setHandwritten(e.target.checked)} />
          Mostly handwritten
        </label>
        <button
          onClick={run}
          disabled={!file || busy}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Reading…" : "Read bill"}
        </button>
        {busy && inBrowser && (
          <p className="text-xs text-gray-400">
            First run downloads the language data (~15 MB) and takes a few seconds; later runs are quick.
          </p>
        )}
      </div>

      {error && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${manual
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-red-300 bg-red-50 text-red-900"}`}>
          <b>{manual ? "Type this one in." : "Failed."}</b> {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span>engine <b className="font-mono text-gray-800">{result.engine}</b></span>
            <span>
              confidence{" "}
              <b className="font-mono text-gray-800">
                {result.meanConfidence === null
                  ? "not measured — needs a human"
                  : `${(result.meanConfidence * 100).toFixed(1)}%`}
              </b>
            </span>
            <span>{result.lines.length} lines · {result.words.length} words</span>
            {ms !== null && <span>{ms} ms</span>}
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-800">
            {result.text || "(nothing read)"}
          </pre>
        </div>
      )}
    </div>
  );
}
