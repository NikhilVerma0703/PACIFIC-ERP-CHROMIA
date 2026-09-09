// THE WHOLE PROJECT, AGREED ON A PHONE CALL — scripts/0067.
//
// The owner: "always have a custom free field for total, so when system feels
// heavy they call and enter the amount."
//
// This is the escape hatch of last resort — one figure that replaces every
// calculation under it. The row-level one (api/fab/supervisor/polish-terms)
// handles the ordinary case of a single odd row; this is for the quote that was
// settled in a conversation before anybody opened a screen.
//
// ─────────────────────── THE CALCULATION IS NOT DESTROYED ───────────────────
// Only stored beside. The board shows both — the agreed figure in bold and what
// the system worked out struck through next to it — because an override nobody
// can see past is how a wrong rate card survives a year. The whole value of
// keeping the calculation is that somebody eventually asks why they differ.
//
// ─────────────────────── AND IT IS SIGNED ───────────────────────────────────
// Who typed it, when, and why. The note is worth more than the number six
// months later: "agreed with Fred on the phone, 12 Sep, includes the two
// L-shaped tops" is the difference between a figure you can defend and one
// nobody can explain.
//
// MANAGER, not supervisor. A supervisor prices a row he is looking at; nobody
// replaces a project's whole total from the shop floor.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: NextRequest) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let body: { projectId?: string; projectCode?: string; total?: unknown; note?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: "Malformed request body." }, { status: 400 }); }

  // EITHER IDENTIFIER. The CEO overview groups by project_code — which is
  // UNIQUE — and never carries the id, so demanding one would mean threading it
  // through three types for no gain. The id is still accepted because every
  // other fabrication route speaks in ids.
  const projectId = String(body.projectId ?? "").trim();
  const projectCode = String(body.projectCode ?? "").trim();
  if (!projectId && !projectCode) {
    return Response.json({ error: "projectId or projectCode required" }, { status: 400 });
  }

  // EMPTY CLEARS IT, and clears the signature with it — a note and a name
  // attached to a figure that is no longer there would claim somebody agreed
  // something they did not.
  let total: number | null = null;
  if (body.total !== null && body.total !== undefined && body.total !== "") {
    const n = Number(body.total);
    if (!Number.isFinite(n) || n < 0) {
      return Response.json(
        { error: "The agreed total must be a number of rupees, zero or more." },
        { status: 400 },
      );
    }
    total = n;
  }

  const note = total === null
    ? null
    : (typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim().slice(0, 500) : null);

  const exists = projectId
    ? await prisma.fabProject.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true } })
    : await prisma.fabProject.findUnique({ where: { projectCode }, select: { id: true, projectCode: true } });
  if (!exists) {
    return Response.json({ error: "That project no longer exists." }, { status: 404 });
  }

  try {
    await prisma.$executeRaw`
      UPDATE fab_project
         SET manual_total      = ${total},
             manual_total_by   = ${total === null ? null : (g.user.id as string)},
             manual_total_at   = ${total === null ? null : new Date()},
             manual_total_note = ${note}
       WHERE id = ${exists.id}`;
  } catch (e) {
    console.error("[fab/project-total] update failed", e);
    return Response.json(
      { error: "Could not save — scripts/0067 is not on this database yet." },
      { status: 409 },
    );
  }

  return Response.json({
    success: true,
    projectId: exists.id,
    projectCode: exists.projectCode,
    total,
    note,
    cleared: total === null,
  });
}
