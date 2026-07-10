"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cutOver } from "./actions";
import type { SyncRow } from "@/lib/airtableSync";

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const dur = (h: number) => (h >= 24 ? `${Math.floor(h / 24)}d ${Math.round(h % 24)}h` : `${Math.round(h)}h`);

function StatusBadge({ r }: { r: SyncRow }) {
  switch (r.status) {
    case "LIVE":
      return <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">● LIVE in ERP{r.cutoverBy ? ` · ${r.cutoverBy === "auto" ? "auto" : r.cutoverBy}` : ""}{r.cutoverAt ? ` · ${fmt(r.cutoverAt)}` : ""}</span>;
    case "READY":
      return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">✓ ready — cutting over on next sync</span>;
    case "VERIFYING":
      return <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">⚠ count mismatch — Airtable {r.airtableTotal?.toLocaleString("en-IN")} vs ERP {r.recRows.toLocaleString("en-IN")}</span>;
    case "QUIET":
      return <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">🕐 Airtable quiet {dur(r.quietHours)}{r.parityOk ? " · data complete — waiting for ERP entries" : " · verifying completeness…"}</span>;
    default:
      return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">⟳ syncing from Airtable</span>;
  }
}

export function MigrationClient({ rows }: { rows: SyncRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const live = rows.filter((r) => r.source === "ERP").length;

  function override(r: SyncRow) {
    const toErp = r.source !== "ERP";
    const q = toErp
      ? `Force ${r.tableName} LIVE now, skipping the automatic checks?\n\nNormally a table cuts itself over once Airtable has been quiet 48h, the record counts match, and operators are entering in the ERP. Only force it if you're sure no one will enter this data in Airtable again.`
      : `Move ${r.tableName} BACK to Airtable as source? The automatic sync resumes and Airtable values will overwrite ERP edits to synced records.`;
    if (!window.confirm(q)) return;
    setBusy(r.model); setMsg(null);
    start(async () => {
      const res = await cutOver(r.model, toErp);
      setMsg({ ok: res.ok, text: res.message });
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <span className="rounded-lg bg-gray-100 px-3 py-1.5 font-medium text-gray-700">{live} of {rows.length} tables live in ERP</span>
        <span>Sync runs automatically every 30 minutes — no manual syncing.</span>
      </div>

      {msg && <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="px-4 py-2.5">Table</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">ERP rows</th><th className="px-4 py-2.5 text-right">from Airtable</th><th className="px-4 py-2.5">Last auto-sync</th><th className="px-4 py-2.5"></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-b border-gray-50">
                <td className="px-4 py-2"><div className="font-medium text-gray-900">{r.tableName}</div><div className="text-[11px] text-gray-400">{r.model}{r.nativeRecent ? " · ERP entries this week ✓" : ""}</div></td>
                <td className="px-4 py-2"><StatusBadge r={r} /></td>
                <td className="px-4 py-2 text-right tabular-nums">{r.erpRows < 0 ? "—" : r.erpRows.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.recRows < 0 ? "—" : r.recRows.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-gray-500">{fmt(r.lastSyncAt)}{r.lastCount > 0 ? ` · ${r.lastCount} pulled` : ""}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    disabled={pending}
                    onClick={() => override(r)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${r.source === "ERP" ? "border border-gray-300 text-gray-500 hover:bg-gray-50" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}
                  >{busy === r.model ? "…" : r.source === "ERP" ? "Revert to Airtable" : "Force live now"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
