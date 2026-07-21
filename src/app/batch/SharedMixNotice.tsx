// Evidence panel for a mixer run shared by several line batches (see lib/mixerSharing).
// READ-ONLY on purpose: it states the case and asks for a human decision. Nothing is
// re-allocated until the production manager confirms, the same way a design fix works.
// Every sentence here must be backed by something the detector actually computed.
import type { SharedMixReport } from "@/lib/mixerSharing";
import { ConfirmMixSplit } from "./ConfirmMixSplit";

const kg = (n: number) => Math.round(n).toLocaleString("en-IN");
const pc = (n: number | null) => (n == null ? "not computable" : `${n.toFixed(1)}%`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200/70 bg-white/70 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-amber-700/80">{label}</div>
      <div className="mt-1 text-sm text-gray-800">{children}</div>
    </div>
  );
}

export function SharedMixNotice({ r, mayFix = false, batch = "", split = false }: { r: SharedMixReport; mayFix?: boolean; batch?: string; split?: boolean }) {
  const others = r.partners.join(", ");
  const all = r.partners.length === 1 ? "both" : `all ${r.partners.length + 1}`;
  const preview = r.runs.slice(0, 10).map((x) => `${x.batch}×${x.n}`).join(" · ");
  const more = r.runs.length > 10 ? " …" : "";
  const perBatch = Object.entries(r.runsPerBatch).map(([b, n]) => `${b} ${n}×`).join(", ");

  return (
    <div className="space-y-3 rounded-2xl border border-amber-300/70 bg-amber-50/60 p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          Shared mixer run — needs confirmation
        </h2>
        {r.confident && (
          <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-medium text-amber-900">strong evidence</span>
        )}
      </div>

      <p className="text-sm text-amber-900">
        This batch&apos;s slabs alternate with <b>{others}</b> inside one stretch of slab numbers
        {r.confident
          ? <>, and {r.noMixMember === r.key ? "this batch" : r.noMixMember} pressed slabs from a mix it has no cycles for — so <b>one mixer run fed {all}</b>.</>
          : <>, which usually means one mixer run fed {all}. The evidence is suggestive rather than conclusive here.</>}{" "}
        {r.ownCycles === 0
          ? <>This batch has no mixer cycles of its own — the material is all stamped to {others}.</>
          : <>{r.ownCycles} {r.ownCycles === 1 ? "cycle is" : "cycles are"} stamped to this batch{r.partnerCycles === 0 ? <>, while {others} {r.partners.length === 1 ? "has" : "have"} none at all</> : null}.</>}{" "}
        {split
          ? <>The split has been confirmed, so the wastage on this page now reads from it — per batch, by slab-mass share of each shared cycle.</>
          : <>Either way the wastage below cannot be read for these batches separately.</>}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Slab pattern">
          <b>{r.runCount} alternating runs</b>{perBatch ? <span className="text-gray-600"> ({perBatch})</span> : null}
          <div className="mt-0.5 text-xs text-gray-600">{preview}{more}</div>
          <div className="mt-1 text-[11px] text-gray-500">
            {r.source === "line head"
              ? <>Read from the line head (Distributor/Kreos), which owns each slab&apos;s true batch.</>
              : <>Read from press — this batch has no line-head rows, so mis-typed press entries can&apos;t be ruled out here.</>}{" "}
            Slab numbers are stamped in physical order, so this holds however late the rows were entered.
          </div>
        </Row>
        <Row label="Material reconciliation">
          <div>This batch alone: <b>{pc(r.alone.wastagePct)}</b></div>
          <div className="mt-0.5 text-xs text-gray-600">{kg(r.alone.mixKg)} kg in · {kg(r.alone.slabKg)} kg out</div>
          <div className="mt-1">With {others}: <b className="text-green-700">{pc(r.combined.wastagePct)}</b></div>
          <div className="mt-0.5 text-xs text-gray-600">{kg(r.combined.mixKg)} kg in · {kg(r.combined.slabKg)} kg out</div>
        </Row>
        <Row label="Mixer">
          <div><b>{r.mixer.cycles}</b> {r.mixer.cycles === 1 ? "cycle" : "cycles"} across these batches</div>
          <div className="mt-0.5 text-xs text-gray-600">
            {r.mixer.maxGapH == null
              ? "Not enough cycle times recorded to measure the pauses."
              : r.mixer.ranContinuously
                ? `Ran continuously — longest pause only ${r.mixer.maxGapH.toFixed(1)} h, too short to clean out between batches.`
                : `Longest pause ${r.mixer.maxGapH.toFixed(1)} h — long enough for a wash-out, but the line also pauses for breaks and shift changes, so this neither confirms nor rules out a real batch change.`}
          </div>
        </Row>
      </div>

      <p className="text-xs text-amber-900/80">
        <b>Nothing has been changed.</b> Confirm with the production manager that these batches came off one mix
        before the cycles are split across them — the same check you do for a design.
      </p>

      {/* The split itself is only offered on strong evidence, to people who may rectify
          FROM THIS BRANCH — mixSplitActions gates on rank AND Shop Floor, so offering it
          to an Office incharge would just announce a confirm the action then refuses. The
          evidence above is unconditional; only the button is conditional. */}
      {r.confident && batch && (mayFix
        ? <ConfirmMixSplit batch={batch} />
        : <p className="text-xs text-amber-900/80">The evidence is strong enough to act on — an incharge on the Shop Floor branch can confirm the split.</p>)}
    </div>
  );
}
