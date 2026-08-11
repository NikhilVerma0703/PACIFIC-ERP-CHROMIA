import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseRegister } from "@/lib/robo/importRegister";

/** POST /api/robo/imports/preview — parse and validate a register without writing anything. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No workbook uploaded." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseRegister(buf);

  if (parsed.fatal) {
    return NextResponse.json({
      fileName: file.name,
      fatal: parsed.fatal,
      sheetName: parsed.sheetName,
      detectedColumns: parsed.detectedColumns,
      totalRows: 0, willImport: 0, willSkip: 0, failed: 0,
      issues: [], sample: [],
    });
  }

  // Which rows already exist (same slab number on the same production date)
  const dates = Array.from(new Set(parsed.rows.map(r => r.date)));
  const existing = await prisma.roboProductionRecord.findMany({
    where: { shift: { date: { in: dates } } },
    select: { slabNumber: true, shift: { select: { date: true } } },
  });
  const seen = new Set(existing.map(e => `${e.shift.date}|${e.slabNumber}`));

  let willImport = 0;
  let willSkip = 0;
  const duplicates: string[] = [];
  for (const r of parsed.rows) {
    const key = `${r.date}|${r.slabNumber}`;
    if (seen.has(key)) {
      willSkip++;
      if (duplicates.length < 10) duplicates.push(`Row ${r.rowNumber}: slab ${r.slabNumber} on ${r.date} already exists`);
    } else {
      willImport++;
    }
  }

  return NextResponse.json({
    fileName: file.name,
    fatal: null,
    sheetName: parsed.sheetName,
    detectedColumns: parsed.detectedColumns,
    hasSetupSheet: Object.keys(parsed.setups).length > 0,
    totalRows: parsed.totalRows,
    willImport,
    willSkip,
    failed: parsed.issues.length,
    issues: [...parsed.issues.slice(0, 10).map(i => `Row ${i.rowNumber}: ${i.message}`), ...duplicates].slice(0, 12),
    sample: parsed.rows.slice(0, 5).map(r => ({
      date: r.date, shiftNumber: r.shiftNumber, slabNumber: r.slabNumber,
      designName: r.designName || "-", inTime: r.inTime || "-", outTime: r.outTime || "-",
    })),
  });
}
