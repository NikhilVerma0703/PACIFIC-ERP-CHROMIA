/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { NextResponse } from "next/server";
import { getMailSubjects, saveMailSubjects, DEFAULT_SUBJECTS, MAIL_SUBJECT_KEYS } from "@/lib/sales/mailSubjects";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const custom = await getMailSubjects();
  // Return merged: default overridden by custom
  const result: Record<string, string> = {};
  for (const key of MAIL_SUBJECT_KEYS) {
    result[key] = custom[key] ?? DEFAULT_SUBJECTS[key];
  }
  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  // Only save recognised keys
  const toSave: any = {};
  for (const key of MAIL_SUBJECT_KEYS) {
    if (key in body && typeof body[key] === "string") {
      toSave[key] = body[key].trim() || DEFAULT_SUBJECTS[key];
    }
  }

  await saveMailSubjects(toSave);
  return NextResponse.json({ ok: true });
}
