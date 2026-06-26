import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function GET() {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const projects = await prisma.fabProject.findMany({
    where: { status: { in: ["PLANNING", "ALLOCATED"] }, projectCode: { not: "UNASSIGNED" } },
    orderBy: { createdAt: "desc" },
    include: {
      drawings: {
        include: {
          defaultSlab: true,
          requirements: {
            include: {
              allocations: { include: { slab: true }, orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return Response.json(projects);
}
