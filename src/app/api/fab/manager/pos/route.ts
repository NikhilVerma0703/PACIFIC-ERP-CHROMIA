// POST /api/fab/manager/pos
// Body: { projectId, poNumber }
// Returns: { success: true, poId }
//
// Step two: a purchase order under an existing project. A project holds several
// POs, and the PO number belongs to the CUSTOMER's system — so it is unique
// within the project only (@@unique([projectId, poNumber]) / scripts/0044).
// Creating the PO is separate from uploading its PDF on purpose: the PO exists
// as soon as the manager knows its number, and the document arrives when it
// arrives.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

const MAX_PO_NUMBER = 60;

export async function POST(req: Request) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const projectId = typeof b.projectId === "string" ? b.projectId.trim() : "";
  const poNumber = typeof b.poNumber === "string" ? b.poNumber.trim() : "";

  if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 });
  if (!poNumber) return Response.json({ error: "A PO number is required." }, { status: 400 });
  if (poNumber.length > MAX_PO_NUMBER) {
    return Response.json({ error: `The PO number must be ${MAX_PO_NUMBER} characters or fewer.` }, { status: 400 });
  }

  const project = await prisma.fabProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return Response.json({ error: "That project no longer exists — refresh and look again." }, { status: 404 });

  try {
    const po = await prisma.fabPo.create({ data: { projectId, poNumber } });
    return Response.json({ success: true, poId: po.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json(
        { error: `PO ${poNumber} is already on this project. Open it rather than adding it twice.` },
        { status: 409 },
      );
    }
    console.error("fab/manager/pos error:", e);
    return Response.json({ error: "Could not create the purchase order." }, { status: 500 });
  }
}
