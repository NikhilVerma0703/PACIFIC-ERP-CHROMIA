"use client";

// Preview, then commit. Never one button.
//
// This writes the line's whole history in one go, and an import from a
// misaligned sheet would be days of unpicking. The preview is the last cheap
// moment to notice — so the commit button does not appear until a preview has
// been read, and it names the number it is about to create.

import { useState, useTransition } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import {
  commitRegister, previewRegister,
  type ImportPreview, type ImportResult,
} from "@/lib/chromia/importRegister";

const btn = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

export function ImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [period, setPeriod] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const body = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (sheet) fd.set("sheet", sheet);
    if (period) fd.set("period", period);
    return fd;
  };

  const doPreview = () => start(async () => {
    setResult(null);
    setPreview(await previewRegister(body()));
  });

  const doCommit = () => start(async () => {
    const r = await commitRegister(body());
    setResult(r);
    setPreview(null);
  });

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          1 · The workbook
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600">
              Register file (.xlsx)
            </span>
            <input
              type="file" accept=".xlsx,.xls,.xlsm"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/20"
            />
          </div>
          <div>
            <label htmlFor="sheet" className="mb-1 block text-xs font-medium text-gray-600">
              Sheet (blank = the first one)
            </label>
            <input
              id="sheet" value={sheet} onChange={(e) => setSheet(e.target.value)}
              placeholder="PRO MAY"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div>
            <label htmlFor="period" className="mb-1 block text-xs font-medium text-gray-600">
              Period label
            </label>
            <input
              id="period" value={period} onChange={(e) => setPeriod(e.target.value)}
              placeholder="May 2026"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </div>
        </div>
        <button type="button" onClick={doPreview} disabled={!file || pending} className={`${btn} mt-4`}>
          {pending ? "Reading…" : "Read the sheet"}
        </button>
        <p className="mt-2 text-xs text-gray-500">
          Reading changes nothing. Columns are matched by position, not by heading — the register&apos;s
          three merged header rows cannot be matched by name.
        </p>
      </Card>

      {preview && !preview.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {preview.error}
        </div>
      )}

      {preview?.ok && (
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            2 · What this would do
          </h2>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Rows read" value={preview.totalRows} />
            <Stat label="Slabs created" value={preview.wouldCreate} strong />
            <Stat
              label="Already here"
              value={preview.alreadyPresent}
              hint={preview.alreadyPresent ? "left untouched" : undefined}
            />
            <Stat
              label="Still out for recal."
              value={preview.stillOut}
              hint={preview.stillOut ? "the backlog" : undefined}
            />
          </div>

          <p className="mb-3 text-sm text-gray-600">
            Sheet <span className="font-medium text-gray-900">{preview.sheetName}</span> of{" "}
            {preview.sourceFile}
            {preview.sheetNames.length > 1 && (
              <> · others in this file: {preview.sheetNames.filter((s) => s !== preview.sheetName).join(", ")}</>
            )}
          </p>

          {/* A slab already in the database is never overwritten — that is what
              makes re-running a workbook safe, and it is worth saying plainly
              rather than leaving someone to wonder what happened to their edits. */}
          {preview.alreadyPresent > 0 && (
            <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              {preview.alreadyPresent} slab{preview.alreadyPresent === 1 ? "" : "s"} in this sheet
              already exist here and will be left exactly as they are. Live data always wins over an
              import.
            </div>
          )}

          {preview.duplicateSlabNos.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">
                {preview.duplicateSlabNos.length} slab number
                {preview.duplicateSlabNos.length === 1 ? " appears" : "s appear"} more than once in
                the sheet:
              </span>{" "}
              {preview.duplicateSlabNos.slice(0, 12).join(", ")}
              {preview.duplicateSlabNos.length > 12 && " …"}
              <p className="mt-1 text-xs">
                Only the first row of each will be created — the rest are skipped as already
                present. Check them in the workbook if that is not what you meant.
              </p>
            </div>
          )}

          {preview.issues.length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-sm text-amber-700">
                {preview.issues.length} row{preview.issues.length === 1 ? "" : "s"} could not be read
              </summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                {preview.issues.map((i) => (
                  <li key={`${i.sourceRow}-${i.reason}`}>Row {i.sourceRow}: {i.reason}</li>
                ))}
              </ul>
            </details>
          )}

          {preview.byDisposition.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {preview.byDisposition.map((d) => (
                <Badge key={d.label} tone={d.label === "RECALIBRATION" ? "red" : "brand"}>
                  {d.label.replace(/_/g, " ").toLowerCase()} · {d.value}
                </Badge>
              ))}
            </div>
          )}

          {preview.sample.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <p className="mb-1 text-xs text-gray-400">First rows, as read:</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-1.5 pr-4 font-medium">Slab</th>
                    <th className="py-1.5 pr-4 font-medium">Batch</th>
                    <th className="py-1.5 pr-4 font-medium">Material</th>
                    <th className="py-1.5 pr-4 font-medium">Date</th>
                    <th className="py-1.5 pr-4 font-medium">Outcome</th>
                    <th className="py-1.5 font-medium">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((s) => (
                    <tr key={s.slabNo} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 pr-4 font-medium text-gray-900">{s.slabNo}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{s.batchNo}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{s.material}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{s.received}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{s.disposition}</td>
                      <td className="py-1.5 text-gray-500">{s.remark ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-gray-400">
                If these columns look wrong, the sheet layout differs from the register this reader
                was written for — stop here rather than importing.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
            <button
              type="button" onClick={doCommit}
              disabled={pending || preview.wouldCreate === 0}
              className={btn}
            >
              {pending
                ? "Importing…"
                : `Import ${preview.wouldCreate} slab${preview.wouldCreate === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={() => setPreview(null)} className={btnGhost}>
              Cancel
            </button>
            {preview.wouldCreate === 0 && (
              <span className="text-sm text-gray-500">
                Nothing new in this sheet — every slab in it is already here.
              </span>
            )}
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Result</h2>
          {result.ok ? (
            <>
              <p className="text-sm text-green-700">
                Imported {result.imported} slab{result.imported === 1 ? "" : "s"}.
                {result.skipped ? ` ${result.skipped} skipped (already here or blank).` : ""}
                {result.failed ? ` ${result.failed} failed.` : ""}
              </p>
              {result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-amber-700">
                    {result.errors.length} row{result.errors.length === 1 ? "" : "s"} to look at
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                    {result.errors.map((i) => (
                      <li key={`${i.sourceRow}-${i.reason}`}>Row {i.sourceRow}: {i.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <Empty>{result.error}</Empty>
          )}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong }: {
  label: string; value: number; hint?: string; strong?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${strong ? "border-brand/30 bg-brand/5" : "border-gray-200"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
