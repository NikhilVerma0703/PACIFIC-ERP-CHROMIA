// Entry-photo download/view. Any signed-in user who can SEE the record's table
// may view its photos. ?id=<photo id>
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";
import { canSeeModel } from "@/lib/branch";
import { operatorTableModels } from "@/lib/stationAccess";
import { canUseSlabIntake } from "@/lib/inventory/intakeAccess";
import { hasInventoryAccess } from "@/lib/inventory/access";

const db = prisma as any;

export async function GET(request: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Not authorized" }, { status: 401 });
  try {
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const rows: any[] = await db.$queryRaw`SELECT model, filename, mime, data FROM entry_photo WHERE id = ${id}`;
    if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    const role = String((me as { role?: string | null }).role ?? "");
    const branch = String((me as { branch?: string | null }).branch ?? "");
    // THE SLAB-INTAKE CARVE-OUT, the same shape as middleware's: the named
    // intake people view the far/near defect photos on /slab-intake itself, and
    // one of the three is branch-capped to FABRICATION — which the department
    // refusal below would turn away from the very photos their own form
    // requires. Scoped to model "FinishedSlab" (the only model that form
    // writes) and decided by the SAME pure rule the page gate and middleware
    // run, on the same env var, so the door and the room cannot drift apart.
    const intakePhotoViewer =
      r.model === "FinishedSlab" &&
      canUseSlabIntake(role, String((me as { email?: string | null }).email ?? ""), process.env.SLAB_INTAKE_EMAILS);
    // AND THE INVENTORY AUDIENCE, for the same photos. The slab detail panel
    // in Finished Goods now shows a slab's far/near shots, and the people that
    // panel is FOR are refused by canSeeModel: it answers "no table access at
    // all" for Commercial and Sales, so the thumbnails would have 403'd for
    // exactly the role that reads the sheet most. Scoped the same way as the
    // carve-out above — model "FinishedSlab" only, and decided by the module's
    // own gate (hasInventoryAccess), so the panel and the picture agree on who
    // may look. No other model is reachable through it.
    //
    // THE WHOLE USER, NOT THE ROLE AND THE BRANCH. This asked hasInventoryAccess
    // with a pair of strings until 2026-09-14, and a pair of strings cannot
    // carry users.fg_view: that form is @deprecated because it answers the
    // pre-grant rule, so a view-grant login failed it. The symptom was not a
    // missing feature but a worse one — /api/inventory/slab is on
    // inventoryReadGate and hands a viewer the photo rows, so the detail panel
    // drew a Photos strip, every tile 403'd, and the lightbox behind them opened
    // empty. That is strictly less than the office login the owner's "full
    // visibility" was measured against. The object form asks the office
    // role+branch rule first and only then the flag, so it returns exactly what
    // the pair returned for everybody who already had an answer, and `me` is
    // already the ACTIVE role context (currentUser), the same user every gate in
    // front of this one was asked about.
    const inventoryPhotoViewer = r.model === "FinishedSlab" && hasInventoryAccess(me);
    if (!intakePhotoViewer && !inventoryPhotoViewer) {
      if (!(await canSeeModel(r.model))) return Response.json({ error: "Not authorized" }, { status: 403 });
      // "Can SEE the record's table" is decided in two places for the tables
      // themselves, and this route used to apply only the first. canSeeModel
      // answers by branch and role; /tables/[model] ALSO narrows an operator to
      // their own station's models (operatorTableModels) and middleware never
      // lets the Fabrication or International Sales departments onto a production
      // page at all. Without the same two rules here, any operator could pull any
      // station's photos — downtime evidence, QC photos — by id, and a fab or
      // sales login could pull all of them. Photo links render only on the
      // /tables record page and on /mis and /maintenance (DowntimeRespond), none
      // of which these logins can open, so no working flow changes; admins span
      // every department, as everywhere.
      //
      // THE CHROMIA TABLET JOINS THAT LIST, and it joins it because of the view
      // grant rather than in spite of it. fgViewMayVisit now admits /api/photo
      // so the two granted logins can see a slab's far/near shots, and a fence
      // matches a path: the id in the query string does not say which model it
      // belongs to, so the admission opens this route for every model and the
      // scoping has to happen here. Without this line it would have handed a
      // Chromia login every non-office model's photos by id — downtime
      // evidence, QC photos — because canSeeModel answers yes to all of them for
      // a line manager off the OFFICE branch, which is the same by-id leak the
      // paragraph above closed for operators. It subtracts from nobody: the
      // Chromia cap in middleware is a narrow allowlist with a terminal return,
      // so no Chromia login could reach this route at all before the admission,
      // and the grant holders never enter this block because FinishedSlab is
      // answered above. Written as middleware's own cap is written — the role
      // OR the retired branch — so the door and the room cannot drift apart.
      if (rankOf(role) < ROLE_RANK.ADMIN) {
        if (branch === "FABRICATION" || branch === "INTERNATIONAL_SALES") return Response.json({ error: "Not authorized" }, { status: 403 });
        if (role === "CHROMIA" || branch === "CHROMIA") return Response.json({ error: "Not authorized" }, { status: 403 });
        if (role === "OPERATOR" && !operatorTableModels((me as { station?: string | null }).station).has(r.model)) {
          return Response.json({ error: "Not authorized" }, { status: 403 });
        }
      }
    }
    return new Response(new Uint8Array(r.data), {
      headers: {
        "Content-Type": r.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": `inline; filename="${String(r.filename).replace(/[^\w.\- ]/g, "_")}"`,
        // A photo row is insert-only (entryPhoto.ts and mis/actions.ts only ever
        // INSERT; nothing in the repo updates or deletes entry_photo), so a given
        // ?id= can never serve different bytes: the browser may keep it for a
        // year instead of re-paying a function call, a bytea read and up to 8 MB
        // of egress every hour it is looked at again. Still `private` — the
        // response is per-auth and must not land in a shared cache.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("Photo error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
