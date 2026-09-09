"use client";
// New delivery challan. Drafts it and sends you to its own page, where it is
// issued — a challan is never created already issued, because the number is
// taken from the counter the moment it is created and somebody has to read the
// lines before the lorry leaves.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { btnPrimary, btnGhost, errorBox, today } from "@/components/commercial/invoices/ui";
import { ChallanFields, emptyDraft, draftToBody, type ChallanDraft } from "./ChallanFields";

export function ChallanNew() {
  const router = useRouter();
  const search = useSearchParams();
  const [draft, setDraft] = useState<ChallanDraft>(() => emptyDraft(today(), search.get("orderId") ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true); setError(null);
    const res = await postJson("/api/office/commercial/challans", draftToBody(draft));
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    const id = res.data?.id;
    if (id) router.push(`/office/commercial/challans/${id}`);
    else router.push("/office/commercial/challans");
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <div className={errorBox}>{error}</div>}
      <Card>
        <ChallanFields draft={draft} setDraft={setDraft} />
        <div className="mt-6 flex gap-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>Create draft challan</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => router.push("/office/commercial/challans")}>Cancel</button>
        </div>
      </Card>
    </div>
  );
}
