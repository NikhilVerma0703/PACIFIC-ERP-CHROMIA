"use client";
import { useState } from "react";

type Config = {
  companyName?:    string;
  companyAddress?: string;
  iecCode?:        string;
  gstNo?:          string;
  panNo?:          string;
  bankName?:       string;
  bankBranch?:     string;
  accountNo?:      string;
  ifscCode?:       string;
  swiftCode?:      string;
  adCode?:         string;
  ccEmails?:       string[];
  ceoEmail?:       string;
};

export default function CompanyConfigClient({ initial }: { initial: Config }) {
  const [form, setForm] = useState<Config>(initial);
  const [ccRaw, setCcRaw]   = useState((initial.ccEmails ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function field(label: string, key: keyof Config, hint?: string) {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
        <input
          value={(form[key] as string) ?? ""}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          placeholder={hint}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>
    );
  }

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      const payload = {
        ...form,
        ccEmails: ccRaw.split(",").map(e => e.trim()).filter(Boolean),
      };
      const res = await fetch("/api/sales/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Company Identity */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Company Identity</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Company Name", "companyName", "Pacific Engineered Surfaces Private Limited")}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Company Address</label>
            <textarea
              rows={3}
              value={form.companyAddress ?? ""}
              onChange={e => setForm(f => ({ ...f, companyAddress: e.target.value }))}
              placeholder="SY.NO.73/2B, NALLAGANAKOTAPALLI VILLAGE..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
            />
          </div>
          {field("IEC Code", "iecCode", "AALCP2750N")}
          {field("GSTIN No.", "gstNo", "33AALCP2750N1Z3")}
          {field("PAN No.", "panNo", "AALCP2750N")}
        </div>
      </div>

      {/* Bank Details */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Bank Details</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Bank Name", "bankName", "Kotak Mahindra Bank Limited")}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Bank Branch / Address</label>
            <textarea
              rows={2}
              value={form.bankBranch ?? ""}
              onChange={e => setForm(f => ({ ...f, bankBranch: e.target.value }))}
              placeholder="10/7, Umiya Landmark, Lavelle Road, Bangalore 560001"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
            />
          </div>
          {field("Account No.", "accountNo", "3214292773")}
          {field("IFSC Code",   "ifscCode",  "KKBK0000958")}
          {field("SWIFT Code",  "swiftCode", "KKBKINBBXXX")}
          {field("AD Code",     "adCode",    "0180038-8400009")}
        </div>
      </div>

      {/* Email Settings */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Email Settings</p>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            CC Emails <span className="text-slate-400 font-normal">(comma-separated -- always CC on every sales mail)</span>
          </label>
          <input
            value={ccRaw}
            onChange={e => setCcRaw(e.target.value)}
            placeholder="customs@thepacific.group, accounts@thepacific.group"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            CEO Email <span className="text-slate-400 font-normal">(receives escalation alerts when payment is 7+ days overdue after 99% collected)</span>
          </label>
          <input
            value={form.ceoEmail ?? ""}
            onChange={e => setForm(f => ({ ...f, ceoEmail: e.target.value }))}
            placeholder="ceo@thepacific.group"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        {saved  && <span className="text-sm text-green-600 font-medium">Saved successfully</span>}
        {error  && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
