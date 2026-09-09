"use client";
// The two labels off a packing list (round three, answer 4), previewed before
// anything is printed.
//
// WHY THE PREVIEW EXISTS. A crate label with no article on file prints the
// design and the size and NO barcode — which is the right thing for it to do,
// and is also invisible on a pallet of forty crates until the customer's
// scanner finds nothing. So the screen names the (design, size) pairs that
// have no article BEFORE the sheet goes to the printer, with a link to add
// them, and the print buttons stay enabled: a label without a barcode is still
// a label the packer needs today.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
const warnBox = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800";

interface ListRow { id: string; number: string; order?: { number: string; client?: { name: string } | null } | null }

interface CrateLabelDto {
  crateNo: string; design: string; size: string; lines: string[];
  ean: string | null; quantity: number; hasArticle: boolean; rejectedEan: string | null;
}
interface MissingDto { design: string; size: string; crateNos: string[]; quantity: number }
interface MissingBarcodeDto extends MissingDto { itemCode: string | null; rejectedEan: string | null }
interface LabelsDto {
  number: string;
  crates: CrateLabelDto[];
  missing: MissingDto[];
  missingBarcodes: MissingBarcodeDto[];
  pieceCount: number;
  pieceLabelsPerPage: number;
  truncated: number;
}

/** "in crate 1, 2" / ", not yet in a crate" — the same tail on both lists. */
const whereIs = (m: MissingDto): string =>
  m.crateNos.length ? ` in crate ${m.crateNos.join(", ")}` : ", not yet in a crate";

export default function LabelsPanel() {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [plId, setPlId] = useState("");
  const [data, setData] = useState<LabelsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/office/commercial/packing-lists?limit=100", { cache: "no-store" });
      const res = await readJson<{ items: ListRow[] }>(r);
      if (!res.ok || !res.data) { setError(res.error ?? "Could not load the packing lists"); return; }
      setLists(res.data.items ?? []);
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) { setData(null); return; }
    setLoading(true);
    const r = await fetch(`/api/office/commercial/packing-lists/${id}/labels?kind=crate&format=json`, { cache: "no-store" });
    const res = await readJson<LabelsDto>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setData(null); setError(res.error ?? "Could not read the labels for that list"); return; }
    setError(null);
    setData(res.data);
  }, []);

  useEffect(() => { void load(plId); }, [plId, load]);

  const href = (kind: "crate" | "piece") => `/api/office/commercial/packing-lists/${plId}/labels?kind=${kind}`;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1">
            <span className={lbl}>Packing list</span>
            <select className={inp} value={plId} onChange={(e) => setPlId(e.target.value)}>
              <option value="">Pick a packing list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.number}{l.order?.number ? ` · ${l.order.number}` : ""}{l.order?.client?.name ? ` · ${l.order.client.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <a className={btnGhost} href={plId ? href("crate") : undefined} target="_blank" rel="noreferrer"
            aria-disabled={!plId}
            onClick={(e) => { if (!plId) e.preventDefault(); }}
            title={plId ? undefined : "Pick a packing list first."}>Crate labels (PDF)</a>
          <a className={btnGhost} href={plId ? href("piece") : undefined} target="_blank" rel="noreferrer"
            aria-disabled={!plId}
            onClick={(e) => { if (!plId) e.preventDefault(); }}
            title={plId ? undefined : "Pick a packing list first."}>Piece labels (PDF)</a>
        </div>

        {error && <div className={errBox}>{error}</div>}

        {data && data.missing.length > 0 && (
          <div className={warnBox}>
            <p className="font-medium">
              {data.missing.length} line(s) on {data.number} have no article on file — their crates will print with no barcode.
            </p>
            <ul className="mt-1 list-inside list-disc">
              {data.missing.map((m) => (
                <li key={`${m.design}|${m.size}`}>
                  {m.design} {m.size} — {m.quantity} piece(s){whereIs(m)}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              Add the customer&apos;s item code and barcode in the list above, then reload this panel.
            </p>
          </div>
        )}

        {/* THE SECOND LIST IS A DIFFERENT ERRAND. The row above is missing and
            somebody here types it; the row below EXISTS and its barcode is
            missing, which is the customer's to send — or, when a code is on
            file and unreadable, a digit somebody here mistyped. Both print a
            crate label without bars, and the panel used to name only the
            first, so a half-entered article looked complete. */}
        {data && (data.missingBarcodes ?? []).length > 0 && (
          <div className={warnBox}>
            <p className="font-medium">
              {data.missingBarcodes.length} line(s) on {data.number} have an article but no usable barcode — those crates
              print the item code and the description, with no bars.
            </p>
            <ul className="mt-1 list-inside list-disc">
              {data.missingBarcodes.map((m) => (
                <li key={`${m.design}|${m.size}`}>
                  {m.itemCode ?? `${m.design} ${m.size}`} — {m.quantity} piece(s){whereIs(m)}
                  {m.rejectedEan
                    ? ` — ${m.rejectedEan} is on file and is not a readable EAN-13; check the digits against the customer's sheet.`
                    : " — the customer has not sent a barcode for it yet."}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2 font-medium">Crate</th>
                  <th className="px-3 py-2 font-medium">Label</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 font-medium">Barcode</th>
                </tr>
              </thead>
              <tbody>
                {data.crates.map((c, i) => (
                  <tr key={`${c.crateNo}-${c.design}-${c.size}-${i}`} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-3 py-2 tabular-nums text-gray-700">{c.crateNo || "—"}</td>
                    <td className="px-3 py-2">
                      <pre className="whitespace-pre-wrap font-sans text-xs text-gray-800">{c.lines.join("\n")}</pre>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.quantity}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {c.ean ?? (
                        // The same three answers the label prints, so the
                        // screen and the sheet never disagree about WHY.
                        <span className="text-amber-700" title={
                          !c.hasArticle
                            ? "No article on file for this design and size — add one above."
                            : c.rejectedEan
                              ? `${c.rejectedEan} is on file and is not a readable EAN-13.`
                              : "The article is on file; the customer has not sent a barcode for it yet."
                        }>none</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!data.crates.length && (
                  <tr><td colSpan={4} className="px-3 py-6">
                    <Empty>{loading ? "Loading…" : `Nothing is packed on ${data.number} yet, so there is nothing to label.`}</Empty>
                  </td></tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">
              Piece labels: {data.pieceCount} label(s),{" "}
              {Math.ceil(data.pieceCount / Math.max(1, data.pieceLabelsPerPage))} A4 sheet(s) of{" "}
              {data.pieceLabelsPerPage}
              {data.truncated > 0 ? ` — ${data.truncated} more were asked for than one run prints` : ""}.
              {" "}They carry the item code and the size alone, one per piece.
              {" "}<Link className="underline" href="/office/commercial/packing-lists">Packing lists</Link>
            </p>
          </div>
        )}

        {!data && !error && (
          <Empty>{loading ? "Loading…" : "Pick a packing list to see the labels it will print."}</Empty>
        )}
      </div>
    </Card>
  );
}
