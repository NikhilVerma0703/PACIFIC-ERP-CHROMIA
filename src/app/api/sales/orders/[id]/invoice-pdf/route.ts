/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { generateInvoicePdf } from "@/lib/sales/pdf/invoicePdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  try {
    const buf = await generateInvoicePdf(id);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Invoice-${id}.pdf"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
