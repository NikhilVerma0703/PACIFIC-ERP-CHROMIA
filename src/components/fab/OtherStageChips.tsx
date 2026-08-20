import { STAGE_CHIP } from "@/lib/fab/queueActivity";

export function OtherStageChips({ otherDone, recent }: { otherDone?: string[]; recent?: boolean }) {
  if (!otherDone?.length && !recent) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {recent && (
        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
          Just in
        </span>
      )}
      {otherDone?.map(t => (
        <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
          {STAGE_CHIP[t] ?? t}
        </span>
      ))}
    </div>
  );
}

export function activityRowClass(recent?: boolean, started?: boolean, startedClass = ""): string {
  if (started) return startedClass;
  if (recent) return "bg-amber-50/80";
  return "";
}
