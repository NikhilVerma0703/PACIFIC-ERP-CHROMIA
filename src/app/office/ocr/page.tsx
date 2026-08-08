import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { configuredProviderName } from "@/lib/ocr";
import { OcrPanel } from "./OcrPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bill OCR | Pacific ERP" };

export default async function OcrPage() {
  // Same gate as the finance pages; middleware enforces it earlier, this is the
  // in-page half other office routes also carry.
  const u = await currentUser();
  const role = (u as { role?: string } | null)?.role ?? "";
  const branch = ((u as { branch?: string } | null)?.branch as string | undefined) ?? "SHOP_FLOOR";
  if (!(role === "ADMIN" || (branch === "OFFICE" && (role === "FINANCE" || role === "ACCOUNTS")))) {
    redirect("/");
  }

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Bill OCR</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Reads a bill inside the ERP — no Python engine, no separate service. Which
          engine does the reading is set by <span className="font-mono">OCR_PROVIDER</span>:
          {" "}<span className="font-mono">tesseract</span> (free, runs in your browser, cannot
          read handwriting), <span className="font-mono">claude</span> or{" "}
          <span className="font-mono">google</span> (both read handwriting, both upload the bill).
        </p>
      </div>
      <OcrPanel provider={configuredProviderName()} />
    </Shell>
  );
}
