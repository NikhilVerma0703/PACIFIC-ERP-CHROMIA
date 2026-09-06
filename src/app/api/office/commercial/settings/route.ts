// GET /api/office/commercial/settings — the module's settings: what documents
//   print from (merged), what has actually been changed (overrides), the
//   counters and the number each document kind would take today.
// PUT /api/office/commercial/settings — replace the overrides.
//
// ADMIN only, both. These values are on every invoice, proforma and challan
// the company issues: the bank account money is wired to, the GSTIN, the tax
// rates, the number series. Nobody who is not an admin changes them.
//
// The screen posts the WHOLE settings object it was shown. validateOverrides
// whitelists it against the default shape (unknown keys dropped, "5" coerced
// to 5, a template without {seq} refused), then pruneDefaults reduces it to
// the strict differences — so a field left at its default keeps following the
// default when the default moves, instead of freezing today's value into the
// row for ever.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, readBody, plain } from "@/lib/commercial/http";
import { saveOverrides } from "@/lib/commercial/settings";
import { validateOverrides, pruneDefaults } from "@/lib/commercial/settings-rules";
import { settingsView } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await commercialGate("admin");
  if (!g.ok) return deny(g);
  return handle(async () => {
    return json(plain(await settingsView()));
  });
}

export async function PUT(req: Request) {
  const g = await commercialGate("admin");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<{ overrides?: unknown }>(req);
    // `{ overrides: … }` is the contract; a bare settings object is accepted
    // too, so a curl that forgets the wrapper is not silently a no-op save.
    const raw = body.overrides !== undefined ? body.overrides : body;
    const v = validateOverrides(raw);
    if (!v.ok) {
      return json({
        error: v.errors.length === 1 ? v.errors[0].message : `${v.errors.length} settings could not be saved`,
        errors: v.errors, warnings: v.warnings, dropped: v.dropped,
      }, 400);
    }
    const stored = pruneDefaults(v.cleaned);
    await saveOverrides(stored, g.user?.id ?? null);
    const view = await settingsView(stored);
    return json(plain({ ...view, warnings: v.warnings, dropped: v.dropped, savedAt: new Date().toISOString() }));
  });
}
