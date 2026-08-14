import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";

/**
 * GET /api/robo/production
 * Filters (all optional, combinable):
 *   shiftId, date (production date from the shift), slabNumber, designName
 * With no filters the latest 25 records are returned.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shiftId = sp.get("shiftId")?.trim() || "";
  const date = sp.get("date")?.trim() || "";
  const slabNumber = sp.get("slabNumber")?.trim() || "";
  const designName = sp.get("designName")?.trim() || "";
  const limitParam = Number(sp.get("limit"));

  const where: Prisma.RoboProductionRecordWhereInput = {};
  if (shiftId) where.shiftId = shiftId;
  if (date) where.shift = { date };
  if (slabNumber) where.slabNumber = { contains: slabNumber };
  if (designName) where.batchRecipe = { designName: { contains: designName } };

  const hasFilters = !!(shiftId || date || slabNumber || designName);
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
 * S.No. is assigned automatically per shift when not supplied.
 * A slab without an Out Time stays In-Processing.
 */
export async function POST(req: Request) {
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

    let serialNumber = body.serialNumber ? Number(body.serialNumber) : null;
    if (!serialNumber) {
      const last = await tx.roboProductionRecord.findFirst({
        where: { shiftId: body.shiftId },
        orderBy: { serialNumber: "desc" },
        select: { serialNumber: true },
      });
      serialNumber = (last?.serialNumber ?? 0) + 1;
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
