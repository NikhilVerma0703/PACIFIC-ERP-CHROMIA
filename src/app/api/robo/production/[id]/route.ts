import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canDeleteRoboSlab } from "@/lib/rbac";
import { logActionTx } from "@/lib/actionLog";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";
import { forwardRunIds } from "@/lib/robo/rangeUpdate";
import { productionDateOf } from "@/lib/robo/productionDate";
import { roboThicknessKey } from "@/lib/robo/thickness";

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
 *
 * PRODUCTION DATE and THICKNESS can each be applied to just this slab OR carried
 * forward across the batch. When `applyProductionDateToRange` (or
 * `applyThicknessToRange`) is set, the new value lands on this slab and every
 * following slab in the SAME batch that currently shares its value, stopping at
 * the first slab that already reads something different — see forwardRunIds. It
 * is how a run saved with one date gets corrected where it crossed midnight, or
 * one thickness where the line changed it mid-batch, without editing hundreds of
 * slabs by hand. Earlier slabs are never in the run, so nothing before the edited
 * point can move. Everything happens in one transaction.
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

  // Production Date and Thickness: parsed here, but where they LAND — this slab
  // alone, or forward across the batch — is decided in the transaction below.
  // Both hold a real value or NULL, never "" or NaN, the invariant the readers
  // and the where-builders depend on. When applied forward they are kept OUT of
  // `data` (the single-row update) and written by updateMany instead.
  const applyDateForward = body.productionDate !== undefined && Boolean(body.applyProductionDateToRange);
  const applyThicknessForward = body.thickness !== undefined && Boolean(body.applyThicknessToRange);

  let productionDate: string | null | undefined;
  if (body.productionDate !== undefined) {
    productionDate = (typeof body.productionDate === "string" && body.productionDate.trim()) || null;
    if (!applyDateForward) data.productionDate = productionDate;
  }
  let thickness: number | null | undefined;
  if (body.thickness !== undefined) {
    const n = body.thickness === null || body.thickness === "" ? null : Number(body.thickness);
    thickness = n !== null && Number.isNaN(n) ? null : n;
    if (!applyThicknessForward) data.thickness = thickness;
  }

  if (body.status !== undefined) {
    data.status = body.status;
  } else if (body.outTime !== undefined) {
    data.status = body.outTime ? SLAB_COMPLETED : SLAB_IN_PROCESSING;
  }

  // One transaction: the slab's own edits, any forward-applied range, and the
  // appended delay logs land together or not at all, so a mid-write failure
  // can't leave a half-saved edit.
  const record = await prisma.$transaction(async (tx) => {
    // 1. This slab's own single-field edits. Skipped when the only change is a
    //    ranged field, so we never send Prisma an empty update.
    if (Object.keys(data).length > 0) {
      await tx.roboProductionRecord.update({ where: { id }, data });
    }

    // 2. The slab as it now stands — its shift (for new delays) and its batch
    //    (the scope of a forward range). The ranged fields are still at their
    //    OLD values here, which is what must define the run.
    const start = await tx.roboProductionRecord.findUnique({
      where: { id },
      select: { shiftId: true, batchRecipeId: true },
    });
    if (!start) throw new Error("Slab not found");

    // 3. Forward-applied Production Date / Thickness. The run is every slab from
    //    this one onward in the batch that shares its current value; earlier
    //    slabs are never included. A slab with no batch has no run to speak of,
    //    so the value falls back to this slab alone — the edit still lands.
    if (applyDateForward || applyThicknessForward) {
      if (start.batchRecipeId) {
        const batchSlabs = await tx.roboProductionRecord.findMany({
          where: { batchRecipeId: start.batchRecipeId },
          orderBy: [{ serialNumber: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            productionDate: true,
            thickness: true,
            batchRecipe: { select: { productionDate: true, thickness: true } },
            shift: { select: { date: true } },
          },
        });
        if (applyDateForward) {
          const ids = forwardRunIds(batchSlabs, id, (s) => productionDateOf(s));
          await tx.roboProductionRecord.updateMany({ where: { id: { in: ids } }, data: { productionDate } });
        }
        if (applyThicknessForward) {
          const ids = forwardRunIds(batchSlabs, id, (s) => roboThicknessKey(s));
          await tx.roboProductionRecord.updateMany({ where: { id: { in: ids } }, data: { thickness } });
        }
      } else {
        const single: Record<string, unknown> = {};
        if (applyDateForward) single.productionDate = productionDate;
        if (applyThicknessForward) single.thickness = thickness;
        await tx.roboProductionRecord.update({ where: { id }, data: single });
      }
    }

    // 4. Delay logs — a full reconcile against the set the client sent, so the
    //    delay log is fully editable. A delay that arrives WITH an id is updated
    //    in place (change one field, or several, on an existing delay); one
    //    WITHOUT an id is created; and an existing delay whose id is NOT in the
    //    payload was removed on screen, so it is deleted. That is edit + remove +
    //    add in one pass, and because existing delays are updated rather than
    //    re-created, an edit never leaves a duplicate.
    //
    //    This runs ONLY when `delays` is actually present in the request. A PATCH
    //    that omits it (an edit to something else entirely) leaves the slab's
    //    delays exactly as they are — it never wipes them.
    //
    //    machineName carries one Robo or several, comma-joined (delayMachines.ts);
    //    machineId is the first, kept for the optional relation. The client has
    //    already computed both and the duration, so the stored shape and every
    //    delay calculation are unchanged.
    if (Array.isArray(body.delays)) {
      const items = body.delays as Array<{
        id?: string; delayCodeId: string; machineId?: string | null; machineName?: string | null;
        durationMinutes?: number; startTime?: string | null; endTime?: string | null; remarks?: string | null;
      }>;
      const keepIds = items.map((d) => d.id).filter((x): x is string => typeof x === "string" && x.length > 0);

      // Remove the delays that are gone from the payload. With nothing kept, this
      // clears them all — which is how a slab saves with no delay at all.
      await tx.roboDelayLog.deleteMany({
        where: { productionRecordId: id, ...(keepIds.length > 0 ? { NOT: { id: { in: keepIds } } } : {}) },
      });

      // Update the ones kept, create the new ones. Anything with no delay code is
      // an empty row the operator never filled — skipped, not saved as a blank.
      for (const d of items) {
        if (!d.delayCodeId) continue;
        const fields = {
          machineId:       d.machineId || null,
          machineName:     d.machineName || null,
          delayCodeId:     d.delayCodeId,
          durationMinutes: Number(d.durationMinutes) || 0,
          startTime:       d.startTime || null,
          endTime:         d.endTime || null,
          remarks:         d.remarks || null,
        };
        if (d.id) {
          await tx.roboDelayLog.update({ where: { id: d.id }, data: fields });
        } else {
          await tx.roboDelayLog.create({ data: { shiftId: start.shiftId, productionRecordId: id, ...fields } });
        }
      }
    }

    // 5. The slab's final state, for the response.
    return tx.roboProductionRecord.findUnique({ where: { id } });
  });

  return NextResponse.json(record);
}
