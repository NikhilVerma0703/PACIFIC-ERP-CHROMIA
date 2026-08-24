"use client";
import { useEffect, useState } from "react";
import { readJson } from "@/lib/readJson";

type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  country: string | null; city: string | null; contactPerson: string | null;
  ccEmails: string[];
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const EMPTY = { name: "", email: "", phone: "", country: "", city: "", contactPerson: "", ccEmails: [] as string[] };

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true); setLoadError("");
    // readJson + finally — see sales/orders/page.tsx. Also only ever stores an
    // array: an `{error}` body used to be stored as the list and crash .filter.
    try {
      const r = await fetch("/api/sales/clients");
      const res = await readJson<unknown>(r);
      if (!res.ok) { setLoadError(res.error ?? `Could not load clients (HTTP ${res.status}).`); return; }
      if (Array.isArray(res.data)) setClients(res.data);
    } catch (e) {
      setLoadError(e instanceof Error && e.message ? `Could not reach the server: ${e.message}` : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY); setEditing(null); setError(""); setModal("new");
  }
  function openEdit(c: Client) {
    setForm({
      name: c.name, email: c.email ?? "", phone: c.phone ?? "",
      country: c.country ?? "", city: c.city ?? "", contactPerson: c.contactPerson ?? "",
      ccEmails: c.ccEmails ?? [],
    });
    setEditing(c); setError(""); setModal("edit");
  }

  function addCc() {
    setForm(f => ({ ...f, ccEmails: [...f.ccEmails, ""] }));
  }
  function updateCc(i: number, val: string) {
    setForm(f => {
      const cc = [...f.ccEmails];
      cc[i] = val;
      return { ...f, ccEmails: cc };
    });
  }
  function removeCc(i: number) {
    setForm(f => ({ ...f, ccEmails: f.ccEmails.filter((_, j) => j !== i) }));
  }

  async function save() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const url  = modal === "edit" ? `/api/sales/clients/${editing!.id}` : "/api/sales/clients";
    const meth = modal === "edit" ? "PATCH" : "POST";
    try {
      const r = await fetch(url, {
        method: meth,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ccEmails: form.ccEmails.filter(e => e.trim()) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        setError(d.error ?? `Save failed (${r.status})`);
        return;
      }
    } catch {
      setError("Network error — please retry.");
      return;
    } finally {
      setSaving(false);
    }
    setModal(null); load();
  }
  async function del(id: string) {
    if (!confirm("Delete this client?")) return;
    const r = await fetch(`/api/sales/clients/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({} as { error?: string }));
      alert(d.error ?? "Delete failed");
      return;
    }
    load();
  }

  const filtered = clients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.country ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark transition">
          <span className="text-lg leading-none">+</span> Add Client
        </button>
      </div>

      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or country…"
          className="w-64 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      {loadError && <div className="text-sm text-red-600 py-3 text-center">{loadError}</div>}
      {loading ? (
        <div className="text-sm text-slate-400 py-12 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-400 py-12 text-center">No clients yet. Add your first client to get started.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Client</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Contact</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Country</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">CC</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.contactPerson ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{c.country ?? "—"}{c.city ? `, ${c.city}` : ""}</td>
                  <td className="px-4 py-3 text-slate-500">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {(c.ccEmails ?? []).length > 0
                      ? <span className="text-teal-600 font-medium">{c.ccEmails.length} CC</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)}
                      className="text-slate-400 hover:text-teal-600 text-xs font-medium mr-3 transition">Edit</button>
                    <button onClick={() => del(c.id)}
                      className="text-slate-300 hover:text-red-500 text-xs font-medium transition">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === "new" ? "New Client" : "Edit Client"} onClose={() => setModal(null)}>
          <div className="space-y-3">
            {[
              { label: "Company Name *", key: "name" },
              { label: "Contact Person", key: "contactPerson" },
              { label: "Email", key: "email" },
              { label: "Phone", key: "phone" },
              { label: "Country", key: "country" },
              { label: "City", key: "city" },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            ))}

            {/* CC Emails */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">CC Emails</label>
                <button type="button" onClick={addCc}
                  className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 border border-teal-200 rounded-md hover:bg-teal-50 transition">
                  <span className="text-sm leading-none">+</span> Add CC
                </button>
              </div>
              {form.ccEmails.length === 0 && (
                <p className="text-xs text-slate-400 italic">No CC recipients. Auto-included on all emails to this customer.</p>
              )}
              {form.ccEmails.map((cc, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <input
                    type="email"
                    value={cc}
                    onChange={e => updateCc(i, e.target.value)}
                    placeholder="cc@example.com"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <button type="button" onClick={() => removeCc(i)}
                    className="text-slate-300 hover:text-red-400 text-lg leading-none transition">×</button>
                </div>
              ))}
              {form.ccEmails.length > 0 && (
                <p className="text-xs text-slate-400 mt-1.5">These addresses are auto-added as CC on all emails sent for this customer.</p>
              )}
            </div>

            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
