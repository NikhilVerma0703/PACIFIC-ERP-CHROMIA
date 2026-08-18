import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

const ALL_STATUSES = ["PLANNING", "ALLOCATED", "RELEASED_TO_PRODUCTION", "COMPLETED"] as const;
type Status = (typeof ALL_STATUSES)[number];

/** What is still being planned — the planning board's default. */
const PLANNING_STATUSES: Status[] = ["PLANNING", "ALLOCATED"];

export async function GET(req: NextRequest) {
  const g = await fabGate("SUPERVISOR");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  // ?statuses=PLANNING,ALLOCATED,RELEASED_TO_PRODUCTION
  //
  // The planning board wants only what is still being planned. The cut queue
  // needs released projects too: releasing sets RELEASED_TO_PRODUCTION, and with
  // the old fixed filter every slab of a released project vanished from the
  // queue that is supposed to send it to the cutter. Unknown values are dropped
  // rather than 400-ing a shop-floor screen.
  const raw = req.nextUrl.searchParams.get("statuses");
  const asked = (raw ?? "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter((s): s is Status => (ALL_STATUSES as readonly string[]).includes(s));
  const statuses = asked.length ? asked : PLANNING_STATUSES;

  const projects = await prisma.fabProject.findMany({
    where: { status: { in: statuses }, projectCode: { not: "UNASSIGNED" } },
    orderBy: { createdAt: "desc" },
    include: {
      drawings: {
        include: {
          defaultSlab: true,
          requirements: {
            include: {
              // ALL allocations, not take:1. A CLO plan splits one piece type
              // across several slabs (apply-slab-excel writes one allocation per
              // slab), and a board that shows only the newest cannot tell the
              // supervisor that assigning a slab is about to replace a split.
              allocations: { include: { slab: true }, orderBy: { createdAt: "asc" } },
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
