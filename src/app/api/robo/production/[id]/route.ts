import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canDeleteRoboSlab } from "@/lib/rbac";
import { logActionTx } from "@/lib/actionLog";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: {
      batchRecipe: { include: { design: true, program: true, entries: { include: { machine: true } } } },
      shift: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

/**
 * DELETE /api/robo/production/[id] — permanently removes one slab record and
 * the delays logged against it. The shift, its batch setup and every other
 * slab are left untouched.
 *
 * ADMIN only; see canDeleteRoboSlab() in src/lib/rbac.ts for why the ROBO
 * tablet does not get this. The check lives HERE and not in middleware
 * because middleware matches on path prefix and cannot distinguish DELETE
 * from the GET the same operator legitimately makes.
 */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await canDeleteRoboSlab())) {
    return NextResponse.json(
      { error: "Only an administrator can delete a slab record. Edit it instead — every slab, in any shift, stays editable." },
      { status: 403 },
    );
  }

  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: { delayLogs: true },
  });
  if (!record) return NextResponse.json({ error: "Slab record not found." }, { status: 404 });

  const { delayLogs, ...slab } = record;

  // One transaction, and the audit entry is INSIDE it (logActionTx, not the
  // best-effort logAction): a delete with no undo and no trail is the one
  // write that must not outlive its record of itself. If the log can't be
  // written the slab is not deleted either.
  //
  // The payload is shaped for actionLog's own `delete` reversal — parent row
  // first, then its children, so a restore re-creates the slab before the
  // delay logs that point at it. Nothing in the UI offers this undo today
  // (every undo call site is scoped to a batchKey, and this entry has none),
  // but it means the deleted rows are recoverable verbatim rather than gone.
  await prisma.$transaction(async (tx) => {
    await tx.roboDelayLog.deleteMany({ where: { productionRecordId: id } });
    await tx.roboProductionRecord.delete({ where: { id } });
    await logActionTx(tx, {
      kind: "delete",
      model: "RoboProductionRecord",
      summary: `Deleted robo slab ${record.slabNumber}${delayLogs.length ? ` and its ${delayLogs.length} delay log(s)` : ""}`,
      payload: {
        groups: [
          { model: "RoboProductionRecord", records: [slab] },
          { model: "RoboDelayLog", records: delayLogs },
        ],
      },
    });
  });

  return NextResponse.json({
    ok: true,
    slabNumber: record.slabNumber,
    deletedDelayLogs: delayLogs.length,
  });
}

/**
 * PATCH /api/robo/production/[id] — update an existing slab in place.
 * Supplying an Out Time moves the slab from In-Processing to Completed.
 * `delays` appends new delay logs; existing ones are left untouched.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};

  // A slab may be renumbered, but not onto a number another record already
  // holds. Enforced here and not only in the form because this endpoint is
  // reachable without it — and because the slab number is how a slab is found
  // again, so two records sharing one makes the search screen lie.
  if (body.slabNumber !== undefined) {
    const slabNumber = String(body.slabNumber ?? "").trim();
    if (!slabNumber) return NextResponse.json({ error: "Slab number is required." }, { status: 400 });
    const clash = await prisma.roboProductionRecord.findFirst({
      where: { slabNumber, NOT: { id } },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: "Duplicate Slab No. — this slab number already exists." },
        { status: 409 },
      );
    }
    data.slabNumber = slabNumber;
  }
  // S.No. is the register's row number for the slab. The entry form has always
  // sent it on save, but no handler ever read it, so correcting a wrong S.No.
  // silently did nothing — the field appeared editable and was not.
  if (body.serialNumber !== undefined) {
    data.serialNumber = body.serialNumber === null || body.serialNumber === "" ? null : Number(body.serialNumber);
  }
  if (body.remarks !== undefined)          data.remarks = body.remarks || null;
  if (body.inTime !== undefined)           data.inTime = body.inTime || null;
  if (body.outTime !== undefined)          data.outTime = body.outTime || null;
  if (body.roymixCycleTime !== undefined)  data.roymixCycleTime = body.roymixCycleTime ? Number(body.roymixCycleTime) : null;
  if (body.roymixBodyWeight !== undefined) data.roymixBodyWeight = body.roymixBodyWeight ? Number(body.roymixBodyWeight) : null;

  if (body.status !== undefined) {
    data.status = body.status;
  } else if (body.outTime !== undefined) {
    data.status = body.outTime ? SLAB_COMPLETED : SLAB_IN_PROCESSING;
  }

  // One transaction: the slab update and its appended delay logs land together
  // or not at all, so a mid-write failure can't leave a half-saved edit.
  const record = await prisma.$transaction(async (tx) => {
    const rec = await tx.roboProductionRecord.update({ where: { id }, data });
    if (Array.isArray(body.delays) && body.delays.length > 0) {
      await tx.roboDelayLog.createMany({
        data: body.delays.map((d: { delayCodeId: string; machineId?: string; machineName?: string; durationMinutes: number; startTime?: string; endTime?: string; remarks?: string }) => ({
          shiftId:            rec.shiftId,
          productionRecordId: rec.id,
          machineId:          d.machineId || null,
          machineName:        d.machineName || null,
          delayCodeId:        d.delayCodeId,
          durationMinutes:    Number(d.durationMinutes),
          startTime:          d.startTime || null,
          endTime:            d.endTime || null,
          remarks:            d.remarks || null,
        })),
      });
    }
    return rec;
  });

  return NextResponse.json(record);
}
