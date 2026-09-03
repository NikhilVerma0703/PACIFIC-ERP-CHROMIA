"use client";

import { useMemo, useState } from "react";
import { Badge, Empty, fmt } from "@/components/ui";
import { slabLabel } from "@/lib/slabLabel";
import type { BatchQcSlab } from "@/lib/batchQcList";

// Finished-goods status, rendered as-is from fg_finished_slab.status.
//
// ═══════ "CUT TO SIZE" IS NOT WHAT THIS COLUMN ANSWERS, AND IT SAID IT WAS ═══
//
// The status CTS is a word somebody applied by hand. What has actually been cut
// lives in fg_finished_slab.slab_mark, and the two are two orders of magnitude
// apart: measured on live Neon 2026-09-03, batch 1413 (Arva White) holds 232
// finished-goods slabs, ELEVEN of them slab_mark='CTS' — and exactly ONE of
// those eleven, slab 154757, also carries status='CTS'. Plant-wide it is 63
// marks against 1 status.
//
// So a reader who filtered this table's Status to "Cut to size" was answered
// with 1 of the 11 cut slabs on the batch in front of them, and this table has
// no Mark column, so nothing else on it distinguishes the other 10. That is the
// owner's original complaint ("look at any status filter in finished goods. It
// has CTS which should ideally not be there as we have moved it to any mark
// filter right?") reproduced verbatim on a second finished-goods screen; the
// inventory dashboard's status dropdown dropped the word the same day.
//
// TWO CHANGES, and the label change is the one that also covers the BADGE — the
// filter can be taken away, but slab 154757's row still has to render something,
// and "Cut to size" on a badge is the same claim in a smaller box. It is named
// for the column it is read from and carries a note (STATUS_NOTE) saying what it
// is not. The status is NOT removed from the map: it is a real value the `cts`
// action still writes, and an unlabelled one would print raw as "CTS".
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
  RETURNED: "Returned",
  CTS: "CTS (legacy status)",
};
/** Statuses this table will not OFFER as a filter, however many rows carry them.
 *  Offered is a strict subset of rendered — the same split intakeRules made
 *  between SLAB_STATUS_OPTIONS (what a picker shows) and SLAB_STATUSES (what is
 *  valid). Nothing outside this component can set `status`, so unlike the
 *  dashboard's select there is no "re-add it when something has chosen it"
 *  guard to write: a value that is never offered here is never selected here. */
const NOT_OFFERED_STATUS = new Set(["CTS"]);
/** Said on hover, where somebody about to read the badge as "this was cut" is
 *  looking. Only CTS needs one; every other status means what it says. */
const STATUS_NOTE: Record<string, string> = {
  CTS: "The inventory STATUS 'CTS', applied by hand — NOT the record of what has been cut. That is the slab MARK, which this table does not carry. On batch 1413 eleven slabs are marked cut and only this one carries the status (live Neon, 2026-09-03). Check the slab in Inventory before reading anything here as whole or cut.",
};
const STATUS_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  AVAILABLE: "brand",
  RESERVED: "amber",
  PACKED: "amber",
  DISPATCHED: "green",
  RETURNED: "red",
  // brand, not amber: amber is already PACKED/RESERVED, and two identical badges for
  // different states is exactly the kind of thing nobody notices until it misleads.
  CTS: "brand",
};

/** Shared "blank" sentinel for the three dropdowns — no grade, no thickness, or no
 *  finished-goods row at all. Each filter reads it with its own meaning; see the
 *  predicates below. It cannot be mistaken for a real value: status is a Prisma enum,
 *  thickness comes from the canonical resolver, and no QC grade is this string. */
const NO_LEDGER = "__none__";

const sel = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand";

/** The per-slab QC list, filtered in the browser.
 *
 *  Client-side on purpose. Every row is already in the payload (the page fetches the
 *  whole list to count it), so filtering is pure state: no navigation, no server round
 *  trip, no scroll jump — the same reason the MIS downtime log filters this way. (That
 *  one also mirrors its filter into the URL so the view is shareable and its Excel export
 *  inherits it; this table has neither, so it does not.)
 *
 *  It also keeps this page's defining property intact: the component takes BatchQcSlab[],
 *  the closed shape the page already projects, and reads nothing else. A filter cannot
 *  widen what reaches the JSX.
 *
 *  Options come from the rows themselves rather than a hardcoded list — the same lesson
 *  the inventory filter row taught: a hand-written list drifts from the data and starts
 *  offering values nothing matches, or hiding values that exist. */
export function QcSlabsTable({ rows }: { rows: BatchQcSlab[] }) {
  const [slab, setSlab] = useState("");
  const [grade, setGrade] = useState("");
  const [thickness, setThickness] = useState("");
  const [status, setStatus] = useState("");

  const opts = useMemo(() => {
    const g = new Set<string>(), t = new Set<string>(), s = new Set<string>();
    let anyNoLedger = false;
    for (const r of rows) {
      if (r.grade) g.add(r.grade);
      if (r.thickness) t.add(r.thickness);
      if (r.status) s.add(r.status); else anyNoLedger = true;
    }
    return {
      grades: [...g].sort((a, b) => a.localeCompare(b)),
      thicknesses: [...t].sort((a, b) => a.localeCompare(b)),
      // NOT_OFFERED_STATUS applied here rather than in the loop above, so the
      // set the options are drawn from stays the set the rows actually hold —
      // a reader of `s` should not have to know a value was dropped upstream.
      statuses: [...s].filter((v) => !NOT_OFFERED_STATUS.has(v)).sort((a, b) => a.localeCompare(b)),
      anyNoLedger,
      // Only offer "—" where a blank actually occurs, so no option is dead on arrival
      // (it can still return nothing in combination with another filter).
      anyNoGrade: rows.some((r) => !r.grade),
      anyNoThickness: rows.some((r) => !r.thickness),
    };
  }, [rows]);

  const shown = useMemo(() => {
    // Lower-cased: slabLabel renders an insert slab with a LETTER suffix (1.1 -> "1a"),
    // so "12C" must match "12c". Matched against both the label and the stored number,
    // since either is a reasonable thing to type.
    const q = slab.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !slabLabel(r.slab).toLowerCase().includes(q) && !String(r.slab).includes(q)) return false;
      if (grade && (grade === NO_LEDGER ? !!r.grade : r.grade !== grade)) return false;
      if (thickness && (thickness === NO_LEDGER ? !!r.thickness : r.thickness !== thickness)) return false;
      if (status && (status === NO_LEDGER ? r.status !== null : r.status !== status)) return false;
      return true;
    });
  }, [rows, slab, grade, thickness, status]);

  const active = !!(slab.trim() || grade || thickness || status);
  const clear = () => { setSlab(""); setGrade(""); setThickness(""); setStatus(""); };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={slab}
          onChange={(e) => setSlab(e.target.value)}
          placeholder="Slab #"
          className={`${sel} w-28`}
        />
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={sel}>
          <option value="">Any grade</option>
          {opts.grades.map((g) => <option key={g} value={g}>{g}</option>)}
          {opts.anyNoGrade && <option value={NO_LEDGER}>— no grade —</option>}
        </select>
        <select value={thickness} onChange={(e) => setThickness(e.target.value)} className={sel}>
          <option value="">Any thickness</option>
          {opts.thicknesses.map((t) => <option key={t} value={t}>{t}</option>)}
          {opts.anyNoThickness && <option value={NO_LEDGER}>— not recorded —</option>}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">Any status</option>
          {opts.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          {opts.anyNoLedger && <option value={NO_LEDGER}>— not in ledger —</option>}
        </select>
        {active && (
          <>
            <button type="button" onClick={clear} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              Clear
            </button>
            {/* Say what is being hidden — a filtered table that silently shows fewer rows
                than the count above it reads as missing data. The unit is named because
                the caption above counts DISTINCT SLABS while this counts QC ROWS, and on a
                batch with re-QC'd slabs the two legitimately differ. */}
            <span className="text-sm text-gray-500">
              Showing {fmt(shown.length)} of {fmt(rows.length)} QC rows
            </span>
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty>No slabs match these filters.</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Slab #</th>
                <th className="py-2 pr-4">Grade</th>
                <th className="py-2 pr-4">Thickness</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* A slab QC'd twice appears twice — rows are 1:1 with polish_qc, minus rows
                  carrying no slab number. Those are dropped upstream: a row with no slab is
                  not a slab, and surfacing the count would re-expose slabAudit.blankRows, a
                  rectification signal this page's projection excludes on purpose. */}
              {shown.map((s, i) => (
                <tr key={`${s.slab}-${i}`} className="border-t border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-900">{slabLabel(s.slab)}</td>
                  <td className="py-2 pr-4">{s.grade ?? "—"}</td>
                  <td className="py-2 pr-4">{s.thickness ?? "—"}</td>
                  <td className="py-2">
                    {s.status ? (
                      // The title rides on a wrapper because Badge takes no
                      // title of its own, and this note has to reach the hover
                      // of the one row it belongs to (slab 154757 today) rather
                      // than being written once somewhere off screen.
                      <span title={STATUS_NOTE[s.status]}>
                        <Badge tone={STATUS_TONE[s.status] ?? "brand"}>
                          {STATUS_LABEL[s.status] ?? s.status}
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-gray-400">not in ledger</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
