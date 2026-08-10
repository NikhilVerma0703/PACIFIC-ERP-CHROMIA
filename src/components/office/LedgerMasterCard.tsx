"use client";

// The ledger master, and how an admin loads it.
//
// `fin_ledger` is the floor everything else stands on: isPerson is the claimant
// dropdown, isExpense is the classifier's whole vocabulary. With the table
// empty, Bill Automation renders perfectly and does nothing - no names to pick,
// no ledger ever suggested - which reads as a broken product rather than an
// unfinished setup. So this card states the count first and loudly, and only
// then offers the upload.
//
// ADMIN ONLY. The page renders it exclusively for admins; the route enforces the
// same rule again, because a UI condition is not an authorisation.

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";

const ENDPOINT = "/api/office/finance-admin/seed-ledgers";

const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";

interface MasterState {
  total: number;
  people: number;
  expense: number;
  withGstin: number;
  usage: number;
  syncedAt: string | null;
  peopleGroup: string;
  samplePeople: string[];
}

interface SeedResult {
  source: string;
  written: number;
  people: number;
  expense: number;
  withGstin: number;
  registeredInPeopleGroup: number;
  usage: number;
  stale: number;
  pruned: number;
  withAliases: number | null;
  notes: string[];
}

/**
 * gzip in the browser.
 *
 * PESPL's MASTER.xml is ~30 MB, and a serverless request body is capped far
 * below that - an uncompressed upload does not fail slowly, it fails at the edge
 * with an opaque 413 before any of our code runs. Tally's XML is enormously
 * repetitive, so gzip takes it to roughly a twentieth. CompressionStream is
 * available in every current browser; where it is not, the raw bytes are sent
 * and a large file will be refused with a message that says why.
 */
async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export function LedgerMasterCard() {
  const [state, setState] = useState<MasterState | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [prune, setPrune] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SeedResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(ENDPOINT, { cache: "no-store" });
      if (!r.ok) return; // not an admin, or the route is not deployed - stay quiet
      setState(await r.json());
    } catch { /* the card simply does not render its counts */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = async () => {
    if (!file) { setError("Choose MASTER.xml or ledgers.json first."); return; }
    setError(""); setResult(null);
    try {
      setPhase("Reading the file…");
      const raw = new Uint8Array(await file.arrayBuffer());

      setPhase("Compressing…");
      const packed = await gzip(raw);

      setPhase(`Uploading ${fmtBytes((packed ?? raw).byteLength)}…`);
      const r = await fetch(`${ENDPOINT}?prune=${prune ? "1" : "0"}`, {
        method: "POST",
        headers: {
          "Content-Type": /\.json$/i.test(file.name) ? "application/json" : "application/xml",
          ...(packed ? { "x-finance-encoding": "gzip" } : {}),
        },
        body: (packed ?? raw) as BodyInit,
      });

      setPhase("Writing the ledger master…");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `Import failed (${r.status})`);
      setResult(d as SeedResult);
      setFile(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("");
    }
  };

  // `state == null` is "not asked yet", not "nothing there". Conflating them
  // flashed a red "no chart of accounts" box on every load of a perfectly
  // healthy page, which is the kind of false alarm that teaches people to
  // ignore the real one.
  const empty = state != null && state.total === 0;
  const noPeople = state != null && state.total > 0 && state.people === 0;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Ledger master · admin
        </h2>
        {state && (
          <span className="flex items-center gap-2 text-xs text-gray-400">
            {empty
              ? <Badge tone="red">not loaded</Badge>
              : <Badge tone="green">{state.total.toLocaleString("en-IN")} ledgers</Badge>}
            {state.syncedAt && !empty && (
              <span>imported {state.syncedAt.slice(0, 10)}</span>
            )}
          </span>
        )}
      </div>

      {/* The state that matters most, said plainly rather than shown as a zero. */}
      {empty && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">No chart of accounts has been imported.</p>
          <p className="mt-1 text-red-700">
            Until it is, the claimant dropdown is empty and the classifier can suggest
            nothing — every bill lands in the review queue with no ledger. Export it from
            Tally: <span className="font-mono text-xs">Gateway of Tally → Alt+E → Masters
            → Report: All Masters → Format: XML</span>, then upload MASTER.xml below.
          </p>
        </div>
      )}

      {noPeople && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {state.total.toLocaleString("en-IN")} ledgers are loaded but none is a claimant.
          Nobody can be picked for an upload. The rule is: a ledger under{" "}
          <span className="font-medium">{state.peopleGroup}</span> with no GST number.
          Check that group name matches Tally, then re-import.
        </div>
      )}

      {state && state.total > 0 && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([
            ["Claimants", state.people, "pickable on upload"],
            ["Expense heads", state.expense, "the classifier's vocabulary"],
            ["GST-registered", state.withGstin, "treated as businesses"],
            ["Usage counts", state.usage, "suggestion tie-breaker"],
          ] as const).map(([k, v, hint]) => (
            <div key={k} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <dt className="text-xs text-gray-500">{k}</dt>
              <dd className="text-lg font-semibold text-gray-900">{v.toLocaleString("en-IN")}</dd>
              <p className="text-[11px] text-gray-400">{hint}</p>
            </div>
          ))}
        </dl>
      )}

      {state && state.total > 0 && state.samplePeople.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          e.g. {state.samplePeople.join(" · ")}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-sm font-medium text-brand hover:underline"
        >
          {empty ? "Import the ledger master →" : "Re-import from Tally →"}
        </button>
      ) : (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <input
            type="file"
            accept=".xml,.json,application/xml,text/xml,application/json"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); setResult(null); }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/20"
          />
          <p className="text-xs text-gray-400">
            MASTER.xml (All Masters export — carries the GST numbers that tell claimants
            from suppliers) or a ledgers.json. Large files are compressed in this browser
            before upload.
          </p>

          <label className="inline-flex cursor-pointer items-start gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={prune}
              onChange={(e) => setPrune(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand/30"
            />
            <span>
              Remove ledgers missing from this file — use it after ledgers were deleted in
              Tally. Ignored for small files, and it does not touch bills already coded to
              a removed ledger.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button type="button" onClick={upload} disabled={!file || Boolean(phase)} className={btnPrimary}>
              {phase || "Import"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setFile(null); setError(""); }}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>

          {result && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <p className="font-medium">
                Imported {result.written.toLocaleString("en-IN")} ledgers
                {result.source === "master_xml" ? " from MASTER.xml" : " from JSON"} —{" "}
                {result.people.toLocaleString("en-IN")} claimants,{" "}
                {result.expense.toLocaleString("en-IN")} expense heads
                {result.usage ? `, ${result.usage.toLocaleString("en-IN")} usage counts` : ""}.
              </p>
              <p className="mt-1 text-xs text-green-700">
                {result.registeredInPeopleGroup > 0 && (
                  <>
                    {result.registeredInPeopleGroup} GST-registered ledger(s) in the claimant
                    group were kept out of the dropdown as businesses.{" "}
                  </>
                )}
                {result.withAliases != null && <>{result.withAliases} picked up seed vocabulary. </>}
                {result.pruned > 0 && <>{result.pruned} stale ledger(s) removed.</>}
              </p>
              {result.notes.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-green-900/80">
                  {result.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
