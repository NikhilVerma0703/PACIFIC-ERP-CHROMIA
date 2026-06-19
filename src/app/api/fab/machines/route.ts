import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!(session?.user as any)?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const machines = await prisma.fabMachine.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
  return Response.json(machines);
}
