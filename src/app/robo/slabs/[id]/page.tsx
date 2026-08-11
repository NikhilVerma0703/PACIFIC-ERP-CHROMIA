import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { slabStatusClass, slabStatusLabel } from "@/lib/robo/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slab Details | Pacific ERP" };

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];
const MACHINE_COLORS: Record<string, string> = {
  "Roycut-1": "bg-blue-500", "Roymix": "bg-emerald-500",
  "Roycut-2": "bg-indigo-500", "Roycut-3": "bg-violet-500",
};

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : String(v);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-1.5 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="break-words text-right text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export default async function SlabCompleteDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: {
      shift: true,
      batchRecipe: { include: { entries: { include: { machine: true } } } },
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!record) notFound();

  const setup = record.batchRecipe;
  const entries = [...(setup?.entries ?? [])].sort(
    (a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name)
  );
  const totalDelay = record.delayLogs.reduce((s, d) => s + d.durationMinutes, 0);

  return (
    <Shell>
      <div className="max-w-4xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/robo/slabs" className="text-sm text-gray-400 hover:text-gray-600">← Slabs Records</Link>
              <span className="text-gray-300">/</span>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slab {record.slabNumber}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${slabStatusClass(record.status)}`}>
                {slabStatusLabel(record.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Complete details for this slab</p>
          </div>
        </div>

        {/* ── 1. Shift Information ── */}
        <SectionCard title="1. Shift Information">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Field label="Production Date" value={dash(record.shift?.date)} />
            <Field label="Shift Number" value={dash(record.shift?.shiftNumber)} />
            <Field label="Start Time" value={dash(record.shift?.startTime)} />
            <Field label="Operator Name" value={dash(record.shift?.operatorName)} />
          </div>
        </SectionCard>

        {/* ── 2. Production Information ── */}
        <SectionCard title="2. Production Information" subtitle={setup ? undefined : "No production setup was linked to this slab"}>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Production Info</h3>
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                <Field label="Design Name" value={dash(setup?.designName)} />
                <Field label="Slab Thickness (cm)" value={setup?.thickness ? String(setup.thickness) : "-"} />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Machine Configuration</h3>
              {entries.length === 0 ? (
                <p className="text-sm text-gray-400">-</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {entries.map(e => {
                    const isRoymix = e.machine.name === "Roymix";
                    const isRoycut3 = e.machine.name === "Roycut-3";
                    const fields = isRoymix
                      ? [
                          { label: "Program Name", value: dash(e.programName) },
                          { label: "Liquid Name", value: dash(e.liquidName) },
                          { label: "Body Weight (kg)", value: record.roymixBodyWeight != null ? String(record.roymixBodyWeight) : "-" },
                          { label: "Cycle Time (sec)", value: record.roymixCycleTime != null ? String(record.roymixCycleTime) : "-" },
                        ]
                      : [
                          { label: "Program Name", value: dash(e.programName) },
                          { label: "Tool Name", value: dash(e.toolName) },
                          { label: "Target Cycle Time (sec)", value: e.targetCycleTime != null ? String(e.targetCycleTime) : "-" },
                          { label: "Liquid Name", value: dash(e.liquidName) },
                          { label: "Powder Name", value: dash(e.powderName) },
                          ...(isRoycut3 ? [] : [{ label: "Roller Height (mm)", value: dash(e.rollerHeight) }]),
                        ];
                    return (
                      <div key={e.id} className="rounded-lg border border-gray-100 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <span className={`h-5 w-2 rounded-full ${MACHINE_COLORS[e.machine.name] || "bg-gray-400"}`} />
                          <p className="font-semibold text-gray-800">{e.machine.name}</p>
                        </div>
                        {fields.map(f => <Field key={f.label} label={f.label} value={f.value} />)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Slab Information ── */}
        <SectionCard title="3. Slab Information">
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Field label="S.No." value={dash(record.serialNumber)} />
            <Field label="Slab Number" value={dash(record.slabNumber)} />
            <Field label="In Time" value={dash(record.inTime)} />
            <Field label="Out Time" value={dash(record.outTime)} />
          </div>
        </SectionCard>

        {/* ── 4. Remark ── */}
        <SectionCard title="4. Remark" subtitle={record.delayLogs.length > 0 ? `${record.delayLogs.length} delay(s) · ${totalDelay} min total` : undefined}>
          {record.delayLogs.length === 0 && !record.remarks?.trim() ? (
            <p className="text-sm text-gray-500">-</p>
          ) : (
            <div className="space-y-3">
              {record.delayLogs.length > 0 && (
                <div className="space-y-2">
                  {record.delayLogs.map(d => (
                    <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-2">
                      <span className="w-10 text-xs font-bold text-red-700">{d.delayCode.code}</span>
                      <span className="min-w-[8rem] flex-1 text-sm text-gray-700">{d.delayCode.description}</span>
                      {d.machineName && <span className="text-xs text-gray-500">{d.machineName}</span>}
                      {d.startTime && d.endTime && <span className="text-xs text-gray-400">{d.startTime}–{d.endTime}</span>}
                      <span className="text-xs font-medium text-red-600">{d.durationMinutes} min</span>
                      {d.remarks && <span className="w-full text-xs text-gray-500">{d.remarks}</span>}
                    </div>
                  ))}
                </div>
              )}
              {record.remarks?.trim() && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">Slab Remark</p>
                  <p className="text-sm text-gray-700">{record.remarks}</p>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </Shell>
  );
}
