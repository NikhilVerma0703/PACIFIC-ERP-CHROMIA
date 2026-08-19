"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, H2, Badge } from "@/components/ui";
import { raise, answer, logPreventive } from "./actions";
import type { Ticket } from "@/lib/maintenanceLog";
import type { IncidentRow } from "@/lib/downtime";
import type { DowntimeResp } from "@/lib/downtimeResponse";
import type { ReclassRecord } from "@/lib/delayReclass";
import type { InboxItem } from "@/lib/maintenanceQueue";
import { fmtDur, DELAY_FIELDS } from "@/lib/downtimeShared";
import { DowntimeRespond } from "@/components/DowntimeRespond";
import { ReclassBadge } from "@/components/ReclassifyDelay";
import { describeReclass, RECLASS_TONE } from "@/lib/delayReclass";
import { PM_HOURS, PM_MAX_MINUTES, type PmEntry } from "@/lib/preventiveMaintenanceShared";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btn = "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";

/** Priority colour. "Line down" is red because it is not a severity, it is an
 *  emergency — the list is sorted on it and the eye should find it too. */
const PRIORITY_TONE: Record<string, "red" | "amber" | "brand" | "green"> = {
  "Line down": "red", High: "amber", Normal: "brand", Low: "green",
};
const STATUS_TONE: Record<string, "red" | "amber" | "brand" | "green"> = {
  Pending: "amber", Attended: "brand", Resolved: "green", "Not required": "green",
};

/** Age, from the item's normalised UTC instant.
 *
 *  buildInbox() converts the MIS hour out of naive IST before it gets here, so
 *  this can subtract from Date.now() for BOTH kinds. Doing it off the raw MIS
 *  value would understate every incident by 5h30 and print a negative age for
 *  one logged in the last five and a half hours. */
const ago = (iso: string | null) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
};

export type BoardItem = InboxItem<IncidentRow, Ticket>;

/**
 * The one inbox: raised faults and downtime incidents in a single queue.
 *
 * WHY BOTH KINDS RENDER IN ONE LIST rather than in two cards on one page. Two
 * lists is two inboxes with a shorter walk between them — the same failure
 * src/lib/maintenanceLog.ts describes, and the one the owner reported. The queue
 * order (open, then urgency, then oldest) is computed across both kinds in
 * src/lib/maintenanceQueue.ts, so the top of this list is genuinely the next job.
 *
 * A row that is BOTH — an incident with a fault raised from it — renders once,
 * with the incident's facts and the ticket's reference, and offers exactly one
 * answer control. Two controls on one conversation is how two people answer the
 * same fault twice and the second overwrites the first.
 */
export function MaintenanceBoard({
  items, canRaise, canAnswer, canRespond, canReclass, respFailed, reclassFailed,
  responses, photos, reclass, priorities, statuses, hidden = 0, total,
  canFillPreventive, pmEntries,
}: {
  items: BoardItem[];
  /** Queue items counted but NOT sent to this component (the render cap in
   *  buildInbox). Said out loud below: a list that stops without explaining
   *  itself is read as the complete list. */
  hidden?: number;
  total?: number;
  canRaise: boolean;
  /** May answer anything. The two flags below are the same permission narrowed
   *  by what could actually be READ this load — see the page. */
  canAnswer: boolean;
  canRespond: boolean;
  canReclass: boolean;
  respFailed: boolean;
  reclassFailed: boolean;
  responses: Record<string, DowntimeResp>;
  photos: Record<string, { id: string; filename: string }[]>;
  reclass: Record<string, ReclassRecord[]>;
  priorities: string[];
  statuses: string[];
  /** May write the preventive register — the answer gate, not the raise gate:
   *  the register records what maintenance DID, so only maintenance (or an
   *  admin) writes in it. Everyone who sees the page reads it. */
  canFillPreventive: boolean;
  pmEntries: PmEntry[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [type, setType] = useState<string | null>(null);

  // Both entry forms live behind buttons — the page opens on the queue, and a
  // person opens the one form they came to fill. null = neither.
  const [openForm, setOpenForm] = useState<null | "fault" | "pm">(null);

  // Raise form
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState("Normal");

  // Preventive register form. Date defaults to today in IST — the register is
  // usually filled the same day the work was done.
  const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [pmDate, setPmDate] = useState(todayIST);
  const [pmHour, setPmHour] = useState(PM_HOURS[0]);
  const [pmMinutes, setPmMinutes] = useState("");
  const [pmStation, setPmStation] = useState("");
  const [pmDesc, setPmDesc] = useState("");

  // Which ticket is being answered, and with what
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("Attended");

  // `closed` and not `!open`, deliberately: an item whose answer could not be
  // read is neither, and hiding it would be the failed lookup quietly deciding
  // the work is done.
  //
  // The delay-type chip narrows the INCIDENTS only; raised faults are never
  // hidden by it, because a ticket carries no delay type and filtering it out
  // would make "Breakdown" mean "and also, no faults exist". Client-side state
  // like the chips on /mis: a searchParams navigation re-keys the segment, the
  // loading skeleton swaps in and the scroll jumps to the top.
  const shown = items.filter((it) =>
    (showClosed || !it.closed) &&
    (!type || it.kind === "ticket" || (it.incident?.minutesByType?.[type] ?? 0) > 0));
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`;

  const submitRaise = () =>
    start(async () => {
      const r = await raise({ title, area, detail, priority });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setTitle(""); setArea(""); setDetail(""); setPriority("Normal"); }
    });

  const submitPm = () =>
    start(async () => {
      const r = await logPreventive({ date: pmDate, hour: pmHour, minutes: Number(pmMinutes), station: pmStation, description: pmDesc });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setPmMinutes(""); setPmStation(""); setPmDesc(""); }
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

      {/* Both forms live behind buttons, so the page opens on the queue and
          stays put — the register button only exists for those who may write
          the register (see canFillPreventive). Pressing the open form's own
          button folds it away again. */}
      {(canRaise || canFillPreventive) && (
        <div className="flex flex-wrap gap-2">
          {canRaise && (
            <button type="button" onClick={() => setOpenForm(openForm === "fault" ? null : "fault")}
              className={openForm === "fault" ? btn : "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"}>
              Report a fault
            </button>
          )}
          {canFillPreventive && (
            <button type="button" onClick={() => setOpenForm(openForm === "pm" ? null : "pm")}
              className={openForm === "pm" ? btn : "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"}>
              Log preventive maintenance
            </button>
          )}
        </div>
      )}

      {canRaise && openForm === "fault" && (
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
            It does not have to have stopped the line. If it did, log the stoppage in MIS too — that hour then appears in
            this same queue as a downtime incident, and answering either one answers both.
          </p>
        </Card>
      )}

      {canFillPreventive && openForm === "pm" && (
        <Card>
          <H2>Log preventive maintenance</H2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <span className={label}>Day the work was done</span>
              <input type="date" value={pmDate} onChange={(e) => setPmDate(e.target.value)} className={inp} />
            </div>
            <div>
              <span className={label}>Hour</span>
              <select value={pmHour} onChange={(e) => setPmHour(e.target.value)} className={inp}>
                {PM_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Minutes spent</span>
              <input type="number" min={1} max={PM_MAX_MINUTES} value={pmMinutes} onChange={(e) => setPmMinutes(e.target.value)} className={inp}
                placeholder="45" />
            </div>
            <div>
              <span className={label}>Station or machine</span>
              <input value={pmStation} onChange={(e) => setPmStation(e.target.value)} className={inp} placeholder="Press" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <span className={label}>What was done</span>
              <textarea value={pmDesc} onChange={(e) => setPmDesc(e.target.value)} rows={2} className={inp}
                placeholder="Greased press guide rails, checked vacuum lines, replaced worn distributor belt edge." />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={submitPm}
                disabled={pending || !pmMinutes || !pmStation.trim() || !pmDesc.trim()} className={`${btn} w-full`}>
                {pending ? "Saving…" : "Add to register"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Planned work only — a breakdown you attended is answered on its incident below, not written here.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>{showClosed ? `Everything · ${shown.length}` : `Open · ${shown.length}`}</H2>
          <button type="button" onClick={() => setShowClosed((v) => !v)}
            className="text-xs font-medium text-brand hover:underline">
            {showClosed ? "Show open only" : "Show answered too"}
          </button>
        </div>

        {/* The same two warnings /mis carries, for the same reasons — and they
            matter more here, because this page's KPI cards are counted off the
            data these lookups return. */}
        {respFailed && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ Saved downtime responses could not be loaded just now — the incidents below read as <b>unknown</b>, not
            unanswered, and they are left out of the figures at the top. Reload the page; responding is disabled
            meanwhile so an earlier response can&apos;t be overwritten unseen.
          </p>
        )}
        {reclassFailed && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ Applied delay-type corrections could not be loaded just now — a reclassified hour will look untouched,
            because the MIS row already carries the corrected figures. Reclassifying is disabled until a reload.
          </p>
        )}

        {/* WHY CLEANING HOURS ARE IN A MAINTENANCE INBOX AT ALL — they are the
            largest single bucket, and dropping them would look like tidying up.
            delayReclass.ts names the miscategorisation this feature was built
            for: production files a stoppage "most often charging maintenance for
            what was really a cleaning changeover, sometimes the reverse". The
            reverse is a breakdown sitting in the cleaning column, and the only
            person who can move it back is the one reading this list. Hide the
            cleaning rows from him and the correction becomes unreachable. The
            chip is there for when he wants to work one type at a time. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400">Delay type</span>
          <button type="button" onClick={() => setType(null)} className={chip(!type)}>All</button>
          {DELAY_FIELDS.map((d) => (
            <button key={d.key} type="button" onClick={() => setType(d.key)} className={chip(type === d.key)}>{d.label}</button>
          ))}
          {type && <span className="text-[11px] text-gray-400">raised faults carry no delay type and stay listed</span>}
        </div>

        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {type
              ? "Nothing of that delay type here — clear the chip to see the rest."
              : items.length === 0
                ? "Nothing logged — no faults raised and no downtime in this window."
                : showClosed
                  ? "Nothing logged — no faults raised and no downtime in this window."
                  // Only reachable when every item IS closed, so it can say so
                  // truthfully. Said separately from the empty case above: "every
                  // stoppage has been answered" printed over a window that
                  // recorded no stoppages is a claim nobody made.
                  : "Nothing open — every fault raised and every stoppage in this window has been answered."}
          </p>
        ) : (
          /* TWO SECTIONS, not one merged list.
             They arrive by different routes and are worked differently: a
             stoppage came off an hourly MIS row and is answered against the
             hour (and reclassified, if production filed it under the wrong
             delay type); a raised fault is somebody walking up and reporting
             something that never stopped the line. Merged, the raised faults —
             far the rarer of the two — vanish into a wall of hourly rows and
             are read last, which is the opposite of what their urgency
             deserves.
             Ordering WITHIN each section is untouched: open first, then
             urgency, then oldest, computed across the whole queue before the
             split, so nothing is reordered by being sectioned. */
          (() => {
            const incidents = shown.filter((it) => it.kind === "incident");
            const tickets = shown.filter((it) => it.kind === "ticket");
            const sec = "mt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500";
            return (
              <div className="mt-3 space-y-2">
                {tickets.length > 0 && (
                  <>
                    <div className={sec}>
                      Raised here · {tickets.length}
                      <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                        reported by hand — did not necessarily stop the line
                      </span>
                    </div>
                    {tickets.map((it) => (
                      <TicketRow key={it.key} item={it} canAnswer={canAnswer} statuses={statuses}
                        openId={openId} setOpenId={setOpenId} reply={reply} setReply={setReply}
                        status={status} setStatus={setStatus} pending={pending} submitAnswer={submitAnswer} />
                    ))}
                  </>
                )}
                {incidents.length > 0 && (
                  <>
                    <div className={sec}>
                      From the MIS hourly log · {incidents.length}
                      <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                        stoppages already logged against an hour
                      </span>
                    </div>
                    {incidents.map((it) => (
                      <IncidentRow key={it.key} item={it} canRespond={canRespond} canReclass={canReclass}
                        responses={responses} photos={photos} reclass={reclass} />
                    ))}
                  </>
                )}
              </div>
            );
          })()
        )}

        {/* The end of the list is not necessarily the end of the queue. A list
            that simply stops is read as complete — which is how a manager
            concludes the KPI card above it is wrong, rather than that he is
            looking at a page of it. */}
        {hidden > 0 && (
          <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Showing the first <b>{items.length}</b> of <b>{total ?? items.length + hidden}</b> in this window — the
            queue is ordered open, then urgent, then oldest, so the {hidden} not listed are the least pressing (mostly
            already answered). They are still counted in the figures above. Narrow the dates to work through them.
          </p>
        )}
      </Card>

      {/* The register itself is read by everyone who can see this page — the
          point of writing it down is that the plant can see the planned work
          happened. Same date window as the queue above. */}
      <Card>
        <H2>Preventive maintenance register · {pmEntries.length}</H2>
        {pmEntries.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing logged in this window yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">Day</th><th className="px-3 py-2">Hour</th>
                  <th className="px-3 py-2 text-right">Minutes</th><th className="px-3 py-2">Station</th>
                  <th className="px-3 py-2">What was done</th><th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody>
                {pmEntries.map((e) => (
                  <tr key={e.id} className="border-t border-gray-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{e.date}</td>
                    <td className="whitespace-nowrap px-3 py-2">{e.hour}</td>
                    <td className="px-3 py-2 text-right font-medium">{e.minutes}</td>
                    <td className="px-3 py-2">{e.station}</td>
                    <td className="px-3 py-2 text-gray-600">{e.description}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-400">{e.actor ?? "—"}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                  <td className="px-3 py-2" colSpan={2}>Total in this window</td>
                  <td className="px-3 py-2 text-right">{pmEntries.reduce((a, e) => a + e.minutes, 0)}</td>
                  <td className="px-3 py-2" colSpan={3}>minutes of preventive work</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A fault somebody raised. Unchanged from the ticket-only board — the only
 *  edit is that it now takes its row from the merged queue. */
function TicketRow({
  item, canAnswer, statuses, openId, setOpenId, reply, setReply, status, setStatus, pending, submitAnswer,
}: {
  item: BoardItem;
  canAnswer: boolean;
  statuses: string[];
  openId: string | null;
  setOpenId: (v: string | null) => void;
  reply: string;
  setReply: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  pending: boolean;
  submitAnswer: (id: string) => void;
}) {
  const t = item.ticket!;
  const age = ago(item.at);
  return (
    <div className={`rounded-xl border px-4 py-3 ${
      t.priority === "Line down" && item.open ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-gray-400">{t.ref}</span>
            <span className="font-medium text-gray-900">{t.title}</span>
            <Badge tone={PRIORITY_TONE[t.priority] ?? "brand"}>{t.priority}</Badge>
            <Badge tone={STATUS_TONE[t.status] ?? "amber"}>{t.status}</Badge>
            {/* A ticket that carries a mis_id but whose hour is outside the
                window still says where it came from. */}
            {t.misId && (
              <Link href="/mis" className="text-xs font-medium text-brand hover:underline">
                from a downtime incident →
              </Link>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {t.area ? <>{t.area} · </> : null}
            raised {age ? `${age} ago` : "—"}{t.raisedBy ? ` by ${t.raisedBy}` : ""}
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
  );
}

/**
 * A downtime incident: one MIS hourly row that lost time.
 *
 * The answer control is DowntimeRespond — the SAME component /mis uses, wired to
 * the same server actions in src/app/mis/actions.ts. A server action is
 * importable from any route; the page it lives beside is irrelevant. Reusing it
 * means status, note, dispute, photo and the reclassification all behave
 * identically on both screens, and there is no second respond form to keep in
 * step with the first.
 */
function IncidentRow({
  item, canRespond, canReclass, responses, photos, reclass,
}: {
  item: BoardItem;
  canRespond: boolean;
  canReclass: boolean;
  responses: Record<string, DowntimeResp>;
  photos: Record<string, { id: string; filename: string }[]>;
  reclass: Record<string, ReclassRecord[]>;
}) {
  const i = item.incident!;
  const t = item.ticket;
  const recs = reclass[i.id] ?? [];
  const mark = describeReclass(recs);
  const age = ago(item.at);
  const detail = [i.details, i.rca ? `RCA ${i.rca}` : null, i.action, i.spares ? `spares: ${i.spares}` : null]
    .filter(Boolean).join(" · ");

  return (
    <div className={`rounded-xl border px-4 py-3 ${
      item.awaiting ? "border-amber-200 bg-amber-50/30" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-gray-400">{i.date ?? "—"} {i.hour ?? ""}</span>
            <span className="font-medium text-gray-900">
              {fmtDur(i.minutes)} lost{i.types.length ? ` · ${i.types.join(", ")}` : ""}
            </span>
            <Badge tone="brand">Downtime incident</Badge>
            {i.over && (
              <span className="text-xs font-medium text-red-600" title="This hour logs more than 60 min of delay — an entry error">
                ⚠ over 60 min
              </span>
            )}
            {mark.count > 0 && <ReclassBadge mark={mark} />}
            {/* Status, said in words rather than left blank. An incident nobody
                has answered is the whole reason this page exists, so it may not
                render as an empty cell. */}
            {item.known
              ? <Badge tone={STATUS_TONE[item.status ?? ""] ?? "amber"}>{item.status ?? "No response yet"}</Badge>
              : <Badge tone="amber">Answer unknown</Badge>}
            {/* ONE ROW PER FACT: the ticket raised from this hour is shown here,
                on the incident, and not again lower down as its own line. */}
            {t && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600" title="A fault was raised from this incident — they are one conversation">
                {t.ref} · {t.priority}
              </span>
            )}
            {i.batch && (
              <Link href={`/batch?b=${encodeURIComponent(i.batch)}`} className="text-xs font-medium text-brand hover:underline">
                batch {i.batch}
              </Link>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {age ? `${age} ago · ` : ""}
            logged in MIS{i.reasons.length ? ` · ${i.reasons.join(", ")}` : " · no reason given"}
          </p>
          {detail && <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-600">{detail}</p>}
          {(i.elecIncharge || i.mechIncharge) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {i.elecIncharge ? `elec: ${i.elecIncharge}` : ""}
              {i.elecIncharge && i.mechIncharge ? " · " : ""}
              {i.mechIncharge ? `mech: ${i.mechIncharge}` : ""}
            </p>
          )}
          {t?.response && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
              <span className="font-medium">Maintenance ({t.ref}):</span> {t.response}
              {t.respondedBy ? <span className="text-xs text-gray-400"> — {t.respondedBy}</span> : null}
            </p>
          )}
          {mark.count > 0 && (
            <p className={`mt-1 text-[11px] ${RECLASS_TONE.text}`} title={mark.tooltip}>
              ⇄ minutes were moved between delay types on this hour — the total is unchanged.
            </p>
          )}
        </div>

        <div className="w-64 shrink-0 text-sm">
          <DowntimeRespond
            misId={i.id}
            canRespond={canRespond}
            status={responses[i.id]?.status ?? null}
            note={responses[i.id]?.note ?? null}
            by={responses[i.id]?.by ?? null}
            at={responses[i.id]?.at ?? null}
            minutesByType={i.minutesByType}
            photos={photos[i.id] ?? []}
            reclass={recs}
            canReclass={canReclass}
          />
          {t && (
            <p className="mt-1 text-[11px] text-gray-400">
              Answering here also updates {t.ref}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
