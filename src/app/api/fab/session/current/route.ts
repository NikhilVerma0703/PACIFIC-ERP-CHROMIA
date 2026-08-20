import { fabGate } from "@/lib/fab/access";
import { isFabProcessType } from "@/lib/fab/processSession";
import { listCookieSessions, readProcessSession } from "@/lib/fab/processSessionServer";

export async function GET(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const type = new URL(req.url).searchParams.get("type");
  if (type === "all" || !type) {
    const all = await listCookieSessions();
    return Response.json({ sessions: all });
  }
  if (!isFabProcessType(type)) {
    return Response.json({ error: "Invalid type" }, { status: 400 });
  }
  const session = await readProcessSession(type);
  return Response.json({ session });
}
