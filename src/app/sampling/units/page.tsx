"use client";

// BOXES AND STANDS — the incharge's screen (scripts/0086; the owner,
// 2026-09-14: "we want to add to track sample boxes and stands in the sampling
// modules").
//
// TWO KINDS OF THING ON ONE PAGE, and they are not the same thing wearing
// different labels. A box is a consumable with a count; a stand is a named
// object with a life — FS-0007 went to Sharma Marbles in March and is still
// there. So a counted type shows one number and a Correct-count control, and a
// serialised type expands into its serials with who has each one.
//
// EVERY WRITE IS manageUnits, refused for the fabrication floor. The page does
// not hide the controls from a viewer — the API is the gate, and a screen that
// silently omits buttons teaches nobody why.
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, H2 } from "@/components/ui";
import { postJson, patchJson } from "@/lib/fab/postJson";

type Serial = {
  id: string;
  serialNo: string;
  status: string;
  customerName: string | null;
  installedAt: string | null;
  locationNote: string | null;
};

type UnitType = {
  id: string;
  kind: "BOX" | "STAND";
  name: string;
  sfStandType: string | null;
  serialised: boolean;
  capacityPieces: number | null;
  minQty: number;
  onHand: number;
  committed: number;
  available: number;
  low: boolean;
  serials: Serial[];
};

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  reference: string | null;
  note: string | null;
  at: string;
  by: string;
  unitType: { id: string; name: string };
};

const inp = "w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-white/40";
const lbl = "block text-xs text-gray-400 mb-1";
const btn = "rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40";
const btnGhost = "rounded border border-white/15 px-2.5 py-1 text-xs text-gray-200 hover:bg-white/5 disabled:opacity-40";

const STATUS_TONE: Record<string, string> = {
  IN_STOCK: "text-emerald-300",
  RELEASED: "text-amber-300",
  DISPATCHED: "text-sky-300",
  INSTALLED: "text-indigo-300",
  RETURNED: "text-orange-300",
  RETIRED: "text-gray-500",
};

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

export default function UnitsPage() {
  const [types, setTypes] = useState<UnitType[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [drifting, setDrifting] = useState<Array<{ name: string; quantity: number; ledgerSum: number; drift: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openType, setOpenType] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, l] = await Promise.all([
        fetch("/api/sampling/units", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/sampling/units/ledger?limit=60", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (u?.error) throw new Error(u.error);
      setTypes(u.types ?? []);
      setLedger(l?.rows ?? []);
      setDrifting(l?.drifting ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the units shelf.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <H2>Boxes &amp; stands</H2>

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

      {/* THE COUNT AGAINST ITS OWN HISTORY. Shown, never silently corrected: a
          count that disagrees with its ledger is a fact somebody needs to see,
          and the fix is an adjustment with a reason on it. */}
      {drifting.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <div className="font-medium">A count does not match its ledger</div>
          {drifting.map((d) => (
            <div key={d.name} className="text-xs">
              {d.name}: shelf says {d.quantity}, the ledger adds up to {d.ledgerSum} ({d.drift > 0 ? "+" : ""}{d.drift}).
              Count the shelf and correct it with a reason.
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {types.map((t) => (
          <Card key={t.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">{t.name}</span>
                  <Badge tone={t.kind === "STAND" ? "brand" : undefined}>{t.kind === "STAND" ? "Stand" : "Box"}</Badge>
                  {t.low && <Badge tone="red">Low</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {t.serialised ? "Tracked one at a time" : "Counted"}
                  {t.capacityPieces ? ` · holds ${t.capacityPieces} pieces` : ""}
                  {t.sfStandType ? ` · Salesforce "${t.sfStandType}"` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-semibold ${t.low ? "text-red-300" : "text-gray-100"}`}>{t.available}</div>
                <div className="text-[11px] text-gray-500">
                  available{t.committed > 0 ? ` · ${t.onHand} on hand, ${t.committed} spoken for` : ""}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
              <AddStock type={t} busy={busy} onRun={run} />
              {!t.serialised && <CorrectCount type={t} busy={busy} onRun={run} />}
              {t.serialised && t.serials.length > 0 && (
                <button className={btnGhost} onClick={() => setOpenType(openType === t.id ? null : t.id)}>
                  {openType === t.id ? "Hide" : `Show ${t.serials.length}`}
                </button>
              )}
            </div>

            {t.serialised && openType === t.id && (
              <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
                {t.serials.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-gray-200">{s.serialNo}</span>
                    <span className={STATUS_TONE[s.status] ?? "text-gray-400"}>{pretty(s.status)}</span>
                    <span className="flex-1 truncate text-gray-500">
                      {s.customerName ?? ""}{s.locationNote ? ` · ${s.locationNote}` : ""}
                    </span>
                    <SerialActions serial={s} busy={busy} onRun={run} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <div className="mb-2 text-sm font-medium text-gray-200">Ledger</div>
        {ledger.length === 0 ? (
          <Empty>Nothing has moved yet. Count the cupboard and add what is there.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr className="text-left">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">What</th>
                  <th className="py-1 pr-3 text-right">Change</th>
                  <th className="py-1 pr-3">Why</th>
                  <th className="py-1 pr-3">Note</th>
                  <th className="py-1">Who</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="py-1 pr-3 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                    <td className="py-1 pr-3">{r.unitType.name}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${r.delta < 0 ? "text-orange-300" : r.delta > 0 ? "text-emerald-300" : "text-gray-500"}`}>
                      {r.delta > 0 ? "+" : ""}{r.delta}
                    </td>
                    <td className="py-1 pr-3">{pretty(r.reason)}</td>
                    <td className="py-1 pr-3 text-gray-400">{r.note ?? r.reference ?? ""}</td>
                    <td className="py-1 text-gray-400">{r.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Put something on the shelf. A serialised type takes serial numbers — or a
 *  count, and the ERP proposes the numbers for the incharge to overtype. */
function AddStock({ type, busy, onRun }: { type: UnitType; busy: boolean; onRun: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [qty, setQty] = useState("");
  const [serials, setSerials] = useState("");
  const [note, setNote] = useState("");

  const submit = () =>
    onRun(async () => {
      const list = serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const res = await postJson("/api/sampling/units", {
        unitTypeId: type.id,
        quantity: qty ? Number(qty) : undefined,
        serials: list.length ? list : undefined,
        note: note || undefined,
      });
      if (!res.ok) throw new Error(res.error ?? "That did not go through.");
      setQty(""); setSerials(""); setNote("");
    });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-20">
        <label className={lbl}>How many</label>
        <input className={inp} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
      </div>
      {type.serialised && (
        <div className="w-44">
          <label className={lbl}>Or their numbers</label>
          <input className={inp} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="FS-0007, FS-0008" />
        </div>
      )}
      <div className="w-36">
        <label className={lbl}>Note</label>
        <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      </div>
      <button className={btn} disabled={busy || (!qty && !serials)} onClick={submit}>Add</button>
    </div>
  );
}

/** Correct a count. Refused without a reason — the API says so too, and this
 *  is the same rule said where the person is standing. */
function CorrectCount({ type, busy, onRun }: { type: UnitType; busy: boolean; onRun: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [counted, setCounted] = useState("");
  const [why, setWhy] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-24">
        <label className={lbl}>Actual count</label>
        <input className={inp} inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={String(type.onHand)} />
      </div>
      <div className="w-44">
        <label className={lbl}>Why it changed</label>
        <input className={inp} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="two crushed in the store" />
      </div>
      <button
        className={btnGhost}
        disabled={busy || counted === "" || !why.trim()}
        onClick={() =>
          onRun(async () => {
            const res = await patchJson("/api/sampling/units", { unitTypeId: type.id, quantity: Number(counted), note: why });
            if (!res.ok) throw new Error(res.error ?? "That did not go through.");
            setCounted(""); setWhy("");
          })
        }
      >
        Correct
      </button>
    </div>
  );
}

/** What a person may do to one stand by hand. Sending it is not here: a stand
 *  leaves on a package, with the pieces, in one transaction. */
function SerialActions({ serial, busy, onRun }: { serial: Serial; busy: boolean; onRun: (fn: () => Promise<unknown>) => Promise<void> }) {
  const move = (status: string) =>
    onRun(async () => {
      const res = await patchJson(`/api/sampling/units/serials/${serial.id}`, { status });
      if (!res.ok) throw new Error(res.error ?? "That did not go through.");
    });

  return (
    <span className="flex gap-1">
      {(serial.status === "DISPATCHED" || serial.status === "INSTALLED") && (
        <button className={btnGhost} disabled={busy} onClick={() => move("RETURNED")}>Came back</button>
      )}
      {serial.status === "RETURNED" && (
        <>
          <button className={btnGhost} disabled={busy} onClick={() => move("IN_STOCK")}>Back on shelf</button>
          <button className={btnGhost} disabled={busy} onClick={() => move("RETIRED")}>Retire</button>
        </>
      )}
      {serial.status === "IN_STOCK" && (
        <button className={btnGhost} disabled={busy} onClick={() => move("RETIRED")}>Retire</button>
      )}
    </span>
  );
}
