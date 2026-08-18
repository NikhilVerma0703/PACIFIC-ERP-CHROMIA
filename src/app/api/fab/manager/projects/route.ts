// POST /api/fab/manager/projects
// Body: { projectCode, customerName, remarks? }
// Returns: { success: true, projectId }
//
// The first of the manager dashboard's three steps: create a project BY HAND.
// Nothing here is derived from a document — the older /api/fab/projects route
// creates a project out of a parsed Excel and refuses without requirements,
// which is exactly the coupling this surface exists to break. That route is
// left alone and still works; retiring it is a separate change.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

/** Long enough for a real code, short enough to fit the screens that show it. */
const MAX_CODE = 60;
const MAX_NAME = 160;
const MAX_REMARKS = 2000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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
  const projectCode = text(b.projectCode);
  const customerName = text(b.customerName);
  const remarks = text(b.remarks);

  if (!projectCode) return Response.json({ error: "A project code is required." }, { status: 400 });
  if (!customerName) return Response.json({ error: "A customer name is required." }, { status: 400 });
  if (projectCode.length > MAX_CODE) return Response.json({ error: `The project code must be ${MAX_CODE} characters or fewer.` }, { status: 400 });
  if (customerName.length > MAX_NAME) return Response.json({ error: `The customer name must be ${MAX_NAME} characters or fewer.` }, { status: 400 });
  if (remarks.length > MAX_REMARKS) return Response.json({ error: `Remarks must be ${MAX_REMARKS} characters or fewer.` }, { status: 400 });

  try {
    const project = await prisma.fabProject.create({
      data: { projectCode, customerName, remarks: remarks || null },
    });
    return Response.json({ success: true, projectId: project.id });
  } catch (e) {
    // fab_project.project_code is @unique. Two managers naming a project the
    // same thing is an ordinary mistake and deserves a sentence, not
    // "Invalid `prisma.fabProject.create()` invocation".
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json(
        { error: `Project ${projectCode} already exists. Open it, or use a different code.` },
        { status: 409 },
      );
    }
    console.error("fab/manager/projects error:", e);
    return Response.json({ error: "Could not create the project." }, { status: 500 });
  }
}
