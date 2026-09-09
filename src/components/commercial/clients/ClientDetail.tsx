"use client";
// One customer: the whole record on one editable form, plus the enquiries and
// orders already on it.
//
// Saving sends every field, because the form shows every field — clearing a
// box on screen is meant to clear the column. `isActive` is the exception: it
// has its own control, so a save can never deactivate a customer by accident.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson } from "@/lib/fab/postJson";
import {
  ClientFields, clientFormBody, clientFormFrom, emptyClientForm, btnGhost, btnPrimary, errBox, okBox, warnBox,
  type ClientForm, type ClientRow,
} from "./ClientForm";

interface EnquiryLite { id: string; number: string; status: string; subject: string | null; receivedAt: string; orderId: string | null }
interface OrderLite { id: string; number: string; kind: string; status: string; currency: string; createdAt: string }
interface ClientDetailRow extends ClientRow {
  enquiries: EnquiryLite[];
  orders: OrderLite[];
  warning?: string | null;
}

const date = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-IN") : "—");

export function ClientDetail({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const [row, setRow] = useState<ClientDetailRow | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyClientForm);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/office/commercial/clients/${clientId}`, { cache: "no-store" });
    const res = await readJson<ClientDetailRow>(r);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the customer"); return; }
    setError(null);
    setRow(res.data);
    setForm(clientFormFrom(res.data));
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setSaveError("The customer needs a name."); return; }
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    setWarning(null);
    const res = await patchJson(`/api/office/commercial/clients/${clientId}`, clientFormBody(form));
    setSaving(false);
    if (!res.ok) { setSaveError(res.error ?? "Could not save"); return; }
    setNotice("Saved.");
    if (res.data?.warning) setWarning(String(res.data.warning));
    setRow(res.data as ClientDetailRow);
    setForm(clientFormFrom(res.data as ClientDetailRow));
  }

  async function setActive(active: boolean) {
    setSaving(true);
    setSaveError(null);
    const res = await patchJson(`/api/office/commercial/clients/${clientId}`, { isActive: active });
    setSaving(false);
    if (!res.ok) { setSaveError(res.error ?? "Could not change this"); return; }
    setNotice(active ? "Customer is active again." : "Customer marked inactive — it stays on every document already raised.");
    setRow(res.data as ClientDetailRow);
  }

  if (error) return <div className={errBox}>{error}</div>;
  if (!row) return <Empty>Loading…</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{row.name}</h1>
            {row.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {[row.commercialExt?.customerCode, row.city, row.country].filter(Boolean).join(" · ") || "No code or place on file"}
            {" · "}added {date(row.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/office/commercial/clients" className={btnGhost}>All customers</Link>
          {canWrite && (
            <button type="button" className={btnGhost} disabled={saving} onClick={() => void setActive(!row.isActive)}>
              {row.isActive ? "Mark inactive" : "Make active"}
            </button>
          )}
        </div>
      </div>

      {notice && <div className={okBox}>{notice}</div>}
      {warning && <div className={warnBox}>{warning} — check it is not the same customer twice.</div>}
      {saveError && <div className={errBox}>{saveError}</div>}

      <Card>
        <form onSubmit={save} className="flex flex-col gap-5">
          <ClientFields value={form} onChange={setForm} disabled={!canWrite || saving} />
          {canWrite && (
            <div className="flex items-center gap-3">
              <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save customer"}</button>
              <button type="button" className={btnGhost} onClick={() => setForm(clientFormFrom(row))} disabled={saving}>Undo changes</button>
            </div>
          )}
        </form>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Enquiries ({row.enquiriesCount})</h2>
            <Link href={`/office/commercial/enquiries?clientId=${row.id}`} className="text-xs text-brand hover:underline">See all</Link>
          </div>
          {row.enquiries.length === 0 ? <div className="text-sm text-gray-500">None yet.</div> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {row.enquiries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/office/commercial/enquiries/${e.id}`} className="font-medium text-brand hover:underline">{e.number}</Link>
                    <div className="truncate text-xs text-gray-500">{e.subject ?? "—"}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge>{e.status}</Badge>
                    <div className="text-xs text-gray-400">{date(e.receivedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Orders ({row.ordersCount})</h2>
            <Link href={`/office/commercial/orders?clientId=${row.id}`} className="text-xs text-brand hover:underline">See all</Link>
          </div>
          {row.orders.length === 0 ? <div className="text-sm text-gray-500">None yet.</div> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {row.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/office/commercial/orders/${o.id}`} className="font-medium text-brand hover:underline">{o.number}</Link>
                    <div className="text-xs text-gray-500">{o.kind} · {o.currency}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge>{o.status.replace(/_/g, " ")}</Badge>
                    <div className="text-xs text-gray-400">{date(o.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
