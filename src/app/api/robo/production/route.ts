import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBatchRecipeIds } from "@/lib/robo/batchFilter";
import { latestSerialNumber, nextSerialNumber } from "@/lib/robo/nextNumbers";
import { REGISTER_ORDER } from "@/lib/robo/registerOrderDb";
import { slabSearchWhere } from "@/lib/robo/slabSearch";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";

/**
 * GET /api/robo/production
 * Filters (all optional, combinable):
 *   shiftId, date (the production date on the setup, falling back to the
 *   shift's own date — see lib/robo/productionDate.ts), slabNumber, designName,
 *   batchNo (the batch number on the setup the slab was logged against)
 * With no filters the latest 25 records are returned.
 *
 * `batchNo` matches loosely: "D-1372", "d1372" and a bare "1372" all find the
 * batch stored as "D1372", while "A-1248" stays distinct from "D-1248". The
 * typed number is resolved to the matching setup ids here (batchFilter.ts) and
 * the where itself is built in lib/robo/slabSearch.ts — see those files.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limitParam = Number(sp.get("limit"));

  const batchRecipeIds = await resolveBatchRecipeIds(sp.get("batchNo"));
  const { where, hasFilters } = slabSearchWhere({
    shiftId: sp.get("shiftId"),
    date: sp.get("date"),
    slabNumber: sp.get("slabNumber"),
    designName: sp.get("designName"),
    batchRecipeIds,
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
      // One past the S.No. on the last row saved, matching what the form is
      // offered by /api/robo/production/next-number — the two must agree, or a
      // save with the field cleared lands somewhere the operator was never
      // shown.
      //
      // Two earlier versions of this were wrong. `where: { shiftId }` with
      // `orderBy: { serialNumber: "desc" }` restarted the count every morning,
      // because a shift row is created silently once per day, and serial_number
      // is nullable so Postgres' DESC NULLS FIRST pinned the answer at 1 for
      // good. `max(serial_number) + 1` fixed both and introduced a third: a
      // maximum is not a position in a register, and the imported historical
      // rows carry the old paper register's own S.No. column, so a line sitting
      // at 19 was handed 241.
      //
      // REGISTER_ORDER is the shared answer to "which row is last" — by
      // production day, then row number, not by insert time. See the note in
      // lib/robo/registerOrderDb.ts for why createdAt is the wrong key here.
      // The walk past rows with no S.No. is what makes a nullable column safe.
      const recent = await tx.roboProductionRecord.findMany({
        orderBy: REGISTER_ORDER,
        take: 50,
        select: { serialNumber: true },
      });
      serialNumber = nextSerialNumber(latestSerialNumber(recent.map((r) => r.serialNumber)));
    }

    const status: string = body.status || (body.outTime ? SLAB_COMPLETED : SLAB_IN_PROCESSING);

    const rec = await tx.roboProductionRecord.create({
      data: {
        serialNumber,
        slabNumber,
        shiftId:          body.shiftId,
        batchRecipeId:    body.batchRecipeId || null,
        // The slab's own production date, when the operator set one for it — a
        // batch running past midnight has later slabs on a later day. Stored as
        // a real yyyy-mm-dd or NULL, never "" (the where-builders' invariant):
        // an untouched field falls back to the setup/shift exactly as before.
        productionDate:   (typeof body.productionDate === "string" && body.productionDate.trim()) || null,
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
