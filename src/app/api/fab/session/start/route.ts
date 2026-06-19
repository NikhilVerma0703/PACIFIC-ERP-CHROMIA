import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const fabRole = (session.user as any).fabRole;
  if (!fabRole) return Response.json({ error: "No fab role" }, { status: 403 });

  const { machineId, shift } = await req.json();
  if (!machineId || !shift) return Response.json({ error: "machineId and shift required" }, { status: 400 });

  const machine = await prisma.fabMachine.findUnique({ where: { id: machineId } });
  if (!machine) return Response.json({ error: "Machine not found" }, { status: 404 });

  // End any existing active sessions for this user
  await prisma.fabMachineSession.updateMany({
    where: { userId: (session.user as any).id, isActive: true },
    data: { isActive: false, logoutTime: new Date() },
  });

  // Create new session
  const machineSession = await prisma.fabMachineSession.create({
    data: {
      userId: (session.user as any).id,
      machineId,
      shift,
      isActive: true,
    },
  });

  // Set cookie: machineType drives routing in middleware
  const cookieStore = await cookies();
  cookieStore.set("fab_machine_type", machine.type, {
    httpOnly: false, // needs to be readable client-side for layout
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
    sameSite: "lax",
  });
  cookieStore.set("fab_machine_id", machine.id, {
    httpOnly: false,
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
  });
  cookieStore.set("fab_machine_name", machine.name, {
    httpOnly: false,
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
  });
  cookieStore.set("fab_session_id", machineSession.id, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
  });

  const MACHINE_URLS: Record<string, string> = {
    CUTTING: "/fab/cutting",
    POLISHING: "/fab/polishing",
    SINK_CUTTING: "/fab/sink-cutting",
    FABRICATION: "/fab/fabrication",
    PACKAGING: "/fab/packaging",
  };

  return Response.json({ success: true, redirect: MACHINE_URLS[machine.type] ?? "/fab/cutting" });
}
