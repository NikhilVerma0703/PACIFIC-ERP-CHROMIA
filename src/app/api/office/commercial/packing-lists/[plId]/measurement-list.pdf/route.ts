// GET /api/office/commercial/packing-lists/[plId]/measurement-list.pdf
// The per-slab measurement sheet: crate by crate, with subtotals.
import { commercialGate } from "@/lib/commercial/access";
import { deny, json } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { pdfFilename } from "@/lib/commercial/packing-rules";
import { generateMeasurementListPdf } from "@/lib/commercial/pdf/measurement-list";
import { shapeForPdf, paramPl } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "packing");
  if (!g.ok) return deny(g);
  try {
    const plId = await paramPl(params);
    const src = await shapeForPdf(plId);
    const settings = await loadSettings();
    const buf = await generateMeasurementListPdf({
      list: src.plList,
      order: src.plOrder,
      client: src.client,
      ext: src.ext,
      settings,
      invoice: src.invoice,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFilename(src.number, "measurement-list")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = typeof e === "object" && e !== null && typeof (e as { status?: number }).status === "number" ? (e as { status: number }).status : 500;
    return json({ error: (e as Error)?.message ?? "Could not build the measurement list" }, status);
  }
}
