import { fabGate } from "@/lib/fab/access";
import {
  createFabWorker,
  listFabWorkers,
  setFabWorkerActive,
} from "@/lib/fab/workersDb";

function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  const meta = (e as { meta?: { code?: string } }).meta;
  return code === "P2002" || code === "23505" || meta?.code === "23505";
}

export async function GET(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const all = new URL(req.url).searchParams.get("all") === "1" && g.tier !== "EMPLOYEE";
  try {
    const workers = await listFabWorkers(all);
    return Response.json(workers);
  } catch (e) {
    console.error("fab/workers GET:", e);
    return Response.json({ error: "Could not load the people list." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "A name is required." }, { status: 400 });
  if (name.length > 80) return Response.json({ error: "Keep the name under 80 characters." }, { status: 400 });

  try {
    const worker = await createFabWorker(name, g.user.id as string);
    return Response.json({ success: true, worker });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return Response.json({ error: `${name} is already on the roster.` }, { status: 409 });
    }
    console.error("fab/workers POST:", e);
    return Response.json({ error: "Could not add that name." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const active = body?.active;
  if (!id || typeof active !== "boolean") {
    return Response.json({ error: "id and active required" }, { status: 400 });
  }

  try {
    const worker = await setFabWorkerActive(id, active);
    if (!worker) return Response.json({ error: "That name is not on the roster." }, { status: 404 });
    return Response.json({ success: true, worker });
  } catch (e) {
    console.error("fab/workers PATCH:", e);
    return Response.json({ error: "Could not update that name." }, { status: 500 });
  }
}
