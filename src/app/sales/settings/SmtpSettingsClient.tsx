"use client";
import { useEffect, useState } from "react";

type SmtpData = {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassSet?: boolean; // server won't return the actual password
};

export default function SmtpSettingsClient() {
  const [form, setForm]   = useState({ smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [isSet,   setIsSet]   = useState(false);

  useEffect(() => {
    fetch("/api/sales/me")
      .then(r => r.json())
      .then((d: SmtpData & { smtpPass?: string }) => {
        setForm(f => ({
          ...f,
          smtpHost: d.smtpHost ?? "",
          smtpPort: d.smtpPort ? String(d.smtpPort) : "587",
          smtpUser: d.smtpUser ?? "",
          smtpPass: "",   // never pre-fill password
        }));
        setIsSet(!!(d.smtpHost && d.smtpUser));
        setLoaded(true);
      });
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true); setSaved(false); setError(""); setTestMsg("");
    const body: Record<string, unknown> = {
      smtpHost: form.smtpHost || null,
      smtpPort: form.smtpPort ? Number(form.smtpPort) : null,
      smtpUser: form.smtpUser || null,
    };
    if (form.smtpPass) body.smtpPass = form.smtpPass; // only send if changed
    const r = await fetch("/api/sales/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    setSaved(true);
    setIsSet(!!(form.smtpHost && form.smtpUser));
    setForm(f => ({ ...f, smtpPass: "" }));
    setTimeout(() => setSaved(false), 3000);
  }

  async function sendTest() {
    if (!form.smtpHost || !form.smtpUser) { setTestMsg("Save SMTP settings first."); return; }
    setTesting(true); setTestMsg("");
    const r = await fetch("/api/sales/me/test-smtp", { method: "POST" });
    setTesting(false);
    const d = await r.json();
    setTestMsg(r.ok ? "✓ Test email sent to your inbox!" : `✗ ${d.error ?? "Failed"}`);
  }

  if (!loaded) return <p className="text-xs text-slate-400">Loading…</p>;

  const presets = [
    { label: "Gmail",   host: "smtp.gmail.com",   port: "587" },
    { label: "Outlook", host: "smtp.office365.com",port: "587" },
    { label: "Yahoo",   host: "smtp.mail.yahoo.com",port:"465" },
  ];

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border ${
        isSet
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-amber-50 text-amber-700 border-amber-200"
      }`}>
        {isSet
          ? `✓ SMTP configured — sending from ${form.smtpUser}`
          : "⚠ SMTP not configured — emails will not be sent until this is set up"}
      </div>

      {/* Provider presets */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Quick Preset</p>
        <div className="flex gap-2">
          {presets.map(p => (
            <button key={p.label}
              onClick={() => setForm(f => ({ ...f, smtpHost: p.host, smtpPort: p.port }))}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 transition text-slate-600">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">SMTP Host</label>
          <input value={form.smtpHost} onChange={e => set("smtpHost", e.target.value)}
            placeholder="smtp.gmail.com"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Port</label>
          <input type="number" value={form.smtpPort} onChange={e => set("smtpPort", e.target.value)}
            placeholder="587"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-[10px] text-slate-400 mt-0.5">587 = TLS (recommended) · 465 = SSL · 25 = plain</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Email / Username</label>
          <input type="email" value={form.smtpUser} onChange={e => set("smtpUser", e.target.value)}
            placeholder="you@gmail.com"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Password / App Password {isSet && <span className="text-slate-400 font-normal">(leave blank to keep current)</span>}
          </label>
          <input type="password" value={form.smtpPass} onChange={e => set("smtpPass", e.target.value)}
            placeholder={isSet ? "••••••••" : "App password"}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-[10px] text-slate-400 mt-0.5">
            For Gmail: use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer"
              className="underline text-blue-500">App Password</a>, not your Google password.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition">
          {saving ? "Saving…" : "Save SMTP Settings"}
        </button>
        {isSet && (
          <button onClick={sendTest} disabled={testing}
            className="px-4 py-2 text-sm font-semibold border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition">
            {testing ? "Sending…" : "Send Test Email"}
          </button>
        )}
        {saved  && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
        {error  && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {testMsg && (
        <p className={`text-xs font-medium ${testMsg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>
          {testMsg}
        </p>
      )}
    </div>
  );
}
