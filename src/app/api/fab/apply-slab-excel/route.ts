// POST /api/fab/apply-slab-excel
// Body: multipart/form-data  { projectId: string, file: File }
//
// The manager uploads CLO Optimizer PDFs to Claude chat, receives a slab
// allocation Excel, then uploads that Excel here to apply allocations.
//
// Expected Excel columns (flexible, case-insensitive):
//   Slab  / Sheet / Stock   -- slab identifier from CLO
//   Label / Piece / Serial  -- "{Dwg#}-{Piece}" composite label (e.g. "1-2B")
//   Qty   / Quantity        -- pieces on this slab
//
// Matching: label "1-2B" -> drawingNumber="1", pieceLabel="2B"
//           lookup FabRequirement where drawing.drawingNumber="1" AND pieceLabel="2B"

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 30;

function findCol(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

function parseAllocationExcel(buf: Buffer): { slab: string; label: string; qty: number }[] {
  const wb      = XLSX.read(buf, { type: "buffer" });
  const ws      = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
  if (rawRows.length < 2) return [];

  // Find first row with at least 2 non-empty cells (treat as header)
  let hi = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    if (rawRows[i].filter((c) => String(c).trim()).length >= 2) { hi = i; break; }
  }
  if (hi < 0) return []; // no header row found

  const headers  = rawRows[hi].map((h) => String(h).toLowerCase().trim());
  const slabCol  = findCol(headers, /slab|sheet|stock/);
  const labelCol = findCol(headers, /label|piece|serial|id/);
  const qtyCol   = findCol(headers, /qty|quantity|count/);

  if (slabCol < 0 || labelCol < 0)
    throw new Error(
      `Columns not found. Need "Slab" and "Label" (or similar). Got: ${headers.join(", ")}`
    );

  const out: { slab: string; label: string; qty: number }[] = [];
  for (const row of rawRows.slice(hi + 1)) {
    const slab  = String(row[slabCol]  ?? "").trim();
    const label = String(row[labelCol] ?? "").trim();
    const qty   = qtyCol >= 0 ? parseInt(String(row[qtyCol] ?? "1")) || 1 : 1;
    if (slab && label) out.push({ slab, label, qty });
  }
  return out;
}

function normSlabCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-x]/g, "");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const fd        = await req.formData();
  const projectId = (fd.get("projectId") as string | null)?.trim();
  const file      = fd.get("file") as File | null;

  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
  if (!file)      return Response.json({ error: "No file uploaded" },   { status: 400 });
  if (!file.name.match(/\.(xlsx|xls)$/i))
    return Response.json({ error: "Only .xlsx / .xls accepted" }, { status: 400 });

  let allocRows: { slab: string; label: string; qty: number }[];
  try {
    allocRows = parseAllocationExcel(Buffer.from(await file.arrayBuffer()));
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : "Parse failed" }, { status: 422 });
  }
  if (!allocRows.length)
    return Response.json({ error: "No allocation rows found" }, { status: 422 });

  // Load project requirements
  const project = await prisma.fabProject.findUnique({
    where: { id: projectId },
    include: { drawings: { include: { requirements: true } } },
  });
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  // Build composite label map: "{drawingNumber}-{pieceLabel}" -> requirement
  // Keys are normalized to lowercase+trimmed to handle case/formatting differences
  // between the DB and what CLO writes in the Excel.
  const byLabel = new Map<string, { id: string; quantity: number }>();
  for (const d of project.drawings) {
    for (const r of d.requirements) {
      if (d.drawingNumber && r.pieceLabel) {
        const key = `${d.drawingNumber.trim().toLowerCase()}-${r.pieceLabel.trim().toLowerCase()}`;
        byLabel.set(key, { id: r.id, quantity: r.quantity });
      }
    }
  }

  // Pre-create ALL slab records upfront so every CLO slab exists in DB,
  // even if all its labels happen to be shared with an earlier slab.
  const slabCache = new Map<string, string>(); // slabCode -> slabId
  for (const row of allocRows) {
    const slabCode = normSlabCode(row.slab);
    if (slabCache.has(slabCode)) continue;
    let slab = await prisma.fabSlab.findFirst({ where: { projectId, slabCode } });
    if (!slab) {
      slab = await prisma.fabSlab.create({
        data: { projectId, slabCode, colour: "", totalArea: 0, availableArea: 0 },
      });
    }
    slabCache.set(slabCode, slab.id);
  }

  const applied:   { label: string; slabCode: string; qty: number }[] = [];
  const unmatched: string[] = [];

  for (const row of allocRows) {
    const slabCode = normSlabCode(row.slab);
    const labelKey = row.label.trim().toLowerCase();
    const req      = byLabel.get(labelKey);
    const slabId   = slabCache.get(slabCode)!;

    if (!req) {
      if (!unmatched.includes(row.label)) unmatched.push(row.label);
      continue;
    }

    // Allow the same label on multiple slabs (CLO splits one piece type across slabs).
    // Upsert allocation per (requirementId, slabId) pair — don't wipe other slabs.
    await prisma.fabRequirementAllocation.deleteMany({
      where: { requirementId: req.id, slabId },
    });
    await prisma.fabRequirementAllocation.create({
      data: { requirementId: req.id, slabId, allocatedQuantity: row.qty },
    });
    await prisma.fabRequirement.update({
      where: { id: req.id },
      data:  { status: "ALLOCATED" },
    });

    applied.push({ label: row.label, slabCode, qty: row.qty });
  }

  return Response.json({ success: true, applied: applied.length, appliedList: applied, unmatched });
}
