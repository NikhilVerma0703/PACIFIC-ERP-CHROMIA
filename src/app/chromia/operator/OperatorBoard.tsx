"use client";

// The floor screen. One slab, one tap, one event written.
//
// Deliberately not a form with a stage dropdown: the stage a slab goes to is
// never a choice — canAdvance allows exactly one — so the button names it. A
// dropdown here is an invitation to pick the stage you are standing at rather
// than the one that comes next, which is how a slab ends up with no record that
// priming ever happened.

import { useState, useTransition } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import {
  advanceStage, finishProcessing, recordQc, startProcessing,
} from "@/lib/chromia/actions";
import {
  nextStage, STAGE_LABEL, STATUS_LABEL,
  type ProcessStage, type SlabStatus,
} from "@/lib/chromia/process";

export interface OperatorSlab {
  id: string;
  slabNo: string;
  batchNo: string;
  status: string;
  currentStage: string | null;
  cycleNumber: number;
  recalibrationCount: number;
  location: string | null;
}

const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

export function OperatorBoard({
  slabs, canGrade,
}: {
  slabs: OperatorSlab[];
  canGrade: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    start(async () => {
      const r = await fn();
      setNote({ id, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "That did not work."), ok: r.ok });
    });
  };

  if (!slabs.length) {
    return (
      <Card>
        <Empty>
          Nothing on the line. Slabs appear here once they are received, and again when they come
          back from recalibration.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {slabs.map((s) => {
        const stage = s.currentStage as ProcessStage | null;
        const next = stage ? nextStage(stage) : null;
        const inProcess = s.status === "IN_PROCESS";
        const awaitingQc = s.status === "UNDER_INSPECTION";
        const showing = open === s.id;

        return (
          <Card key={s.id}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{s.slabNo}</span>
                  <Badge tone={inProcess ? "brand" : awaitingQc ? "amber" : "green"}>
                    {STATUS_LABEL[s.status as SlabStatus] ?? s.status}
                  </Badge>
                  {s.recalibrationCount > 0 && (
                    <Badge tone="amber">cycle {s.cycleNumber}</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Batch {s.batchNo}
                  {stage ? ` · at ${STAGE_LABEL[stage]}` : " · not started"}
                  {s.location ? ` · ${s.location}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {!inProcess && !awaitingQc && (
                  <button
                    type="button" disabled={pending} className={btn}
                    onClick={() => run(s.id, () => startProcessing(s.id))}
                  >
                    Stamp in
                  </button>
                )}

                {inProcess && next && next !== "QUALITY_CHECK" && (
                  // The button names the only stage this slab can go to.
                  <button
                    type="button" disabled={pending} className={btn}
                    onClick={() => run(s.id, () => advanceStage(s.id, next))}
                  >
                    → {STAGE_LABEL[next]}
                  </button>
                )}

                {inProcess && (
                  <button
                    type="button" disabled={pending} className={btnGhost}
                    onClick={() => run(s.id, () => finishProcessing(s.id))}
                    title="Ends the processing window and sends the slab to QC"
                  >
                    Stamp out → QC
                  </button>
                )}

                {awaitingQc && canGrade && (
                  <button
                    type="button" className={btnGhost}
                    onClick={() => setOpen(showing ? null : s.id)}
                  >
                    {showing ? "Cancel" : "Record QC"}
                  </button>
                )}
                {awaitingQc && !canGrade && (
                  <span className="py-2 text-xs text-gray-400">waiting for an inspector</span>
                )}
              </div>
            </div>

            {showing && canGrade && (
              <QcPanel
                pending={pending}
                onSubmit={(verdict, grade, notes) =>
                  run(s.id, async () => {
                    const r = await recordQc(s.id, { verdict, grade, notes });
                    if (r.ok) setOpen(null);
                    return r;
                  })
                }
              />
            )}

            {note?.id === s.id && (
              <p className={`mt-2 text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>
                {note.text}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Verdict and grade together, because on the floor they are one decision: an
 *  inspector who has decided a slab is grade C has already decided it failed. */
function QcPanel({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (
    verdict: "PASS" | "CONDITIONAL_PASS" | "FAIL",
    grade: "A" | "B" | "C",
    notes: string,
  ) => void;
}) {
  const [verdict, setVerdict] = useState<"PASS" | "CONDITIONAL_PASS" | "FAIL">("PASS");
  const [grade, setGrade] = useState<"A" | "B" | "C">("A");
  const [notes, setNotes] = useState("");

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Verdict</span>
          <select
            value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="PASS">Pass</option>
            <option value="CONDITIONAL_PASS">Conditional pass</option>
            <option value="FAIL">Fail</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Grade</span>
          <select
            value={grade} onChange={(e) => setGrade(e.target.value as typeof grade)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="A">A — Premium</option>
            <option value="B">B — Standard</option>
            <option value="C">C — Rejected</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Notes</span>
          <input
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="what you saw"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Grade A goes to dispatch or stock · B to stock or sample cutting · C to recalibration or
        waste. What happens next is chosen on the slab afterwards.
      </p>
      <button
        type="button" disabled={pending} className={`${btn} mt-3`}
        onClick={() => onSubmit(verdict, grade, notes)}
      >
        {pending ? "Saving…" : "Save QC"}
      </button>
    </div>
  );
}
