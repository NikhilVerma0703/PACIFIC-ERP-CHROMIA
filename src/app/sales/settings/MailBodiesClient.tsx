"use client";
import { useState } from "react";
import {
  MAIL_BODY_KEYS, DEFAULT_BODIES, MAIL_BODY_LABELS, MAIL_BODY_VARS,
} from "@/lib/sales/mailBodies";
import type { MailBodyKey } from "@/lib/sales/mailBodies";

export default function MailBodiesClient({
  initial,
}: {
  initial: Record<MailBodyKey, string>;
}) {
  const [bodies,  setBodies]  = useState<Record<MailBodyKey, string>>(initial);
  const [active,  setActive]  = useState<MailBodyKey>(MAIL_BODY_KEYS[0]);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function reset(key: MailBodyKey) {
    setBodies(b => ({ ...b, [key]: DEFAULT_BODIES[key] }));
  }

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch("/api/sales/config/mail-bodies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodies),
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

  const isModified = (key: MailBodyKey) => bodies[key] !== DEFAULT_BODIES[key];

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Edit the full HTML body for each email type. Use{" "}
        <code className="bg-slate-100 px-1 rounded text-slate-600 text-[11px]">{"{variable}"}</code>{" "}
        placeholders for dynamic data. The{" "}
        <code className="bg-slate-100 px-1 rounded text-slate-600 text-[11px]">{"{details_table}"}</code>{" "}
        placeholder is replaced with an auto-generated HTML table of order/shipment details.
      </p>

      {/* Mail type tabs */}
      <div className="flex flex-wrap gap-1.5">
        {MAIL_BODY_KEYS.map(key => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={[
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition",
              active === key
                ? "bg-teal-600 text-white border-teal-600"
                : isModified(key)
                  ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            {MAIL_BODY_LABELS[key]}
            {isModified(key) && <span className="ml-1 text-amber-500">●</span>}
          </button>
        ))}
      </div>

      {/* Active mail body editor */}
      {MAIL_BODY_KEYS.filter(k => k === active).map(key => (
        <div key={key} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">{MAIL_BODY_LABELS[key]}</span>
            {isModified(key) && (
              <button
                onClick={() => reset(key)}
                className="text-[10px] text-slate-400 hover:text-slate-700 underline"
              >
                Reset to default
              </button>
            )}
          </div>

          {/* Available variables */}
          <div className="flex flex-wrap gap-1">
            {MAIL_BODY_VARS[key].map(v => (
              <code
                key={v}
                className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded cursor-pointer hover:bg-teal-50 hover:text-teal-700 transition"
                onClick={() => {
                  // Insert variable at cursor in textarea
                  const ta = document.getElementById(`body-${key}`) as HTMLTextAreaElement;
                  if (!ta) return;
                  const start = ta.selectionStart ?? ta.value.length;
                  const end   = ta.selectionEnd   ?? ta.value.length;
                  const newVal = ta.value.slice(0, start) + v + ta.value.slice(end);
                  setBodies(b => ({ ...b, [key]: newVal }));
                  setTimeout(() => {
                    ta.focus();
                    ta.setSelectionRange(start + v.length, start + v.length);
                  }, 0);
                }}
                title="Click to insert"
              >
                {v}
              </code>
            ))}
          </div>

          <textarea
            id={`body-${key}`}
            value={bodies[key]}
            onChange={e => setBodies(b => ({ ...b, [key]: e.target.value }))}
            rows={18}
            className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white font-mono leading-relaxed resize-y"
            spellCheck={false}
          />

          {isModified(key) && (
            <details className="text-[10px] text-slate-400">
              <summary className="cursor-pointer hover:text-slate-600">Show default</summary>
              <pre className="mt-1.5 p-2 bg-slate-50 rounded-lg overflow-auto text-[9px] whitespace-pre-wrap border border-slate-100">
                {DEFAULT_BODIES[key]}
              </pre>
            </details>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save Mail Bodies"}
        </button>
        {saved  && <span className="text-sm text-green-600 font-medium">Saved</span>}
        {error  && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
