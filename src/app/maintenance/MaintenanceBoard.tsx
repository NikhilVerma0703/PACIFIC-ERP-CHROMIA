"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, H2, Badge } from "@/components/ui";
import { raise, answer } from "./actions";
import type { Ticket } from "@/lib/maintenanceLog";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";

const CLOSED = new Set(["Resolved", "Not required"]);

/** Priority colour. "Line down" is red because it is not a severity, it is an
 *  emergency — the list is sorted on it and the eye should find it too. */
const PRIORITY_TONE: Record<string, "red" | "amber" | "brand" | "green"> = {
  "Line down": "red", High: "amber", Normal: "brand", Low: "green",
};
const STATUS_TONE: Record<string, "red" | "amber" | "brand" | "green"> = {
  Pending: "amber", Attended: "brand", Resolved: "green", "Not required": "green",
};

const ago = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return "";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
};

export function MaintenanceBoard({
  tickets, canRaise, canAnswer, priorities, statuses,
}: {
  tickets: Ticket[];
  canRaise: boolean;
  canAnswer: boolean;
  priorities: string[];
  statuses: string[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // Raise form
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState("Normal");

  // Which ticket is being answered, and with what
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("Attended");

  const shown = tickets.filter((t) => showClosed || !CLOSED.has(t.status));

  const submitRaise = () =>
    start(async () => {
      const r = await raise({ title, area, detail, priority });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setTitle(""); setArea(""); setDetail(""); setPriority("Normal"); }
    });

  const submitAnswer = (id: string) =>
    start(async () => {
      const r = await answer(id, status, reply);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setOpenId(null); setReply(""); setStatus("Attended"); }
    });

  return (
    <div className="space-y-5">
      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {canRaise && (
        <Card>
          <H2>Report a fault</H2>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <span className={label}>What is wrong</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp}
                placeholder="Mixer 2 discharge gate sticking" />
            </div>
            <div>
              <span className={label}>Machine or area</span>
              <input value={area} onChange={(e) => setArea(e.target.value)} className={inp}
                placeholder="Mixer 2" />
            </div>
            <div className="md:col-span-2">
              <span className={label}>Detail — what you saw, when, what you already tried</span>
              <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={inp}
                placeholder="Sticks about one time in five on discharge. Started after the Tuesday clean." />
            </div>
            <div>
              <span className={label}>Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inp}>
                {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" onClick={submitRaise} disabled={pending || !title.trim()} className={`${btn} mt-3 w-full`}>
                {pending ? "Saving…" : "Raise request"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            It does not have to have stopped the line. If it did, log the stoppage in MIS as well — the two are linked.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>{showClosed ? "Every request" : "Open requests"}</H2>
          <button type="button" onClick={() => setShowClosed((v) => !v)}
            className="text-xs font-medium text-brand hover:underline">
            {showClosed ? "Show open only" : "Show closed too"}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {showClosed ? "Nothing logged yet." : "Nothing open — everything raised has been answered."}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {shown.map((t) => (
              <div key={t.id} className={`rounded-xl border px-4 py-3 ${
                t.priority === "Line down" && !CLOSED.has(t.status)
                  ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{t.ref}</span>
                      <span className="font-medium text-gray-900">{t.title}</span>
                      <Badge tone={PRIORITY_TONE[t.priority] ?? "brand"}>{t.priority}</Badge>
                      <Badge tone={STATUS_TONE[t.status] ?? "amber"}>{t.status}</Badge>
                      {/* The link back to the stoppage this came from. Without
                          it a reader cannot get from the answer to the event. */}
                      {t.misId && (
                        <Link href="/mis" className="text-xs font-medium text-brand hover:underline">
                          from a downtime incident →
                        </Link>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t.area ? <>{t.area} · </> : null}
                      raised {ago(t.raisedAt)} ago{t.raisedBy ? ` by ${t.raisedBy}` : ""}
                    </p>
                    {t.detail && <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-600">{t.detail}</p>}
                    {t.response && (
                      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <span className="font-medium">Maintenance:</span> {t.response}
                        {t.respondedBy ? <span className="text-xs text-gray-400"> — {t.respondedBy}</span> : null}
                      </p>
                    )}
                  </div>

                  {canAnswer && (
                    <button type="button" onClick={() => { setOpenId(openId === t.id ? null : t.id); setReply(t.response ?? ""); setStatus(t.status === "Pending" ? "Attended" : t.status); }}
                      className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      {openId === t.id ? "Cancel" : t.response ? "Update" : "Respond"}
                    </button>
                  )}
                </div>

                {canAnswer && openId === t.id && (
                  <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 md:grid-cols-4">
                    <div className="md:col-span-3">
                      <span className={label}>What was done</span>
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} className={inp}
                        placeholder="Stripped and re-greased the gate pivot. Watch it for a week." />
                    </div>
                    <div>
                      <span className={label}>Status</span>
                      <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
                        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button type="button" onClick={() => submitAnswer(t.id)} disabled={pending} className={`${btn} mt-2 w-full`}>
                        {pending ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {t.misId && (
                      <p className="text-xs text-gray-400 md:col-span-4">
                        This request came from a downtime incident — saving here updates the response on the MIS log too.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
