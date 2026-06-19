import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.fabProject.findMany({
    where: { status: { in: ["PLANNING", "ALLOCATED"] } },
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
