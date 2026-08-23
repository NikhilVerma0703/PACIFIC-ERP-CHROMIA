// Entry-photo download/view. Any signed-in user who can SEE the record's table
// may view its photos. ?id=<photo id>
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";
import { canSeeModel } from "@/lib/branch";
import { operatorTableModels } from "@/lib/stationAccess";

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
    const role = String((me as { role?: string | null }).role ?? "");
    const branch = String((me as { branch?: string | null }).branch ?? "");
    if (rankOf(role) < ROLE_RANK.ADMIN) {
      if (branch === "FABRICATION" || branch === "INTERNATIONAL_SALES") return Response.json({ error: "Not authorized" }, { status: 403 });
      if (role === "OPERATOR" && !operatorTableModels((me as { station?: string | null }).station).has(r.model)) {
        return Response.json({ error: "Not authorized" }, { status: 403 });
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
