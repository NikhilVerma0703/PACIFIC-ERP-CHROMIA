/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/orders/[id]/shipping-docs-email
 * Sends the Shipping Documents email -- attaches BL, Fumigation, Bank Details, Combined Invoice PDF.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { NextResponse } from "next/server";
import { sendShippingDocsEmail } from "@/lib/sales/sendShippingDocsEmail";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;

  try {
    const result = await sendShippingDocsEmail(id, (session.user as any).id);
    return NextResponse.json({ ok: true, sentTo: result.sentTo });
  } catch (e: any) {
    const status = e.message?.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: e.message ?? "Failed to send" }, { status });
  }
}
