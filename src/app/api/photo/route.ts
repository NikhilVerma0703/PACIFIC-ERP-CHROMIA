// Entry-photo download/view. Any signed-in user who can SEE the record's table
// may view its photos. ?id=<photo id>
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/rbac";
import { canSeeModel } from "@/lib/branch";

const db = prisma as any;

export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Not authorized" }, { status: 401 });
  try {
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const rows: any[] = await db.$queryRaw`SELECT model, filename, mime, data FROM entry_photo WHERE id = ${id}`;
    if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    if (!(await canSeeModel(r.model))) return Response.json({ error: "Not authorized" }, { status: 403 });
    return new Response(new Uint8Array(r.data), {
      headers: {
        "Content-Type": r.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": `inline; filename="${String(r.filename).replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("Photo error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
