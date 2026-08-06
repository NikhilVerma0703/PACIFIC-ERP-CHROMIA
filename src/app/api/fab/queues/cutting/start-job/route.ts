// POST /api/fab/queues/cutting/start-job
// Body: { slabJobId }
// Sets FabSlabJob to IN_PROGRESS. Only works if the job is still READY —
// if another operator already started it, returns 409 with their name so the
// calling UI can show a "locked" message.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  const userId = g.user.id as string;

  const { slabJobId } = await req.json();
  if (!slabJobId) return Response.json({ error: "slabJobId required" }, { status: 400 });

  // Load the job with the current starter's name (for conflict messaging)
  const job = await prisma.fabSlabJob.findUnique({
    where:   { id: slabJobId },
    include: { operator: { select: { name: true, email: true } } },
  });
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  // Already started by someone else → reject
  if (job.status === "IN_PROGRESS" && job.operatorId && job.operatorId !== userId) {
    const lockedBy = job.operator?.name ?? job.operator?.email ?? "another operator";
    return Response.json({ error: "locked", lockedBy }, { status: 409 });
  }

  // Already started by this same user → idempotent OK
  if (job.status === "IN_PROGRESS" && job.operatorId === userId) {
    return Response.json({ success: true, alreadyStarted: true });
  }

  if (job.status !== "READY") {
    return Response.json({ error: "Job is not in READY state" }, { status: 400 });
  }

  const machSession = await prisma.fabMachineSession.findFirst({
    where: { userId, isActive: true },
    select: { machineId: true },
  });

  // TAKE THE LOCK ATOMICALLY. The findUnique above is only for the 409 message;
  // it cannot be the lock, because between reading READY and writing
  // IN_PROGRESS another operator can do exactly the same thing. Both passed the
  // check, both wrote, and the second silently took a slab the first was already
  // cutting — the one outcome this endpoint exists to prevent.
  //
  // `status: "READY"` in the WHERE makes this a compare-and-set: the database
  // decides the winner, and the loser updates 0 rows.
  const claimed = await prisma.fabSlabJob.updateMany({
    where: { id: slabJobId, status: "READY" },
    data:  {
      status:     "IN_PROGRESS",
      startTime:  new Date(),
      operatorId: userId,
      machineId:  machSession?.machineId ?? undefined,
    },
  });

  if (claimed.count === 0) {
    // Someone claimed it between our read and our write. Re-read to name them.
    const now = await prisma.fabSlabJob.findUnique({
      where:   { id: slabJobId },
      include: { operator: { select: { name: true, email: true } } },
    });
    if (now?.operatorId === userId) return Response.json({ success: true, alreadyStarted: true });
    const lockedBy = now?.operator?.name ?? now?.operator?.email ?? "another operator";
    return Response.json({ error: "locked", lockedBy }, { status: 409 });
  }

  return Response.json({ success: true });
}
