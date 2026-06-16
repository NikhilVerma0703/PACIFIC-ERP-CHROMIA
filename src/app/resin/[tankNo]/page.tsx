import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Badge, Empty } from "@/components/ui";
import { getResinLedger } from "@/lib/resinCorrection";
import { canRectify } from "@/lib/rbac";
import { ResinCorrect } from "@/components/ResinCorrect";
import { WriteOffDeficit } from "@/components/WriteOffDeficit";
import { openTankDeficit, WRITE_OFF_AFTER_HOURS } from "@/lib/backfill";

export const dynamic = "force-dynamic";

export default async function ResinTimeline({ params }: { params: Promise<{ tankNo: string }> }) {
  const { tankNo: raw } = await params;
  const tankNo = decodeURIComponent(raw);
  const [ledger, mayEdit, deficit] = await Promise.all([getResinLedger(tankNo), canRectify(), openTankDeficit(tankNo)]);
  if (!ledger) notFound();

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/live" className="text-sm text-brand hover:underline">← Live status</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Resin tank {tankNo} · timeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Every daily resin prep in FIFO order, the cycles each one fed, and a correction tool that fixes a mistake at one point and ripples the change forward — previewed before anything is written.</p>
        </div>
        <Badge tone="green">Resin tank</Badge>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Preps", ledger.preps.length], ["Prepared", `${Math.round(ledger.totalPrepared).toLocaleString("en-IN")} kg`], ["In tank now", `${Math.round(ledger.totalRemaining).toLocaleString("en-IN")} kg`], ["Cycles fed", ledger.drawCount]].map(([l, v]) => (
          <Card key={String(l)} className="py-3"><div className="text-xs text-gray-400">{l}</div><div className="text-lg font-semibold text-gray-900">{v}</div></Card>
        ))}
      </div>

      {deficit && <WriteOffDeficit kind="resin" no={tankNo} deficitKg={deficit.kg} droughtHours={deficit.droughtHours} afterHours={WRITE_OFF_AFTER_HOURS} mayEdit={mayEdit} />}

      {ledger.preps.length === 0 ? <Empty>No resin preps recorded for tank {tankNo} yet.</Empty> : <ResinCorrect tankNo={tankNo} preps={ledger.preps} mayEdit={mayEdit} />}
    </Shell>
  );
}
