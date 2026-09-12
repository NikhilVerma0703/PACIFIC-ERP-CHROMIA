"use client";
// The customer's own barcode series (round four, answer 2), on the articles
// screen because that is where the codes it feeds are maintained.
//
// WHAT IT IS FOR. Every code on the sheet the owner sent reads 8720847 + a
// five-digit item reference + a check digit. Autogeneration continues THAT
// series, so the prefix is the customer's, it is stored per customer, and the
// next customer's will be a different length with a different amount of room
// left for the reference. The card shows the prefix, the floor, the highest
// reference actually in use and THE NEXT CODE IT WOULD HAND OUT — the last of
// those is the only one a person can check by eye against the sheet in front of
// them before a single label is printed.
//
// THE BLOCK IS SHOWN HERE FIRST. While any article of this customer carries a
// blocked reason, nothing of theirs is generated and nothing of theirs is
// printed; the sentence names the two articles that collide, and the buttons
// that would generate are disabled WITH that reason rather than hidden.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson } from "@/lib/fab/postJson";
import { describeGs1Prefix } from "@/lib/commercial/barcode";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
const okBox = "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700";
const warnBox = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800";

export interface SeriesDto {
  clientId: string;
  clientName: string;
  gs1Prefix: string | null;
  nextRef: number;
  notes: string | null;
  itemRefWidth: number;
  capacity: number;
  prefixMessage: string | null;
  highestInUse: number | null;
  nextEan: string | null;
  nextMessage: string | null;
  blocked: boolean;
  blockedMessage: string | null;
  blockedArticles: Array<{ id: string; label: string; reason: string }>;
  withoutBarcode: number;
  total: number;
}

export default function Gs1PrefixCard({
  clientId, readOnly, onChanged,
}: {
  clientId: string;
  readOnly: boolean;
  /** The article list is re-read after a bulk generate — the codes it just
   *  wrote are on the rows the table is showing. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<SeriesDto | null>(null);
  const [prefix, setPrefix] = useState("");
  const [nextRef, setNextRef] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/office/commercial/articles/gs1/${clientId}`, { cache: "no-store" });
    const res = await readJson<SeriesDto>(r);
    if (!res.ok || !res.data) { setData(null); setError(res.error ?? "Could not read this customer's barcode series"); return; }
    setError(null);
    setData(res.data);
    setPrefix(res.data.gs1Prefix ?? "");
    setNextRef(String(res.data.nextRef ?? 0));
    setNotes(res.data.notes ?? "");
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  // The same verdict the route will give, while the digits are still under the
  // cursor — and it carries the thing the person actually wants to know, which
  // is how many digits of item reference the prefix leaves them.
  const verdict = describeGs1Prefix(prefix);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null); setSkipped([]);
    const res = await putJson(`/api/office/commercial/articles/gs1/${clientId}`, {
      gs1Prefix: prefix, nextRef, notes,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Could not save the series"); return; }
    setNotice((res.data as { note?: string | null })?.note ?? "The barcode series was saved.");
    await load();
  }

  async function generateAll() {
    if (!data) return;
    if (!window.confirm(`Generate a barcode for every article of ${data.clientName} that has none — ${data.withoutBarcode} of them? Codes the customer sent are left alone.`)) return;
    setBusy(true); setError(null); setNotice(null); setSkipped([]);
    const res = await postJson("/api/office/commercial/articles/allocate", { clientId });
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Could not generate the barcodes"); return; }
    const out = res.data as { allocations?: Array<{ label: string; ean: string }>; skipped?: Array<{ reason: string }>; message?: string | null };
    const made = out.allocations ?? [];
    setNotice(`${made.length} barcode(s) generated${made.length ? `, ${made[0].ean} to ${made[made.length - 1].ean}` : ""}.${out.message ? ` ${out.message}` : ""}`);
    setSkipped((out.skipped ?? []).map((s) => s.reason));
    await load();
    onChanged();
  }

  if (!data && error) return <Card><div className={errBox}>{error}</div></Card>;
  if (!data) return null;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{data.clientName} — barcode series</h2>
          <p className="mt-1 text-xs text-gray-500">
            Their GS1 company prefix, and the next item reference we may give out under it. A generated code is the
            prefix, the next reference and the computed check digit — the same shape as the ones they sent.
          </p>
        </div>

        {data.blocked && <div className={errBox}>{data.blockedMessage}</div>}
        {notice && <div className={okBox}>{notice}</div>}
        {error && <div className={errBox}>{error}</div>}
        {skipped.length > 0 && (
          <div className={warnBox}>
            <ul className="list-disc pl-4">{skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}

        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className={lbl}>GS1 company prefix</span>
            <input className={inp} value={prefix} disabled={busy || readOnly} inputMode="numeric"
              onChange={(e) => setPrefix(e.target.value)} placeholder="8720847" />
          </label>
          <label>
            <span className={lbl}>Next item reference (floor)</span>
            <input className={inp} value={nextRef} disabled={busy || readOnly} inputMode="numeric"
              onChange={(e) => setNextRef(e.target.value)} placeholder="0" />
          </label>
          <label className="lg:col-span-2">
            <span className={lbl}>Notes</span>
            <input className={inp} value={notes} disabled={busy || readOnly}
              onChange={(e) => setNotes(e.target.value)} placeholder="Where the prefix came from" />
          </label>
          <div className="flex items-center gap-3 lg:col-span-4">
            <button type="submit" className={btnPrimary} disabled={busy || readOnly || !verdict.ok}
              title={readOnly ? "Item codes and barcodes are changed by the Commercial Manager or an admin." : undefined}>
              {busy ? "Saving…" : "Save series"}
            </button>
            <button type="button" className={btnGhost}
              disabled={busy || readOnly || data.blocked || !data.gs1Prefix || data.withoutBarcode === 0}
              title={
                readOnly ? "Item codes and barcodes are changed by the Commercial Manager or an admin."
                  : data.blocked ? (data.blockedMessage ?? undefined)
                  : !data.gs1Prefix ? "There is no GS1 prefix on file to generate from."
                  : data.withoutBarcode === 0 ? "Every article of this customer already has a barcode."
                  : undefined
              }
              onClick={() => void generateAll()}>
              Generate for {data.withoutBarcode} blank article(s)
            </button>
          </div>
        </form>

        {!verdict.ok && prefix.trim() !== "" && <p className="text-xs text-red-600">{verdict.message}</p>}

        <dl className="grid gap-3 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-gray-400">Item reference</dt>
            <dd className="tabular-nums">{data.itemRefWidth ? `${data.itemRefWidth} digits, 0 to ${data.capacity - 1}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Highest in use</dt>
            <dd className="tabular-nums">{data.highestInUse === null ? "none yet" : data.highestInUse}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Next code</dt>
            <dd className="tabular-nums">{data.nextEan ?? <span className="text-gray-400">—</span>}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Articles</dt>
            <dd className="tabular-nums">{data.total} on file, {data.withoutBarcode} with no barcode</dd>
          </div>
        </dl>

        {data.nextMessage && <p className="text-xs text-amber-700">{data.nextMessage}</p>}
        {data.blockedArticles.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-red-700">
            {data.blockedArticles.map((a) => <li key={`${a.id}-${a.reason}`}>{a.label}: {a.reason}</li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** PUT with postJson's contract. The shared helper has no PUT and this is a
 *  whole-row replace of one customer's series, so PUT is the honest verb. */
async function putJson(url: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, error: null, data };
    return { ok: false, status: res.status, error: String(data?.error ?? `Could not save (error ${res.status}).`), data };
  } catch {
    return { ok: false, status: 0, error: "No connection — the change was not saved. Try again.", data: null };
  }
}
