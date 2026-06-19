import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { cookies } from "next/headers";

export async function POST() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // End DB session
  await prisma.fabMachineSession.updateMany({
    where: { userId: (session.user as any).id, isActive: true },
    data: { isActive: false, logoutTime: new Date() },
  });

  // Clear cookies
  const cookieStore = await cookies();
  cookieStore.delete("fab_machine_type");
  cookieStore.delete("fab_machine_id");
  cookieStore.delete("fab_machine_name");
  cookieStore.delete("fab_session_id");

  return Response.json({ success: true });
}
