"use client";
import { useState } from "react";
import { MAIL_SUBJECT_KEYS, DEFAULT_SUBJECTS, MAIL_SUBJECT_LABELS } from "@/lib/sales/mailSubjects";
import type { MailSubjectKey } from "@/lib/sales/mailSubjects";

export default function MailSubjectsClient({
  initial,
}: {
  initial: Record<MailSubjectKey, string>;
}) {
  const [subjects, setSubjects] = useState<Record<MailSubjectKey, string>>(initial);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  function reset(key: MailSubjectKey) {
    setSubjects(s => ({ ...s, [key]: DEFAULT_SUBJECTS[key] }));
  }

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch("/api/sales/config/mail-subjects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subjects),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Customize email subject lines. Use <code className="bg-slate-100 px-1 rounded text-slate-600">{"{invoiceNo}"}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded text-slate-600">{"{piNumber}"}</code>,{" "}
        <code className="bg-slate-100 px-1 rounded text-slate-600">{"{clientName}"}</code> as placeholders.
      </p>

      {MAIL_SUBJECT_KEYS.map(key => (
        <div key={key}>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-600">{MAIL_SUBJECT_LABELS[key]}</label>
            {subjects[key] !== DEFAULT_SUBJECTS[key] && (
              <button
                type="button"
                onClick={() => reset(key)}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline"
              >
                Reset to default
              </button>
            )}
          </div>
          <input
            type="text"
            value={subjects[key]}
            onChange={e => setSubjects(s => ({ ...s, [key]: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white font-mono"
          />
          {subjects[key] !== DEFAULT_SUBJECTS[key] && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              Default: <span className="text-slate-500">{DEFAULT_SUBJECTS[key]}</span>
            </p>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save Templates"}
        </button>
        {saved  && <span className="text-sm text-green-600 font-medium">Saved</span>}
        {error  && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
