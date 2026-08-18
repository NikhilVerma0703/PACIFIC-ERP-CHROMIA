"use client";
// The maintenance manager's DELAY-TYPE CORRECTION, and the mark it leaves behind.
// One component, one screen today: the Breakdown & deviation log
// (src/app/mis/DowntimeLogCard.tsx, via DowntimeRespond). It used to render on a
// second card too — the MIS hourly log, since merged into that table — and the rule
// that kept it a single component stands for the same reason it was written: two
// hand-written copies of a control that edits an incentive input is how two screens
// end up enforcing different rules, and the screen with the weaker one becomes the
// way in.
//
// WHAT IT IS FOR. The production incharge fills the MIS form and books the stoppage
// under the wrong delay type — most often charging maintenance for what was really a
// cleaning changeover. The four buckets ARE the downtime totals, the chips, the charts
// and the uptime score, so the fix has to be a real correction of the Mis row.
//
// HOW IT DIFFERS FROM THE DISPUTE SITTING NEXT TO IT. The dispute (DowntimeRespond,
// amber) records maintenance's own DURATION beside production's and changes nothing;
// it answers "we disagree about how long it was". This answers "those minutes are in
// the wrong bucket" and rewrites the row. Both stay available, and they are kept
// visually apart on purpose — amber for the open argument, violet for the applied
// correction. Reusing one colour for both would make a settled row look unresolved.
//
// WHY THE MARK MATTERS AS MUCH AS THE CONTROL. src/lib/shiftScore.ts ranks the
// electrical and mechanical incharges on uptime computed from the breakdown and
// power-out minutes, so moving minutes OUT of breakdown raises the maintenance team's
// own payout. Every corrected figure therefore carries the violet mark, the ⇄ glyph and
// a hover line naming who moved what, when and why — the mark is never colour alone,
// because a colour-only signal is invisible to a colour-blind reader and gone entirely
// in a printout, and this is the one signal an argument about a payout turns on.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reclassifyDelay } from "@/app/mis/actions";
import { DELAY_FIELDS, DELAY_LABEL, fmtDur } from "@/lib/downtimeShared";
// The rules, the colour and the wording all come from the one pure module — the same
// one the server action validates with and `node --test` exercises. It imports
// downtimeShared with an explicit .ts extension so the test runner can reach it
// without a build step; that resolves in the bundler too, because the file is there.
import {
  DELAY_KEYS, RECLASS_TONE,
  describeReclass, originalBuckets, reconstructionSound,
  planReclass, validateReclassReason,
  type DelayKey, type ReclassRecord, type ReclassMark,
} from "@/lib/delayReclass";

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

/** The badge itself: glyph + word + colour, in that order of importance. `title`
 *  carries every move on the hour, so the "why is this violet?" question is answered
 *  by hovering the thing that is violet rather than by hunting for a legend. */
export function ReclassBadge({ mark, className = "" }: { mark: ReclassMark; className?: string }) {
  if (mark.count === 0) return null;
  return (
    <span
      title={mark.tooltip}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium ${RECLASS_TONE.badge} ${className}`}
    >
      ⇄ {mark.label}
    </span>
  );
}

/** Marks ONE figure — the number that actually moved — rather than the whole row.
 *  A row-level highlight would say "something here was corrected" and leave the reader
 *  comparing four figures to find out which; this puts the signal on the digit. */
export function reclassFigureClass(mark: ReclassMark, key: string): string {
  return mark.netByType[key as DelayKey] ? `font-semibold ${RECLASS_TONE.text}` : "";
}

/** Hover text for one corrected figure: what it used to be, when that can honestly be
 *  reconstructed. Production can edit their MIS entry AFTER a correction, and then the
 *  reconstruction is only "today's figure minus maintenance's moves" — never a state
 *  that existed. reconstructionSound() is the tell, and when it fails this says so
 *  instead of printing a confident wrong number. */
export function reclassFigureTitle(
  mark: ReclassMark,
  key: string,
  minutesByType: Record<string, number>,
  records: readonly ReclassRecord[],
): string | undefined {
  const net = mark.netByType[key as DelayKey];
  if (!net) return undefined;
  const before = originalBuckets(minutesByType, records);
  const head = reconstructionSound(before)
    ? `Was ${fmtDur(before[key as DelayKey])} before maintenance corrected it.`
    : "The MIS row was edited after this correction, so the earlier figure cannot be reconstructed.";
  return `${head}\n${mark.tooltip}`;
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

export interface ReclassifyDelayProps {
  misId: string;
  /** Whether THIS viewer may correct THIS load. False both for a viewer without the
   *  right (the mark still renders — everyone who can read the log can see that the
   *  hour was corrected) and for a load whose reclass log failed to read, where a
   *  second correction could be stacked on a first one nobody could see. */
  canReclass: boolean;
  /** The hour as it stands now, per delay key. This is the CURRENT Mis row, i.e. it
   *  already includes every correction in `records`. */
  minutesByType: Record<string, number>;
  /** Every correction applied to this hour, oldest first. */
  records: readonly ReclassRecord[];
  /** Render the moves as text under the badge, for a host with the width for it;
   *  otherwise they live in the badge's tooltip only. (The merged downtime log keeps
   *  its response column narrow, so no current caller sets this — kept because the
   *  rendering is tested behaviour and the next wide host will want it back.) */
  showLines?: boolean;
}

const firstWithMinutes = (m: Record<string, number>): DelayKey => {
  // Default the source to the bucket the argument is usually about, but only if it
  // actually holds minutes — offering "breakdown" on an hour with none makes the first
  // thing the manager sees a refusal.
  if ((m.breakdown ?? 0) > 0) return "breakdown";
  const held = DELAY_KEYS.find((k) => (m[k] ?? 0) > 0);
  return held ?? "breakdown";
};

export function ReclassifyDelay({ misId, canReclass, minutesByType, records, showLines = false }: ReclassifyDelayProps) {
  const mark = useMemo(() => describeReclass(records), [records]);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string>(() => firstWithMinutes(minutesByType));
  const [to, setTo] = useState<string>(() => (firstWithMinutes(minutesByType) === "cleaning" ? "breakdown" : "cleaning"));
  const [mins, setMins] = useState("");
  const [why, setWhy] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  // Live preview off the SAME pure module the server action validates with, so the
  // manager sees "cleaning holds only 10 minutes" while typing rather than after a
  // round trip. It is a courtesy, not a gate: the server re-runs every rule against
  // the row as it is at that moment, which is the only copy that can be trusted.
  const plan = useMemo(
    () => (mins.trim() === "" ? null : planReclass({ current: minutesByType, from, to, minutes: Number(mins) })),
    [minutesByType, from, to, mins],
  );

  const submit = () => {
    const reason = validateReclassReason(why);
    if (!reason.ok) { setMsg(reason.message); return; }
    if (!plan) { setMsg("Enter how many minutes to move."); return; }
    if (!plan.ok) { setMsg(plan.message); return; }
    start(async () => {
      const r = await reclassifyDelay(misId, plan.from, plan.to, plan.minutes, reason.reason);
      // The action's own words, verbatim: it validates against the live row, so its
      // refusal ("this hour only logs 10m of cleaning") is the true one even when the
      // preview above was happy with a figure that has since been edited.
      if (!r.ok) { setMsg(r.message); return; }
      setMsg(""); setMins(""); setWhy(""); setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-1">
      {mark.count > 0 && (
        <div className="space-y-0.5">
          <ReclassBadge mark={mark} />
          {showLines && (
            <ul className={`space-y-0.5 text-[10px] leading-snug ${RECLASS_TONE.text}`}>
              {mark.lines.map((l, idx) => <li key={idx}>{l}</li>)}
            </ul>
          )}
        </div>
      )}

      {canReclass && !open && (
        <button type="button" onClick={() => setOpen(true)} className={`text-[11px] font-medium hover:underline ${RECLASS_TONE.dot}`}>
          ⇄ Reclassify
        </button>
      )}

      {canReclass && open && (
        <div className={`mt-1 space-y-1.5 rounded-lg border p-2 ${RECLASS_TONE.panel}`}>
          <div className={`text-[11px] font-medium ${RECLASS_TONE.text}`}>Logged under the wrong delay type?</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Both pickers show what the hour currently holds, so the manager picks
                against the real figures instead of guessing and being refused. */}
            <select value={from} onChange={(e) => { setFrom(e.target.value); setMsg(""); }} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
              {DELAY_FIELDS.map((d) => (
                <option key={d.key} value={d.key}>from {d.label} · has {fmtDur(minutesByType[d.key] ?? 0)}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500">→</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setMsg(""); }} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
              {DELAY_FIELDS.map((d) => (
                <option key={d.key} value={d.key}>to {d.label}</option>
              ))}
            </select>
            <input
              type="number" min={1} step={1} value={mins} onChange={(e) => { setMins(e.target.value); setMsg(""); }}
              placeholder="min" className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs"
            />
          </div>
          <input
            value={why} onChange={(e) => { setWhy(e.target.value); setMsg(""); }}
            placeholder="Why? e.g. belt snapped mid-clean — required"
            className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs"
          />
          {/* The consequence, spelled out before the click and not after it. */}
          {plan && (plan.ok
            ? (
              <div className={`text-[10px] ${RECLASS_TONE.text}`}>
                {DELAY_LABEL[plan.from]} {fmtDur(plan.before[plan.from])} → {fmtDur(plan.next[plan.from])} ·{" "}
                {DELAY_LABEL[plan.to]} {fmtDur(plan.before[plan.to])} → {fmtDur(plan.next[plan.to])} · hour total unchanged at {fmtDur(plan.total)}
              </div>
            )
            : <div className="text-[10px] text-red-600">{plan.message}</div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={submit} className="rounded bg-violet-700 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">
              {pending ? "Moving…" : "Move minutes"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setMsg(""); }} className="text-[11px] text-gray-500 hover:underline">Cancel</button>
            {msg && <span className="text-[11px] text-red-600">{msg}</span>}
          </div>
          <div className="text-[10px] text-gray-500">
            This corrects the MIS row itself — totals, charts and the uptime score follow it. The hour&apos;s total stays the same, and the move is logged against your name.
          </div>
        </div>
      )}
    </div>
  );
}
