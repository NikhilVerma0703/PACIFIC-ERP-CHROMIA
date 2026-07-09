/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { NextResponse } from "next/server";
import { getMailBodies, saveMailBodies, DEFAULT_BODIES, MAIL_BODY_KEYS } from "@/lib/sales/mailBodies";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const custom = await getMailBodies();
  const result: Record<string, string> = {};
  for (const key of MAIL_BODY_KEYS) {
    result[key] = custom[key] ?? DEFAULT_BODIES[key];
  }
  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  if (salesRole !== "SALES_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const toSave: any = {};
  for (const key of MAIL_BODY_KEYS) {
    if (key in body && typeof body[key] === "string") {
      toSave[key] = body[key] || DEFAULT_BODIES[key];
    }
  }
  await saveMailBodies(toSave);
  return NextResponse.json({ ok: true });
}
