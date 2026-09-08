// GET /api/office/commercial/proformas/[piId]/pdf — the printed proforma.
//
// The snapshot is printed exactly as it was frozen: a PI that went to a
// customer must render the same way a year later even if the order, the client
// master or the settings have moved on — the bank block and the GSTIN it
// carries are the ones chosen for it, not today's settings. Served inline so
// the browser's viewer opens it in the tab the PI tab points at; a missing row
// or an unusable snapshot still comes back through handle() as JSON with a
// status.
import { NextResponse } from "next/server";
import { commercialGate } from "@/lib/commercial/access";
import { deny, handle } from "@/lib/commercial/http";
import { generateProformaPdf } from "@/lib/commercial/pdf/proforma";
import { piFilename } from "@/lib/commercial/proforma-rules";
import { loadProforma, snapshotOf, piIdOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "proforma");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    const buffer = await generateProformaPdf(snapshotOf(pi));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${piFilename(pi.number)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
