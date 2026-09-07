"use client";

// THE FABRICATION OVERVIEW: four tiles, then every project, collapsed.
//
// WHAT CHANGED AND WHY
// --------------------
// The Slabs tab listed slabs flat, which is how it read as four rows with slab
// 146837 in two of them — the same stone assigned to two projects. Legitimate,
// but it looks like a duplicate and it answers the wrong question. A CEO asks
// "how is project 1001 doing", not "what happened to slab 146837".
//
// So: project rows, each expanding to its slabs. Collapsed by default, because
// a shop with forty projects should open on four lines and not four hundred.
//
// EVERY NUMBER COMES FROM lib/fab/ceoOverview.ts AND lib/fab/pricing.ts.
// Nothing is computed in this file. That is the point of those two modules
// existing: the tiles are derived from the same rows the tree is built from, so
// a tile cannot disagree with the sum of what is under it, and the old bug
// where a total did not match its own column cannot come back.

import { useMemo, useState } from "react";
import {
  groupByProject, overviewTotals, HIGH_WASTE_PCT,
  type CeoSlabWastage, type OverviewProject,
} from "@/lib/fab/ceoOverview";
import {
  priceRow, sumPricing, parseEdges, describeEdges, thicknessLabel, formatRupees,
  type RowPricing,
} from "@/lib/fab/pricing";
import { describeShapeSize } from "@/lib/fab/shape";
// GRADE AND MARK ARE TWO CHIPS — see components/fab/SlabChips.tsx.
//
// This file used to draw its own chip, colouring by first letter. 'CTS' — which
// markQcSlabCts writes into the grade column — therefore came out RED, exactly
// like grade C, and the board read as though the floor were cutting rejects.
// The owner's correction: "CTS is not a grade, it's a mark. Marks should be
// full slab, CTS, sample." So the verdict (A/A2/B/C) and the mark
// (FULL_SLAB/CTS/SAMPLE) are separate columns now, drawn by separate chips in
// deliberately unalike colours, and neither can be mistaken for the other.
import { GradeChip, MarkChip } from "@/components/fab/SlabChips";

export interface PricingRow {
  projectCode: string;
  rowLetter: string | null;
  pieceLabel: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  quantity: number;
  sinkQuantity: number | null;
  thicknessMm: number | null;
  finishedEdges: string | null;
  /** RECTANGLE / CIRCLE / OVAL. Null is a rectangle — every row written before
   *  shapes existed, which is nearly all of them. */
  shapeType?: string | null;
  /** TOP / BOTTOM / BOTH. Null is TOP.
   *
   *  THIS FIELD WAS MISSING AND THE BOARD HALVED EVERY BOTH ROW. The route has
   *  always sent it (ceo/route.ts); this type dropped it, so priceRow below
   *  defaulted to one face while the period report on the SAME PAGE passed it
   *  and charged two. One dashboard, two numbers 2x apart for one row. */
  edgeFaces?: string | null;
}

type Priced = PricingRow & { priced: RowPricing };

function Tile({ label, value, note, tone = "plain" }: {
  label: string; value: string | number; note?: string;
  tone?: "plain" | "warn" | "bad" | "good" | "money";
}) {
  const skin = {
    plain: "bg-white border-slate-200 text-slate-800",
    warn:  "bg-amber-50 border-amber-200 text-amber-700",
    bad:   "bg-red-50 border-red-200 text-red-600",
    good:  "bg-emerald-50 border-emerald-200 text-emerald-700",
    money: "bg-indigo-50 border-indigo-200 text-indigo-700",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${skin}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums leading-none">{value}</div>
      {note && <div className="mt-1 text-[11px] opacity-60">{note}</div>}
    </div>
  );
}

/** A wastage bar. Green under 10, amber under 20, red above — the same 20%
 *  line HIGH_WASTE_PCT draws, so the colour and the tile agree. */
function WasteBar({ pct }: { pct: number }) {
  const bad = pct > HIGH_WASTE_PCT, mid = pct > 10;
  const col = bad ? "bg-red-500" : mid ? "bg-amber-500" : "bg-emerald-500";
  const text = bad ? "text-red-600" : mid ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${col}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums w-12 text-right ${text}`}>{pct}%</span>
    </div>
  );
}

// (GradeChip used to be defined here, colouring by first letter — see the note
// on the SlabChips import above for why it had to go.)

function ProjectRow({ project, rows }: { project: OverviewProject; rows: Priced[] }) {
  const [open, setOpen] = useState(false);   // collapsed by default
  const money = useMemo(() => sumPricing(rows.map(r => r.priced)), [rows]);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition"
      >
        <span className={`text-slate-400 text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="font-mono font-bold text-slate-900">{project.projectCode}</span>
        <span className="text-xs text-slate-400">
          {project.slabCount} slab{project.slabCount !== 1 ? "s" : ""} &middot; {project.pieceCount} pcs
        </span>
        {project.highWasteSlabs > 0 && (
          <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
            {project.highWasteSlabs} over {HIGH_WASTE_PCT}%
          </span>
        )}
        <span className="ml-auto flex items-center gap-5">
          <span className="text-xs text-slate-500 tabular-nums hidden sm:inline">
            {project.usedSqft} / {project.slabAreaSqft} sqft
          </span>
          {money.total > 0 && (
            <span className="text-xs font-bold text-indigo-700 tabular-nums">{formatRupees(money.total)}</span>
          )}
          <WasteBar pct={project.wastePct} />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-4">
          {/* ---- the slabs under this project ---- */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Slabs</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left font-medium py-1">Slab</th>
                    <th className="text-left font-medium py-1">Grade</th>
                    <th className="text-left font-medium py-1">Mark</th>
                    <th className="text-left font-medium py-1">Colour</th>
                    <th className="text-right font-medium py-1">Pcs</th>
                    <th className="text-right font-medium py-1">Slab area</th>
                    <th className="text-right font-medium py-1">Used</th>
                    <th className="text-right font-medium py-1">Waste</th>
                    <th className="text-right font-medium py-1 pl-4">Wastage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {project.slabs.map(s => (
                    <tr key={s.slabId}>
                      <td className="py-1.5 font-mono text-slate-700">{s.slabCode}</td>
                      <td className="py-1.5">
                        <GradeChip grade={s.qualityGrade} beforeCts={s.gradeBeforeCts} />
                      </td>
                      <td className="py-1.5">
                        {/* legacyGrade so a database without scripts/0057 still
                            shows CTS rather than a column of "Full slab". */}
                        <MarkChip mark={s.slabMark} legacyGrade={s.qualityGrade} />
                      </td>
                      <td className="py-1.5 text-slate-500 truncate max-w-[10rem]">{s.design ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold text-slate-800">{s.pieceCount}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{s.slabAreaSqft}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">{s.usedSqft}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">{s.wasteSqft}</td>
                      <td className="py-1.5 pl-4"><WasteBar pct={s.wastePct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- what the ordered rows are worth ---- */}
          {rows.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Charge &middot; sinks per piece, edge work per running foot on the fabrication pieces
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-medium py-1">Row</th>
                      <th className="text-left font-medium py-1">Size</th>
                      <th className="text-right font-medium py-1">Qty</th>
                      {/* TWO COUNTS, NOT ONE. Hand edge polish and sink cutting
                          are separate jobs on separate pieces since the owner
                          split them, so one "Fab" column could only ever be
                          right about one of them. The running feet are measured
                          over Edge pc; the sink charge over Sink pc. */}
                      <th className="text-right font-medium py-1" title="Pieces carrying HAND EDGE POLISH. A row is homogeneous, so this is the whole row or none of it — and it is the count the running feet are measured over.">Edge pc</th>
                      <th className="text-right font-medium py-1" title="Pieces with a sink cutout. Charged per piece; the sink polish is included in that rate.">Sink pc</th>
                      <th className="text-left font-medium py-1 pl-3">Thk</th>
                      <th className="text-left font-medium py-1">Edges</th>
                      <th className="text-right font-medium py-1">Run ft</th>
                      <th className="text-right font-medium py-1">Edge</th>
                      <th className="text-right font-medium py-1">Sink</th>
                      <th className="text-right font-medium py-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const p = r.priced;
                      return (
                        <tr key={i} className={p.unpriced ? "bg-amber-50/60" : ""}>
                          <td className="py-1.5 font-mono font-bold text-slate-800">{r.rowLetter ?? r.pieceLabel ?? "—"}</td>
                          {/* "⌀ 24 in" for a circle, "36 × 24 in oval" for an
                              oval. Printing 24 × 24 for a circle would read as a
                              square and make the running feet look wrong. */}
                          <td className="py-1.5 text-slate-500 tabular-nums">
                            {describeShapeSize(r.shapeType, { lengthIn: r.lengthIn, widthIn: r.widthIn })}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-700">{r.quantity}</td>
                          <td className={`py-1.5 text-right tabular-nums ${p.edgePieces > 0 ? "text-slate-700 font-semibold" : "text-slate-300"}`}>
                            {p.edgePieces > 0 ? p.edgePieces : "—"}
                          </td>
                          <td className={`py-1.5 text-right tabular-nums ${p.sinkPieces > 0 ? "text-slate-700 font-semibold" : "text-slate-300"}`}>
                            {p.sinkPieces > 0 ? p.sinkPieces : "—"}
                          </td>
                          <td className="py-1.5 pl-3 text-slate-500">{thicknessLabel(r.thicknessMm)}</td>
                          <td className="py-1.5 text-slate-500">
                            {/* A row nobody has been asked about is not the same
                                as one answered "no edges" — the first is a
                                question, the second an answer, and both cost ₹0
                                until somebody looks. */}
                            {r.finishedEdges === null
                              ? <span className="text-amber-600" title="Nobody has marked this row's edges yet — reported as unpriced, not as free">not chosen</span>
                              : describeEdges(parseEdges(r.finishedEdges), r.shapeType)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{p.runningFeet}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{p.unpriced ? "—" : formatRupees(p.edgeCost)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">
                            {p.unpriced ? "—" : p.sinkPieces > 0 ? formatRupees(p.sinkCost) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-bold text-slate-800">
                            {p.unpriced
                              ? <span
                                  className="text-amber-600 font-medium"
                                  title={p.unpricedReason === "EDGES"
                                    ? "This row names edges the shape does not have — a circle has one ring, a rectangle four sides"
                                    : p.unpricedReason === "SHAPE"
                                    ? "An L, a curve or a custom outline — there is no perimeter formula for it, so the hand polish is quoted by hand"
                                    : p.unpricedReason === "DIMENSIONS"
                                      ? "Edges are marked but the length or width they run along is missing — enter the size on the PO row"
                                      : "No rate for this thickness — the card covers 2 cm and 3 cm"}>
                                  {p.unpricedReason === "EDGES" ? "edges"
                                    : p.unpricedReason === "SHAPE" ? "shape"
                                    : p.unpricedReason === "DIMENSIONS" ? "no size" : "not priced"}
                                </span>
                              : formatRupees(p.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 font-bold text-slate-800">
                    <tr>
                      <td className="pt-2" colSpan={3}>Total</td>
                      <td className="pt-2 text-right tabular-nums">{money.edgePieces || "—"}</td>
                      <td className="pt-2 text-right tabular-nums">{money.sinkPieces || "—"}</td>
                      <td className="pt-2" colSpan={2} />
                      <td className="pt-2 text-right tabular-nums">{money.runningFeet}</td>
                      <td className="pt-2 text-right tabular-nums">{formatRupees(money.edgeCost)}</td>
                      <td className="pt-2 text-right tabular-nums">{formatRupees(money.sinkCost)}</td>
                      <td className="pt-2 text-right tabular-nums text-indigo-700">{formatRupees(money.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* SPLIT BY CAUSE, because they are fixed by different people and
                  one amber line saying "not priced" sent everybody to argue
                  about the rate card when the real problem was a blank width. */}
              {money.unpricedThickness > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  {money.unpricedThickness} row{money.unpricedThickness !== 1 ? "s are" : " is"} not in the total —
                  the rate card covers 2 cm and 3 cm, and these are cut from something else.
                </p>
              )}
              {money.unpricedDimensions > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  {money.unpricedDimensions} row{money.unpricedDimensions !== 1 ? "s have" : " has"} edges marked
                  with no size to measure them along — the length or width is blank on the order,
                  so the hand polish on {money.unpricedDimensions !== 1 ? "them" : "it"} cannot be charged yet.
                </p>
              )}
              {money.unpricedEdges > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  {money.unpricedEdges} row{money.unpricedEdges !== 1 ? "s name" : " names"} edges
                  its shape does not have — a circle has one ring and a rectangle four sides, so
                  the two halves of {money.unpricedEdges !== 1 ? "those rows" : "that row"} contradict
                  each other. Re-pick the edges on the purchase-order row.
                </p>
              )}
              {money.unpricedShape > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  {money.unpricedShape} row{money.unpricedShape !== 1 ? "s are" : " is"} an L, a curve or a
                  custom outline. There is no perimeter formula for {money.unpricedShape !== 1 ? "those" : "that"} here,
                  so the hand polish is quoted by hand — {money.unpricedShape !== 1 ? "their" : "its"} sink,
                  if any, is already in the total above.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CeoOverviewBoard({
  slabWastage, pricingRows = [],
}: {
  slabWastage: CeoSlabWastage[];
  pricingRows?: PricingRow[];
}) {
  const projects = useMemo(() => groupByProject(slabWastage), [slabWastage]);
  const totals = useMemo(() => overviewTotals(projects), [projects]);

  // Price every row once, then hand each project its own.
  const pricedByProject = useMemo(() => {
    const map = new Map<string, Priced[]>();
    for (const r of pricingRows) {
      const priced = priceRow({
        lengthIn: r.lengthIn, widthIn: r.widthIn, quantity: r.quantity,
        sinkQuantity: r.sinkQuantity, thicknessMm: r.thicknessMm,
        edges: parseEdges(r.finishedEdges),
        shape: r.shapeType,
        edgeFace: r.edgeFaces,
      });
      const list = map.get(r.projectCode) ?? [];
      list.push({ ...r, priced });
      map.set(r.projectCode, list);
    }
    return map;
  }, [pricingRows]);

  const grandTotal = useMemo(
    () => sumPricing([...pricedByProject.values()].flat().map(r => r.priced)),
    [pricedByProject],
  );

  return (
    <div className="space-y-5">
      {/* ---- THE TILES, AT THE TOP ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Projects" value={totals.projectCount} note={`${totals.slabCount} slabs assigned`} />
        <Tile label="Total Pieces" value={totals.pieceCount} note="on assigned slabs" tone="good" />
        <Tile
          label="Avg Wastage"
          value={`${totals.wastePct}%`}
          note={`${totals.wasteSqft} of ${totals.slabAreaSqft} sqft`}
          tone="warn"
        />
        <Tile
          label={`High Waste >${HIGH_WASTE_PCT}%`}
          value={totals.highWasteSlabs}
          note={totals.highWasteSlabs === 0 ? "nothing over the line" : "slabs to look at"}
          tone={totals.highWasteSlabs > 0 ? "bad" : "plain"}
        />
        <Tile
          label="Fabrication Charge"
          value={formatRupees(grandTotal.total)}
          note={`${grandTotal.runningFeet} run ft · ${grandTotal.sinkPieces} sinks`}
          tone="money"
        />
      </div>

      {/* Avg Wastage is AREA-WEIGHTED. Said out loud because the old tile was a
          mean of the slabs' percentages, and the two only agree while every slab
          is the same size — see lib/fab/ceoOverview.ts. */}
      {totals.wastePct !== totals.meanSlabWastePct && (
        <p className="text-[11px] text-slate-400 -mt-3">
          Wastage is weighted by area ({totals.wastePct}%). The unweighted mean of the
          slabs&rsquo; own percentages is {totals.meanSlabWastePct}%.
        </p>
      )}

      {/* ---- PROJECTS, COLLAPSED ---- */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-900">By project</h2>
          <span className="text-xs text-slate-400">worst wastage first &middot; click to open</span>
        </div>
        {projects.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">
            No slabs assigned yet.
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <ProjectRow key={p.projectCode} project={p} rows={pricedByProject.get(p.projectCode) ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
