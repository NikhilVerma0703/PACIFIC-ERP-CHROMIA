"use client";
// One delivery challan: edit while it is a draft, issue it, cancel it, print
// it. The PDF is four pages — one per copy (Buyer, Transporter, Central
// Excise, Assessee), each carrying its own label.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, H2 } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson, postJson } from "@/lib/fab/postJson";
import { challanStatusTone, canEditChallan, canIssueChallan, canCancelChallan, CHALLAN_COPIES } from "@/lib/commercial/challan-rules";
import type { ChallanItem } from "@/lib/commercial/types";
import { inp, lbl, btnPrimary, btnGhost, btnDanger, errorBox, noteBox, money, dmy, dateValue } from "@/components/commercial/invoices/ui";
import { ChallanFields, rowsFromItems, draftToBody, type ChallanDraft } from "./ChallanFields";

interface Challan {
  id: string;
  number: string;
  challanDate: string;
  orderId: string | null;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  poRef: string | null;
  commodity: string | null;
  purpose: string | null;
  items: ChallanItem[];
  totalAmount: number | null;
  amountInWords: string | null;
  lorryNo: string | null;
  notes: string | null;
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  issuedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  order: { id: string; number: string; kind: string } | null;
  consigneeClient: { id: string; name: string } | null;
}

function toDraft(c: Challan): ChallanDraft {
  return {
    challanDate: dateValue(c.challanDate),
    orderId: c.orderId ?? "",
    consigneeClientId: c.consigneeClientId ?? "",
    consigneeName: c.consigneeName ?? "",
    consigneeAddress: c.consigneeAddress ?? "",
    consigneeGstin: c.consigneeGstin ?? "",
    poRef: c.poRef ?? "",
    commodity: c.commodity ?? "",
    purpose: c.purpose ?? "",
    lorryNo: c.lorryNo ?? "",
    notes: c.notes ?? "",
    numberOverride: "",
    items: rowsFromItems(c.items),
  };
}

export function ChallanDetail({ challanId, actions }: { challanId: string; actions: string[] }) {
  const [ch, setCh] = useState<Challan | null>(null);
  const [draft, setDraft] = useState<ChallanDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const mayWrite = actions.includes("write");

  const load = useCallback(async () => {
    const r = await fetch(`/api/office/commercial/challans/${challanId}`, { cache: "no-store" });
    const res = await readJson<Challan>(r);
    if (!res.ok) { setError(res.error ?? "Could not load the challan"); return; }
    setError(null);
    setCh(res.data);
    setDraft(toDraft(res.data as Challan));
  }, [challanId]);

  useEffect(() => { void load(); }, [load]);

  if (error && !ch) return <div className={errorBox}>{error}</div>;
  if (!ch || !draft) return <Empty>Loading…</Empty>;

  const editable = mayWrite && canEditChallan(ch.status);

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    const body = draftToBody(draft);
    delete body.numberOverride;
    const res = await patchJson(`/api/office/commercial/challans/${ch.id}`, body);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Saved.");
    await load();
  };
  const issue = async () => {
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/challans/${ch.id}/issue`, {});
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice(`Challan ${ch.number} issued.`);
    await load();
  };
  const cancel = async () => {
    if (!reason.trim()) { setError("Say why the challan is being cancelled."); return; }
    setBusy(true); setError(null); setNotice(null);
    const res = await postJson(`/api/office/commercial/challans/${ch.id}/cancel`, { reason: reason.trim() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCancelling(false); setReason("");
    setNotice(`Challan ${ch.number} cancelled.`);
    await load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-900">{ch.number}</h2>
          <Badge tone={challanStatusTone(ch.status)}>{ch.status}</Badge>
          <span className="text-sm text-gray-500">{dmy(ch.challanDate)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/office/commercial/challans/${ch.id}/pdf`} target="_blank" rel="noreferrer" className={btnGhost}>Open PDF (4 copies)</a>
          {ch.order && <Link href={`/office/commercial/orders/${ch.order.id}?tab=invoice`} className={btnGhost}>Order {ch.order.number}</Link>}
          {mayWrite && canIssueChallan(ch.status) && <button type="button" className={btnPrimary} disabled={busy} onClick={() => void issue()}>Issue challan</button>}
          {mayWrite && canCancelChallan(ch.status) && <button type="button" className={btnDanger} disabled={busy} onClick={() => setCancelling((v) => !v)}>Cancel…</button>}
        </div>
      </div>

      {error && <div className={errorBox}>{error}</div>}
      {notice && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
      {ch.status === "CANCELLED" && <div className={noteBox}>This challan is cancelled. Its number is kept so the book accounts for it.</div>}

      {cancelling && (
        <Card>
          <H2>Cancel this challan</H2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[18rem] flex-1">
              <label className={lbl} htmlFor="ch-cancel-reason">Reason</label>
              <input id="ch-cancel-reason" className={inp} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong consignee — raised again" />
            </div>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void cancel()}>Cancel challan</button>
            <button type="button" className={btnGhost} onClick={() => setCancelling(false)}>Keep it</button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <H2>Summary</H2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Consignee</dt><dd className="text-right text-gray-900">{ch.consigneeName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">GSTIN</dt><dd className="text-gray-900">{ch.consigneeGstin ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">PO ref</dt><dd className="text-gray-900">{ch.poRef ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Lorry no</dt><dd className="text-gray-900">{ch.lorryNo ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Declared value</dt><dd className="text-gray-900">{money(ch.totalAmount, "INR")}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-gray-500">Issued</dt><dd className="text-gray-900">{ch.issuedAt ? new Date(ch.issuedAt).toLocaleString("en-IN") : "—"}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">{ch.amountInWords}</p>
        </Card>
        <Card className="lg:col-span-2">
          <H2>Copies printed</H2>
          <ul className="list-inside list-decimal text-sm text-gray-700">
            {CHALLAN_COPIES.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <p className="mt-2 text-xs text-gray-400">Four A4 pages, one per copy, each labelled at the top right.</p>
        </Card>
      </div>

      <Card>
        <H2>{editable ? "Edit this draft" : "What this challan says"}</H2>
        {!editable && <p className="mb-3 text-sm text-gray-500">An issued challan is read-only. Cancel it and raise another if it was wrong.</p>}
        <ChallanFields draft={draft} setDraft={setDraft} disabled={!editable} showNumberOverride={false} />
        {editable && (
          <div className="mt-6 flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Save</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void load()}>Reset</button>
          </div>
        )}
      </Card>
    </div>
  );
}
