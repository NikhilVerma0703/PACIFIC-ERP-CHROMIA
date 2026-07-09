import { salesAuth as auth } from "@/lib/sales/session";
import { generateStuffingListPdf } from "@/lib/sales/pdf/stuffingListPdf";
import { NextResponse } from "next/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const pdf = await generateStuffingListPdf(id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="stuffing-list-${id}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
