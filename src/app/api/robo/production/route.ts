import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slabSearchWhere } from "@/lib/robo/slabSearch";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";
import { roboGate } from "@/lib/rbac";

/**
 * GET /api/robo/production
 * Filters (all optional, combinable):
 *   shiftId, date (the production date on the setup, falling back to the
 *   shift's own date — see lib/robo/productionDate.ts), slabNumber, designName,
 *   batchNo (the batch number on the setup the slab was logged against)
 * With no filters the latest 25 records are returned.
 *
 * The where clause is built in lib/robo/slabSearch.ts rather than here, because
 * designName and batchNo both narrow the same related setup and an inline
 * second assignment would silently drop the first — see that file.
 */
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const sp = req.nextUrl.searchParams;
  const limitParam = Number(sp.get("limit"));

  const { where, hasFilters } = slabSearchWhere({
    shiftId: sp.get("shiftId"),
    date: sp.get("date"),
    slabNumber: sp.get("slabNumber"),
    designName: sp.get("designName"),
    batchNo: sp.get("batchNo"),
  });

  const take = limitParam > 0 ? Math.min(limitParam, 500) : hasFilters ? 200 : 25;

  const data = await prisma.roboProductionRecord.findMany({
    where,
    include: {
      batchRecipe: true,
      shift: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return NextResponse.json(data);
}

/** Thrown inside the create transaction so the clash rolls the whole thing
 *  back; caught below and turned into the 409 the form expects. */
class DuplicateSlabError extends Error {}

/**
 * POST /api/robo/production — create a slab record.
 * S.No. is assigned automatically from the whole register when not supplied.
 * A slab without an Out Time stays In-Processing.
 */
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json();

  // The slab number is how a slab is found again — on the Slabs Records
  // screen, in the Excel export, and by anyone holding the paper register.
  // Two records sharing one makes every one of those ambiguous, so the rule
  // is enforced on the server: the form's on-blur check is the friendlier
  // half of it, not the control. Trimmed first, because a trailing space
  // would otherwise create a second, invisible "140748".
  const slabNumber = String(body.slabNumber ?? "").trim();
  if (!slabNumber) return NextResponse.json({ error: "Slab number is required." }, { status: 400 });

  // One transaction end to end: the duplicate check, the serial lookup, the
  // slab record and its delay logs land together or not at all. The
  // auto-serial MUST live inside it - findFirst-then-create outside a
  // transaction hands two operators saving at once the same S.No.
  //
  // The clash check narrows the window rather than closing it: read-committed
  // still lets two simultaneous saves both see "free". Only a unique index on
  // slab_number would make it airtight, and that is a Neon DDL change this
  // working copy cannot make safely (see CLAUDE.md on db push) — so the check
  // is written to be replaced by one, not to stand in for it forever.
  const record = await prisma.$transaction(async (tx) => {
    const clash = await tx.roboProductionRecord.findFirst({ where: { slabNumber }, select: { id: true } });
    if (clash) throw new DuplicateSlabError();

    // The S.No. the form sent, when it sent a usable one. Number("") is 0 and
    // Number("x") is NaN; neither is a row number, so both fall through to the
    // count rather than being written.
    const sent = Number(body.serialNumber);
    let serialNumber = Number.isFinite(sent) && sent > 0 ? Math.trunc(sent) : null;
    if (!serialNumber) {
      // Counted across the WHOLE register, matching what the form is offered by
      // /api/robo/production/next-number. This used to be `where: { shiftId }`
      // with `orderBy: { serialNumber: "desc" }`, which was wrong twice: a shift
      // row is created silently once per day, so the count restarted every
      // morning; and serial_number is nullable, so Postgres' DESC NULLS FIRST
      // put a single NULL at the top and pinned the answer at 1 for good. An
      // aggregate max ignores NULLs by definition.
      const agg = await tx.roboProductionRecord.aggregate({ _max: { serialNumber: true } });
      serialNumber = (agg._max.serialNumber ?? 0) + 1;
    }

    const status: string = body.status || (body.outTime ? SLAB_COMPLETED : SLAB_IN_PROCESSING);

    const rec = await tx.roboProductionRecord.create({
      data: {
        serialNumber,
        slabNumber,
        shiftId:          body.shiftId,
        batchRecipeId:    body.batchRecipeId || null,
        inTime:           body.inTime || null,
        outTime:          body.outTime || null,
        roymixCycleTime:  body.roymixCycleTime ? Number(body.roymixCycleTime) : null,
        roymixBodyWeight: body.roymixBodyWeight ? Number(body.roymixBodyWeight) : null,
        status,
        remarks:          body.remarks || null,
      },
      include: { batchRecipe: true, shift: true },
    });
    if (Array.isArray(body.delays) && body.delays.length > 0) {
      await tx.roboDelayLog.createMany({
        data: body.delays.map((d: { delayCodeId: string; machineId?: string; machineName?: string; durationMinutes: number; startTime?: string; endTime?: string; remarks?: string }) => ({
          shiftId:            body.shiftId,
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
  }).catch((e: unknown) => {
    if (e instanceof DuplicateSlabError) return null;
    throw e;
  });

  if (!record) {
    return NextResponse.json(
      { error: "Duplicate Slab No. — this slab number already exists." },
      { status: 409 },
    );
  }

  return NextResponse.json(record, { status: 201 });
}
