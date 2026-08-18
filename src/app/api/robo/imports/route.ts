import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { parseRegister, setupKey, ParsedRow } from "@/lib/robo/importRegister";

export async function GET() {
  try {
    const logs = await prisma.roboImportLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    return NextResponse.json({ ready: true, logs });
  } catch {
    // Table not created yet — the page still renders and explains what to run.
    return NextResponse.json({ ready: false, logs: [] });
  }
}

/** POST /api/robo/imports — parse the register and write shifts, setups and slab records. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const period = (form.get("period") as string | null)?.trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No workbook uploaded." }, { status: 400 });
  }

  const u = await currentUser();
  const userName = u?.name ?? "unknown";

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseRegister(buf);

  const writeLog = async (data: {
    status: string; totalRows: number; imported: number; skipped: number; failed: number; message: string;
  }) => {
    try {
      await prisma.roboImportLog.create({
        data: { fileName: file.name, period, user: userName, ...data },
      });
      return true;
    } catch {
      return false;
    }
  };

  if (parsed.fatal) {
    const logged = await writeLog({ status: "failed", totalRows: 0, imported: 0, skipped: 0, failed: 0, message: parsed.fatal });
    return NextResponse.json({ status: "failed", totalRows: 0, imported: 0, skipped: 0, failed: 0, message: parsed.fatal, historyReady: logged });
  }

  const machines = await prisma.roboMachine.findMany({ select: { id: true, name: true } });
  const machineByName = new Map(machines.map(m => [m.name.toLowerCase(), m.id]));

  // Group rows by production date + shift number
  const groups = new Map<string, ParsedRow[]>();
  for (const r of parsed.rows) {
    const key = `${r.date}|${r.shiftNumber}`;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }

  let imported = 0;
  let skipped = 0;
  const failedRows: string[] = [];

  for (const [, rows] of groups) {
    const { date, shiftNumber } = rows[0];

    try {
      /* ── Shift ── */
      let shift = await prisma.roboShift.findFirst({ where: { date, shiftNumber } });
      if (!shift) {
        const inTimes = rows.map(r => r.inTime).filter(Boolean).sort() as string[];
        const outTimes = rows.map(r => r.outTime).filter(Boolean).sort() as string[];
        shift = await prisma.roboShift.create({
          data: {
            date,
            shiftNumber,
            startTime: inTimes[0] ?? "00:00",
            endTime: outTimes.length ? outTimes[outTimes.length - 1] : null,
            // Imported history is never the live shift
            status: "CLOSED",
            operatorName: rows.find(r => r.operatorName)?.operatorName ?? "",
            notes: "Imported from production register",
          },
        });
      }

      /* ── Production setups, one per design in this shift ── */
      const recipeByDesign = new Map<string, string>();
      const existingRecipes = await prisma.roboBatchRecipe.findMany({
        where: { shiftId: shift.id },
        select: { id: true, designName: true },
      });
      for (const r of existingRecipes) recipeByDesign.set(r.designName.trim().toUpperCase(), r.id);

      /* ── Slab records ── */
      const lastSerial = await prisma.roboProductionRecord.findFirst({
        where: { shiftId: shift.id },
        orderBy: { serialNumber: "desc" },
        select: { serialNumber: true },
      });
      let nextSerial = (lastSerial?.serialNumber ?? 0) + 1;

      for (const row of rows) {
        try {
          const duplicate = await prisma.roboProductionRecord.findFirst({
            where: { slabNumber: row.slabNumber, shift: { date: row.date } },
            select: { id: true },
          });
          if (duplicate) { skipped++; continue; }

          // Resolve (or create) the setup this slab was produced under
          let batchRecipeId: string | null = null;
          if (row.designName) {
            const designKey = row.designName.trim().toUpperCase();
            let recipeId = recipeByDesign.get(designKey);
            if (!recipeId) {
              const design = await prisma.roboDesign.upsert({
                where: { name: row.designName.trim() },
                update: {},
                create: { name: row.designName.trim() },
              });
              const entries = parsed.setups[setupKey(row.date, row.shiftNumber, row.designName)] ?? [];
              const created = await prisma.roboBatchRecipe.create({
                data: {
                  shiftId: shift.id,
                  designId: design.id,
                  designName: row.designName.trim(),
                  programName: "",
                  thickness: row.thickness,
                  notes: "Imported from production register",
                  entries: {
                    create: entries
                      .filter(e => machineByName.has(e.machineName.toLowerCase()))
                      .map(e => ({
                        machineId: machineByName.get(e.machineName.toLowerCase()) as string,
                        programName: e.programName,
                        toolName: e.toolName,
                        liquidName: e.liquidName,
                        powderName: e.powderName,
                        rollerHeight: e.rollerHeight,
                        targetCycleTime: e.targetCycleTime,
                      })),
                  },
                },
              });
              recipeId = created.id;
              recipeByDesign.set(designKey, recipeId);
            }
            batchRecipeId = recipeId;
          }

          await prisma.roboProductionRecord.create({
            data: {
              serialNumber:     row.serialNumber ?? nextSerial,
              slabNumber:       row.slabNumber,
              shiftId:          shift.id,
              batchRecipeId,
              inTime:           row.inTime,
              outTime:          row.outTime,
              roymixBodyWeight: row.bodyWeight,
              roymixCycleTime:  row.cycleTime,
              status:           row.status,
              remarks:          row.remarks,
            },
          });
          if (!row.serialNumber) nextSerial++;
          imported++;
        } catch (err) {
          failedRows.push(`Row ${row.rowNumber}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      for (const row of rows) failedRows.push(`Row ${row.rowNumber}: ${(err as Error).message}`);
    }
  }

  const failed = parsed.issues.length + failedRows.length;
  const status = imported === 0 ? "failed" : skipped + failed > 0 ? "partial" : "success";
  const message =
    status === "success"
      ? `Imported ${imported} slab record(s).`
      : `Imported ${imported}, skipped ${skipped} duplicate(s), ${failed} row(s) could not be read.`;

  const historyReady = await writeLog({
    status, totalRows: parsed.totalRows, imported, skipped, failed, message,
  });

  return NextResponse.json({
    status,
    totalRows: parsed.totalRows,
    imported,
    skipped,
    failed,
    message,
    historyReady,
    issues: [
      ...parsed.issues.slice(0, 8).map(i => `Row ${i.rowNumber}: ${i.message}`),
      ...failedRows.slice(0, 8),
    ],
  });
}
