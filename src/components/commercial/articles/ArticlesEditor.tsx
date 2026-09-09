"use client";
// The customer's article master (round three, answer 4): one row per (client,
// design, size) with the customer's item code, description and EAN-13. The
// crate label is generated from these rows, so a design packed with no row
// here goes out with no barcode.
//
// THE BARCODE IS JUDGED AS IT IS TYPED, by the same lib/commercial/barcode.ts
// the route runs — pure and import-free, so it costs the browser nothing — and
// the message names the digit that is wrong ("the check digit should be 8, not
// 3"). Thirteen digits copied off a customer's sheet are otherwise checked by
// eye, and the sheet is the one place nobody looks twice.
//
// READ-ONLY IS A PROP, not a <fieldset disabled>: a disabled fieldset inerts
// the Find box too, and looking a code up is the one thing a view-only login
// is here to do. A refused action is disabled WITH ITS REASON, never hidden.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson, deleteJson } from "@/lib/fab/postJson";
import { describeEan } from "@/lib/commercial/barcode";
import { sizeLabel } from "@/lib/commercial/articles-rules";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
const okBox = "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700";
const warnBox = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800";

export interface ArticleDto {
  id: string;
  clientId: string | null;
  design: string;
  lengthCm: number;
  widthCm: number;
  thicknessCm: number;
  itemCode: string | null;
  description: string | null;
  ean: string | null;
  notes: string | null;
  client?: { id: string; name: string } | null;
}

interface ClientDto { id: string; name: string }

interface Form {
  id: string | null;
  clientId: string;
  design: string;
  lengthCm: string;
  widthCm: string;
  thicknessCm: string;
  itemCode: string;
  description: string;
  ean: string;
  notes: string;
}

const EMPTY: Form = {
  id: null, clientId: "", design: "", lengthCm: "", widthCm: "", thicknessCm: "",
  itemCode: "", description: "", ean: "", notes: "",
};

const formOf = (a: ArticleDto): Form => ({
  id: a.id,
  clientId: a.clientId ?? "",
  design: a.design,
  lengthCm: String(a.lengthCm ?? ""),
  widthCm: String(a.widthCm ?? ""),
  thicknessCm: String(a.thicknessCm ?? ""),
  itemCode: a.itemCode ?? "",
  description: a.description ?? "",
  ean: a.ean ?? "",
  notes: a.notes ?? "",
});

const bodyOf = (f: Form) => ({
  clientId: f.clientId || null,
  design: f.design,
  lengthCm: f.lengthCm,
  widthCm: f.widthCm,
  thicknessCm: f.thicknessCm,
  itemCode: f.itemCode,
  description: f.description,
  ean: f.ean,
  notes: f.notes,
});

/** One screenful. The route pages (clients-rules.pageParams), and this is the
 *  page it asks for — twelve articles per design per customer means the table
 *  is thousands of rows long the moment a few customers send their sheets. */
const PAGE_SIZE = 50;

export default function ArticlesEditor({ readOnly }: { readOnly: boolean }) {
  const [items, setItems] = useState<ArticleDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<Form>(EMPTY);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (clientFilter) params.set("clientId", clientFilter);
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    const r = await fetch(`/api/office/commercial/articles?${params}`, { cache: "no-store" });
    const res = await readJson<{ items: ArticleDto[]; total?: number }>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the article list"); return; }
    setError(null);
    setItems(res.data.items ?? []);
    setTotal(Number(res.data.total ?? (res.data.items ?? []).length));
  }, [search, clientFilter, page]);

  useEffect(() => { void load(); }, [load]);

  // A new search answers from its own first page: page 4 of "Desert Silk" is
  // usually empty, and an empty table reads as "no such article".
  useEffect(() => { setPage(1); }, [search, clientFilter]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/office/commercial/clients?limit=500", { cache: "no-store" });
      const res = await readJson<{ items: ClientDto[] }>(r);
      if (res.ok && res.data) setClients(res.data.items ?? []);
    })();
  }, []);

  // The same verdict the route will give, shown while the digits are still
  // under the cursor.
  const eanVerdict = useMemo(() => describeEan(form.ean), [form.ean]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    setWarning(null);
    const res = form.id
      ? await postJsonAsPut(`/api/office/commercial/articles/${form.id}`, bodyOf(form))
      : await postJson("/api/office/commercial/articles", bodyOf(form));
    setSaving(false);
    if (!res.ok) { setSaveError(res.error ?? "Could not save the article"); return; }
    // One barcode on two sizes is the customer's business, not a refusal
    // (DECISIONS-3.md 4) — so it comes back as a warning on a saved row.
    setWarning((res.data as { warning?: string } | null)?.warning ?? null);
    setNotice(`${form.design} ${sizeLabel(Number(form.lengthCm), Number(form.widthCm), Number(form.thicknessCm))} was saved.`);
    setForm(EMPTY);
    setOpen(false);
    await load();
  }

  async function remove(a: ArticleDto) {
    const size = sizeLabel(a.lengthCm, a.widthCm, a.thicknessCm);
    if (!window.confirm(`Delete ${a.design} ${size}? Crates of it will then print with no barcode.`)) return;
    setSaveError(null);
    setNotice(null);
    setWarning(null);
    const res = await deleteJson(`/api/office/commercial/articles/${a.id}`);
    if (!res.ok) { setSaveError(res.error ?? "Could not delete the article"); return; }
    setNotice(`${a.design} ${size} was deleted.`);
    if (form.id === a.id) { setForm(EMPTY); setOpen(false); }
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && <div className={okBox}>{notice}</div>}
      {warning && <div className={warnBox}>{warning}</div>}
      {saveError && <div className={errBox}>{saveError}</div>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex flex-1 flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); setSearch(q); }}
          >
            <label className="min-w-[220px] flex-1">
              <span className={lbl}>Find</span>
              <input className={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Design, item code, description or barcode" />
            </label>
            <label className="min-w-[200px]">
              <span className={lbl}>Customer</span>
              <select className={inp} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                <option value="">Every customer</option>
                <option value="none">Ours (no customer)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button type="submit" className={btnGhost}>Search</button>
            {search && <button type="button" className={btnGhost} onClick={() => { setQ(""); setSearch(""); }}>Clear</button>}
          </form>
          <button
            type="button"
            className={btnPrimary}
            disabled={readOnly}
            title={readOnly ? "Item codes and barcodes are changed by the Commercial Manager or an admin." : undefined}
            onClick={() => { setForm(EMPTY); setOpen((v) => !v); setSaveError(null); }}
          >
            {open && !form.id ? "Cancel" : "New article"}
          </button>
        </div>
      </Card>

      {open && !readOnly && (
        <Card>
          <form onSubmit={save} className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-900">
              {form.id ? `Edit ${form.design || "article"}` : "New article"}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="lg:col-span-2">
                <span className={lbl}>Customer</span>
                <select className={inp} value={form.clientId} disabled={saving}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                  <option value="">Ours — used by any customer with no row of their own</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="lg:col-span-2">
                <span className={lbl}>Design</span>
                <input className={inp} value={form.design} disabled={saving}
                  onChange={(e) => setForm({ ...form, design: e.target.value })} placeholder="Desert Silk" />
              </label>
              <label>
                <span className={lbl}>Length (cm)</span>
                <input className={inp} value={form.lengthCm} disabled={saving} inputMode="decimal"
                  onChange={(e) => setForm({ ...form, lengthCm: e.target.value })} placeholder="101" />
              </label>
              <label>
                <span className={lbl}>Width (cm)</span>
                <input className={inp} value={form.widthCm} disabled={saving} inputMode="decimal"
                  onChange={(e) => setForm({ ...form, widthCm: e.target.value })} placeholder="19.5" />
              </label>
              <label>
                <span className={lbl}>Thickness (cm)</span>
                <input className={inp} value={form.thicknessCm} disabled={saving} inputMode="decimal"
                  onChange={(e) => setForm({ ...form, thicknessCm: e.target.value })} placeholder="2" />
              </label>
              <label>
                <span className={lbl}>Barcode (EAN-13)</span>
                <input className={inp} value={form.ean} disabled={saving}
                  onChange={(e) => setForm({ ...form, ean: e.target.value })} placeholder="8720847172228" />
              </label>
              <label className="lg:col-span-2">
                <span className={lbl}>Item code</span>
                <input className={inp} value={form.itemCode} disabled={saving}
                  onChange={(e) => setForm({ ...form, itemCode: e.target.value })} placeholder="CQBE 101x19.5x2" />
              </label>
              <label className="lg:col-span-2">
                <span className={lbl}>Description</span>
                <input className={inp} value={form.description} disabled={saving}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="WINDOW SILLS 101x19.5x2" />
              </label>
              <label className="lg:col-span-4">
                <span className={lbl}>Notes</span>
                <input className={inp} value={form.notes} disabled={saving}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Where these codes came from" />
              </label>
            </div>

            {!eanVerdict.ok && <div className={errBox}>{eanVerdict.message}</div>}
            {eanVerdict.ok && eanVerdict.value && (
              <p className="text-xs text-green-700">{eanVerdict.value} is a valid EAN-13.</p>
            )}
            {eanVerdict.ok && !eanVerdict.value && (
              <p className="text-xs text-gray-500">
                No barcode: crates of this article print the item code and the size, with no bars.
              </p>
            )}

            <div className="flex items-center gap-3">
              <button type="submit" className={btnPrimary} disabled={saving || !eanVerdict.ok}>
                {saving ? "Saving…" : form.id ? "Save changes" : "Add article"}
              </button>
              <button type="button" className={btnGhost} disabled={saving}
                onClick={() => { setForm(EMPTY); setOpen(false); setSaveError(null); }}>Cancel</button>
              <span className="text-xs text-gray-400">
                The customer, the design and the size are the key — the same three twice is refused.
              </span>
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
                <th className="px-4 py-3 font-medium">Design</th>
                <th className="px-4 py-3 font-medium">Size (cm)</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Item code</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Barcode</th>
                <th className="px-4 py-3 text-right font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const v = describeEan(a.ean);
                return (
                  <tr key={a.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.design}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-700">{sizeLabel(a.lengthCm, a.widthCm, a.thicknessCm)}</td>
                    <td className="px-4 py-3 text-gray-600">{a.client?.name ?? <span className="text-gray-400">Ours</span>}</td>
                    <td className="px-4 py-3 text-gray-700">{a.itemCode ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{a.description ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {a.ean
                        ? <span className={v.ok ? "text-gray-700" : "text-red-600"} title={v.message ?? undefined}>{a.ean}</span>
                        : <span className="text-gray-400">no barcode</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btnGhost} disabled={readOnly}
                          title={readOnly ? "Item codes and barcodes are changed by the Commercial Manager or an admin." : undefined}
                          onClick={() => { setForm(formOf(a)); setOpen(true); setSaveError(null); }}>Edit</button>
                        <button type="button" className={btnGhost} disabled={readOnly}
                          title={readOnly ? "Item codes and barcodes are changed by the Commercial Manager or an admin." : undefined}
                          onClick={() => void remove(a)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr><td colSpan={7} className="px-4 py-8">
                  <Empty>{loading ? "Loading…" : "No articles yet. Add one per design and size the customer sells, with their item code and barcode."}</Empty>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
            <span>
              {items.length ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + items.length}` : "0"} of {total} article(s)
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} disabled={page <= 1 || loading}
                title={page <= 1 ? "This is the first page." : undefined}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" className={btnGhost} disabled={page >= pages || loading}
                title={page >= pages ? "This is the last page." : undefined}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** PUT with postJson's contract — the shared helper has postJson, patchJson and
 *  deleteJson but no PUT, and this route is a whole-row replace (the key itself
 *  is editable), so PUT is the honest verb. */
async function postJsonAsPut(url: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, error: null, data };
    return { ok: false, status: res.status, error: String(data?.error ?? `Could not save (error ${res.status}).`), data };
  } catch {
    return { ok: false, status: 0, error: "No connection — the change was not saved. Try again.", data: null };
  }
}
