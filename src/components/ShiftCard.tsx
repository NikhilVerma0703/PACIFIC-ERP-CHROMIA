// One shift instance, as the MIS page has always drawn it. Extracted from that
// page so the scoreboard shows the SAME card rather than a second version that
// can drift from it.
import { Card, H2, Badge, fmt } from "@/components/ui";
import { fmtDur } from "@/lib/downtime";
import type { LastShiftReport } from "@/lib/misShift";

export const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
    <div className="mt-0.5 font-semibold text-gray-900">{children}</div>
  </div>
);

export function ShiftCard({ s, title, live = false, extra }: {
  s: LastShiftReport; title: string; live?: boolean;
  /** Optional trailing row — the scoreboard hangs its score fields here. */
  extra?: React.ReactNode;
}) {
  const graded = s.gradeA + s.gradeB + s.gradeC;
  return (
    <Card className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <H2>{title}</H2>
        <Badge tone="brand">Shift {s.shift} · {s.date} · {s.window}</Badge>
        {live && <Badge tone="amber">in progress · {s.hoursLogged}/{s.hoursTotal} hrs logged</Badge>}
      </div>
      {/* Press line — everything here describes what came off the press. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <F label="Production incharge">
          {s.prodIncharge ?? (s.submitters.length ? s.submitters.join(", ") : "—")}
          {!s.prodIncharge && s.submitters.length > 0 && <div className="text-[11px] font-normal text-gray-400">from who submitted the entries</div>}
        </F>
        <F label="Electrical incharge">{s.elecIncharge ?? "—"}</F>
        <F label="Mechanical incharge">{s.mechIncharge ?? "—"}</F>
        <F label="Hours logged">{s.hoursLogged}/{s.hoursTotal}</F>
        <F label="Slabs pressed">{fmt(s.slabs)}</F>
        <F label="Downtime">
          <span className={s.delayMin > 0 ? "text-amber-700" : ""}>{s.delayMin > 0 ? fmtDur(s.delayMin) : "none"}</span>
        </F>
        <F label="Batch / design pressed">{[...s.batches, ...s.designs].slice(0, 4).join(", ") || "—"}</F>
      </div>

      {/* Polish line — kept separate on purpose. Polish runs behind the press, so
          these slabs are usually a different batch from the one being pressed. */}
      <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-gray-100 pt-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <F label="Slabs polished">{fmt(s.polished)}</F>
        <F label="Grade A">{fmt(s.gradeA)}</F>
        <F label="Grade B">{fmt(s.gradeB)}</F>
        <F label="Grade C">{fmt(s.gradeC)}</F>
        <div className="col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Last polished batch / design</div>
          <div className="mt-0.5 font-semibold text-gray-900">
            {[s.lastPolishedBatch, s.lastPolishedDesign].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      </div>

      {extra}

      {s.polished > 0 && graded < s.polished && (
        <p className="mt-3 text-xs text-gray-400">{fmt(s.polished - graded)} of {fmt(s.polished)} polished slabs are ungraded or graded A2/CTS/Printing.</p>
      )}
      {s.areas.length > 0 && <p className="mt-3 text-xs text-amber-700">Problem areas: {s.areas.join(", ")}</p>}
    </Card>
  );
}
