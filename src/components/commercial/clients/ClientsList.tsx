"use client";
// The customer master as Commercial uses it: search, page, open one, or add a
// new one without leaving the list.
//
// The master is SHARED with the ported International Sales module, so nothing
// here deletes: a customer who has stopped buying is made inactive on the
// detail page and comes back with "Show inactive".
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Empty, Badge } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson } from "@/lib/fab/postJson";
import {
  ClientFields, clientFormBody, emptyClientForm, btnGhost, btnPrimary, errBox, inp, okBox, warnBox,
  type ClientForm, type ClientRow,
} from "./ClientForm";

interface ListResponse {
  items: ClientRow[];
  total: number;
  page: number;
  limit: number;
}

const LIMIT = 50;

export function ClientsList({ canWrite }: { canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ClientForm>(emptyClientForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (search.trim()) params.set("q", search.trim());
    if (showInactive) params.set("all", "1");
    const r = await fetch(`/api/office/commercial/clients?${params}`, { cache: "no-store" });
    const res = await readJson<ListResponse>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the customer master"); return; }
    setError(null);
    setData(res.data);
  }, [page, search, showInactive]);

  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setSaveError("Give the customer a name."); return; }
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    setWarning(null);
    const res = await postJson("/api/office/commercial/clients", clientFormBody(form));
    setSaving(false);
    if (!res.ok) { setSaveError(res.error ?? "Could not save the customer"); return; }
    setNotice(`${res.data?.name ?? "The customer"} was added.`);
    if (res.data?.warning) setWarning(String(res.data.warning));
    setForm(emptyClientForm());
    setOpen(false);
    setPage(1);
    await load();
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col gap-4">
      {notice && <div className={okBox}>{notice}</div>}
      {warning && <div className={warnBox}>{warning} — check it is not the same customer before you raise an order.</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-1 flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}
          >
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-xs font-medium text-gray-600">Search</span>
              <input className={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, e-mail or customer code" />
            </label>
            <button type="submit" className={btnGhost}>Search</button>
            {search && (
              <button type="button" className={btnGhost} onClick={() => { setQ(""); setSearch(""); setPage(1); }}>Clear</button>
            )}
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-600">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={showInactive}
                onChange={(e) => { setShowInactive(e.target.checked); setPage(1); }} />
              Show inactive
            </label>
          </form>
          {canWrite && (
            <button type="button" className={btnPrimary} onClick={() => { setOpen((v) => !v); setSaveError(null); }}>
              {open ? "Cancel" : "New customer"}
            </button>
          )}
        </div>
      </Card>

      {open && canWrite && (
        <Card>
          <form onSubmit={create} className="flex flex-col gap-5">
            <h2 className="text-sm font-semibold text-gray-900">New customer</h2>
            {saveError && <div className={errBox}>{saveError}</div>}
            <ClientFields value={form} onChange={setForm} disabled={saving} />
            <div className="flex items-center gap-3">
              <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Add customer"}</button>
              <button type="button" className={btnGhost} onClick={() => { setOpen(false); setForm(emptyClientForm()); }} disabled={saving}>Cancel</button>
              <span className="text-xs text-gray-400">A name that already exists is allowed — you will be told, not stopped.</span>
            </div>
          </form>
        </Card>
      )}

      {error && <div className={errBox}>{error}</div>}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Place</th>
                <th className="px-4 py-3 font-medium">GSTIN</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 text-right font-medium">Enquiries</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/70">
                  <td className="px-4 py-3">
                    <Link href={`/office/commercial/clients/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link>
                    {!c.isActive && <span className="ml-2"><Badge tone="amber">Inactive</Badge></span>}
                    {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.commercialExt?.customerCode ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.commercialExt?.gstin ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.contactPerson ?? "—"}{c.phone ? <div className="text-xs text-gray-400">{c.phone}</div> : null}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{c.enquiriesCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{c.ordersCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && (
          <div className="p-6">
            <Empty>{search ? `No customer matches “${search}”.` : "No customers yet."}</Empty>
          </div>
        )}
        {loading && <div className="p-6 text-sm text-gray-500">Loading…</div>}
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} customer{total === 1 ? "" : "s"}{showInactive ? "" : " (active)"}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
