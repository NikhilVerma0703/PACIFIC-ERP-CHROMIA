import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/rbac";
import { configuredProviderName, serverProvider, OcrUnsupportedError } from "@/lib/ocr";

export const dynamic = "force-dynamic";
// OCR on a scanned bill is slower than a normal request but nowhere near the
// platform ceiling; 60 is the Hobby-plan maximum and leaves room for a large
// photograph.
export const maxDuration = 60;

// Deliberately NOT under /api/office/finance/*, which is the catch-all proxy to
// the Python engine. A static segment there would silently shadow one of its
// allowlisted routes; keeping this on its own path means the two cannot
// collide as either grows.

/** Same gate as the finance proxy: FINANCE / ACCOUNTS in Office, or an admin. */
async function gate(): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  const role = (u as { role?: string }).role ?? "";
  const branch = ((u as { branch?: string }).branch as string | undefined) ?? "SHOP_FLOOR";
  return role === "ADMIN" || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS"));
}

export async function POST(req: NextRequest) {
  if (!(await gate())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = serverProvider();
  if (!provider) {
    // OCR_PROVIDER is tesseract: the work belongs in the browser, and saying so
    // is better than quietly doing it here at ten times the latency.
    return NextResponse.json({
      error: `OCR_PROVIDER is "${configuredProviderName()}", which runs in the browser. ` +
             "This endpoint serves the server-side providers (claude, google).",
    }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a bill as `file`." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Bill is larger than 10 MB." }, { status: 413 });
  }

  const input = {
    data: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type || "image/jpeg",
    handwritten: String(form?.get("handwritten") ?? "") === "true",
  };

  try {
    const result = await provider.run(input);
    return NextResponse.json(result);
  } catch (e) {
    // A refusal is a correct outcome, not a fault: this bill goes to manual
    // entry. 422 distinguishes it from a provider that actually broke, so the
    // UI can say "type this one in" rather than "try again".
    if (e instanceof OcrUnsupportedError) {
      return NextResponse.json({ error: e.message, manualEntry: true }, { status: 422 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OCR failed." },
      { status: 502 },
    );
  }
}
