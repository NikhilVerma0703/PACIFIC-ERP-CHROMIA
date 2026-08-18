import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Badge, Empty } from "@/components/ui";
import { getSiloLedger, getRmOptions } from "@/lib/siloCorrection";
import { classifySilo, isCorrectableSilo } from "@/lib/siloClass";
import { canRectify, isManager } from "@/lib/rbac";
import { SiloCorrect } from "@/components/SiloCorrect";
import { WriteOffDeficit } from "@/components/WriteOffDeficit";
import { openSiloDeficit, WRITE_OFF_AFTER_HOURS } from "@/lib/backfill";

export const dynamic = "force-dynamic";

export default async function SiloTimeline({ params }: { params: Promise<{ siloNo: string }> }) {
  const { siloNo: raw } = await params;
  const siloNo = decodeURIComponent(raw);
  const kind = classifySilo(siloNo);
  const [ledger, rmOptions, mayEdit, deficit, canWriteOff] = await Promise.all([getSiloLedger(siloNo), isCorrectableSilo(siloNo) ? getRmOptions(siloNo) : Promise.resolve([]), canRectify(), openSiloDeficit(siloNo), isManager()]);
  if (!ledger) notFound();

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/live" className="text-sm text-brand hover:underline">← Live status</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Silo {siloNo} · timeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Every bag dumped into this silo in FIFO order, what each one fed downstream, and a correction tool that fixes a mistake at one point and ripples the change forward — previewed before anything is written.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={kind === "grit" ? "brand" : kind === "filler" ? "amber" : "red"}>{kind === "grit" ? "Grit silo" : kind === "filler" ? "Filler silo" : "Out of scope"}</Badge>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Bags", ledger.bags.length], ["Dumped", `${Math.round(ledger.totalDumped).toLocaleString("en-IN")} kg`], ["In stock now", `${Math.round(ledger.totalRemaining).toLocaleString("en-IN")} kg`], ["Cycles fed", ledger.drawCount]].map(([l, v]) => (
          <Card key={String(l)} className="py-3"><div className="text-xs text-gray-400">{l}</div><div className="text-lg font-semibold text-gray-900">{v}</div></Card>
        ))}
      </div>

      {deficit && <WriteOffDeficit kind="silo" no={siloNo} deficitKg={deficit.kg} droughtHours={deficit.droughtHours} afterHours={WRITE_OFF_AFTER_HOURS} mayEdit={canWriteOff} />}

      {!isCorrectableSilo(siloNo) ? (
        <Empty>Corrections are available for the 16 grit silos and 4 filler silos. This silo ({siloNo}) is outside that scope.</Empty>
      ) : ledger.bags.length === 0 ? (
        <Empty>No bags recorded in silo {siloNo} yet.</Empty>
      ) : (
        <SiloCorrect siloNo={siloNo} bags={ledger.bags} rmOptions={rmOptions} mayEdit={mayEdit} />
      )}
    </Shell>
  );
}
