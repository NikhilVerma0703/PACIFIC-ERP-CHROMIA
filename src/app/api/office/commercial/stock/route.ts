// GET /api/office/commercial/stock?design=&thickness=&grade=
//
// The stock check itself: AVAILABLE full slabs of one design, grouped by batch,
// with every slab listed so the person picking can tick the ones they want.
// Everything comes from lib/commercial/inventory-bridge, which applies the
// sales-approval filter for a non-admin and drops cut-marked slabs — a stock
// check that counted a CTS slab would promise something dispatch will refuse.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain, str } from "@/lib/commercial/http";
import { searchAvailable } from "@/lib/commercial/inventory-bridge";
import { loadSettings } from "@/lib/commercial/settings";
import { canonThickness } from "@/lib/thickness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "stock");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const design = str(u.searchParams.get("design"));
    if (!design) fail(400, "Pick a design to check");
    const thicknessRaw = str(u.searchParams.get("thickness"));
    const thickness = thicknessRaw ? canonThickness(thicknessRaw) : null;
    const grade = str(u.searchParams.get("grade"));
    const [res, settings] = await Promise.all([
      searchAvailable({ design, thickness, grade, isAdmin: g.actor === "ADMIN" }),
      loadSettings(),
    ]);
    // holdDays travels with the search so the picker can show and pre-fill the
    // hold length without a second call to Settings, which gates "admin" and
    // which the Commercial user placing the hold may not read.
    return json(plain({ design, thickness, grade, holdDays: settings.holdDays, ...res }));
  });
}
