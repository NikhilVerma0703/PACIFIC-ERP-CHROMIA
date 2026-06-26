import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { cookies } from "next/headers";

export async function POST() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  await prisma.fabMachineSession.updateMany({
    where: { userId: g.user.id, isActive: true },
    data: { isActive: false, logoutTime: new Date() },
  });

  const cookieStore = await cookies();
  cookieStore.delete("fab_machine_type");
  cookieStore.delete("fab_machine_id");
  cookieStore.delete("fab_machine_name");
  cookieStore.delete("fab_session_id");

  return Response.redirect(
    new URL("/fab/session", process.env.NEXTAUTH_URL ?? "http://localhost:3000"),
    303
  );
}
