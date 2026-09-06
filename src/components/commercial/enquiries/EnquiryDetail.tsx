"use client";
// One enquiry: what was asked, by whom, what happened to it, and the button
// that turns it into an internal sales order.
//
// Three things on this screen are rules rather than preferences, and they all
// live in lib/commercial/enquiries-rules where the tests can reach them:
//   · LOST needs a reason typed — it is the question the owner asks later;
//   · ORDERED is never set by hand, only by Convert, so the status can never
//     claim an order that does not exist;
//   · Convert refuses a prospect-only enquiry, because commercial_order has a
//     NOT NULL client — the refusal says how to fix it, and the fix is the
//     customer picker at the top of this page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { postJson, patchJson, deleteJson } from "@/lib/fab/postJson";
import { ClientPicker, type PickedClient } from "./ClientPicker";
import { STATUS_TONE } from "./EnquiriesList";
import {
  LineInputs, LineHeader, ThicknessOptions, emptyLine, lineFrom, lineBody, lineIsEmpty,
  type LineDraft, type EnquiryItemRow,
} from "./LineFields";

interface OrderLite { id: string; number: string; kind: string; status: string }

interface EnquiryDetailRow {
  id: string;
  number: string;
  clientId: string | null;
  client: (PickedClient & { defaultCurrency?: string | null }) | null;
  prospectName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  receivedAt: string;
  source: string;
  subject: string | null;
  body: string | null;
  status: string;
  assignedToId: string | null;
  orderId: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: EnquiryItemRow[];
  orders: OrderLite[];
}

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const btnSmall = "rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
const okBox = "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700";

const SOURCES = ["EMAIL", "PHONE", "WHATSAPP", "VISIT", "WEBSITE", "REFERRAL", "OTHER"];

const dateInput = (iso: string): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

export function EnquiryDetail({ enquiryId, canWrite, currentUserId, currentUserName }: {
  enquiryId: string;
  canWrite: boolean;
  currentUserId: string;
  currentUserName: string;
}) {
  const router = useRouter();
  const [row, setRow] = useState<EnquiryDetailRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // header form
  const [client, setClient] = useState<PickedClient | null>(null);
  const [head, setHead] = useState({ prospectName: "", contactName: "", contactEmail: "", contactPhone: "", receivedAt: "", source: "EMAIL", subject: "", body: "" });
  const [headError, setHeadError] = useState<string | null>(null);

  // lines
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [newLine, setNewLine] = useState<LineDraft>(emptyLine);
  const [lineError, setLineError] = useState<string | null>(null);

  // status + convert
  const [lostReason, setLostReason] = useState("");
  const [kind, setKind] = useState<"DOMESTIC" | "EXPORT">("EXPORT");
  const [statusError, setStatusError] = useState<string | null>(null);

  const apply = useCallback((r: EnquiryDetailRow) => {
    setRow(r);
    setClient(r.client);
    setHead({
      prospectName: r.prospectName ?? "",
      contactName: r.contactName ?? "",
      contactEmail: r.contactEmail ?? "",
      contactPhone: r.contactPhone ?? "",
      receivedAt: dateInput(r.receivedAt),
      source: r.source ?? "EMAIL",
      subject: r.subject ?? "",
      body: r.body ?? "",
    });
    setDrafts(Object.fromEntries(r.items.map((i) => [i.id, lineFrom(i)])));
    setLostReason(r.lostReason ?? "");
    const country = String(r.client?.country ?? "").trim().toLowerCase();
    setKind(country === "india" ? "DOMESTIC" : "EXPORT");
  }, []);

  const load = useCallback(async () => {
    const res = await readJson<EnquiryDetailRow>(await fetch(`/api/office/commercial/enquiries/${enquiryId}`, { cache: "no-store" }));
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the enquiry"); return; }
    setError(null);
    apply(res.data);
  }, [enquiryId, apply]);

  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>, onOk?: string) {
    setBusy(true);
    setHeadError(null);
    setStatusError(null);
    const res = await patchJson(`/api/office/commercial/enquiries/${enquiryId}`, body);
    setBusy(false);
    if (!res.ok) return res.error ?? "Could not save";
    apply(res.data as EnquiryDetailRow);
    if (onOk) setNotice(onOk);
    return null;
  }

  async function saveHeader(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const err = await patch({
      clientId: client?.id ?? "",
      prospectName: head.prospectName,
      contactName: head.contactName,
      contactEmail: head.contactEmail,
      contactPhone: head.contactPhone,
      receivedAt: head.receivedAt,
      source: head.source,
      subject: head.subject,
      body: head.body,
    }, "Saved.");
    if (err) setHeadError(err);
  }

  async function move(status: string) {
    setNotice(null);
    const err = await patch({ status, lostReason }, `Marked ${status.toLowerCase()}.`);
    if (err) setStatusError(err);
  }

  async function assign(to: string | null) {
    setNotice(null);
    const err = await patch({ assignedToId: to ?? "" }, to ? `Assigned to ${currentUserName}.` : "Unassigned.");
    if (err) setHeadError(err);
  }

  async function saveLine(itemId: string) {
    setLineError(null);
    setNotice(null);
    setBusy(true);
    const res = await patchJson(`/api/office/commercial/enquiries/${enquiryId}/items/${itemId}`, lineBody(drafts[itemId]));
    setBusy(false);
    if (!res.ok) { setLineError(res.error ?? "Could not save the line"); return; }
    setNotice("Line saved.");
    await load();
  }

  async function removeLine(itemId: string) {
    setLineError(null);
    setBusy(true);
    const res = await deleteJson(`/api/office/commercial/enquiries/${enquiryId}/items/${itemId}`);
    setBusy(false);
    if (!res.ok) { setLineError(res.error ?? "Could not remove the line"); return; }
    await load();
  }

  async function addLine() {
    if (lineIsEmpty(newLine)) { setLineError("Fill the line first."); return; }
    setLineError(null);
    setBusy(true);
    const res = await postJson(`/api/office/commercial/enquiries/${enquiryId}/items`, lineBody(newLine));
    setBusy(false);
    if (!res.ok) { setLineError(res.error ?? "Could not add the line"); return; }
    setNewLine(emptyLine());
    await load();
  }

  async function convert() {
    setStatusError(null);
    setNotice(null);
    setBusy(true);
    const res = await postJson(`/api/office/commercial/enquiries/${enquiryId}/convert`, { kind });
    setBusy(false);
    if (!res.ok) { setStatusError(res.error ?? "Could not convert this enquiry"); return; }
    router.push(`/office/commercial/orders/${res.data.orderId}`);
  }

  if (error) return <div className={errBox}>{error}</div>;
  if (!row) return <Empty>Loading…</Empty>;

  const converted = row.status === "ORDERED" || Boolean(row.orderId);
  const editable = canWrite && !busy;
  const party = row.client?.name ?? row.prospectName ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <ThicknessOptions />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{row.number}</h1>
            <Badge tone={STATUS_TONE[row.status] ?? "brand"}>{row.status}</Badge>
            {!row.clientId && <Badge tone="amber">Prospect</Badge>}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {party} · received {new Date(row.receivedAt).toLocaleDateString("en-IN")} · {row.source}
            {row.assignedToId ? ` · assigned${row.assignedToId === currentUserId ? " to you" : ""}` : " · unassigned"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/office/commercial/enquiries" className={btnGhost}>All enquiries</Link>
          {canWrite && row.assignedToId !== currentUserId && (
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void assign(currentUserId)}>Assign to me</button>
          )}
          {canWrite && row.assignedToId === currentUserId && (
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void assign(null)}>Unassign</button>
          )}
        </div>
      </div>

      {notice && <div className={okBox}>{notice}</div>}

      {converted && row.orders.length > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          This enquiry became{" "}
          {row.orders.map((o, i) => (
            <span key={o.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/office/commercial/orders/${o.id}`} className="font-medium underline">{o.number}</Link>
              {" "}({o.kind.toLowerCase()}, {o.status.replace(/_/g, " ").toLowerCase()})
            </span>
          ))}
          .
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <form onSubmit={saveHeader} className="flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">The enquiry</h2>
              {headError && <div className={errBox}>{headError}</div>}
              <div>
                <span className={lbl}>Customer on the master</span>
                <ClientPicker value={client} onChange={setClient} disabled={!editable || converted} />
                {converted && <span className="mt-1 block text-[11px] text-gray-400">The order carries the customer now; it cannot be changed here.</span>}
                {!client && <span className="mt-1 block text-[11px] text-amber-700">An order needs a customer here. Pick one (or add it on the customers page) before converting.</span>}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className={lbl}>Prospect name</span>
                  <input className={inp} value={head.prospectName} onChange={(e) => setHead({ ...head, prospectName: e.target.value })} disabled={!editable} placeholder="Stonewright LLC" />
                </label>
                <label className="block">
                  <span className={lbl}>Contact person</span>
                  <input className={inp} value={head.contactName} onChange={(e) => setHead({ ...head, contactName: e.target.value })} disabled={!editable} />
                </label>
                <label className="block">
                  <span className={lbl}>Contact e-mail</span>
                  <input className={inp} value={head.contactEmail} onChange={(e) => setHead({ ...head, contactEmail: e.target.value })} disabled={!editable} />
                </label>
                <label className="block">
                  <span className={lbl}>Contact phone</span>
                  <input className={inp} value={head.contactPhone} onChange={(e) => setHead({ ...head, contactPhone: e.target.value })} disabled={!editable} />
                </label>
                <label className="block">
                  <span className={lbl}>Received</span>
                  <input type="date" className={inp} value={head.receivedAt} onChange={(e) => setHead({ ...head, receivedAt: e.target.value })} disabled={!editable} />
                </label>
                <label className="block">
                  <span className={lbl}>How it arrived</span>
                  <select className={inp} value={head.source} onChange={(e) => setHead({ ...head, source: e.target.value })} disabled={!editable}>
                    {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    {!SOURCES.includes(head.source) && <option value={head.source}>{head.source}</option>}
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className={lbl}>Subject</span>
                  <input className={inp} value={head.subject} onChange={(e) => setHead({ ...head, subject: e.target.value })} disabled={!editable} />
                </label>
                <label className="block md:col-span-2">
                  <span className={lbl}>What they said</span>
                  <textarea className={`${inp} min-h-[140px]`} value={head.body} onChange={(e) => setHead({ ...head, body: e.target.value })} disabled={!editable} />
                </label>
              </div>
              {canWrite && (
                <div className="flex items-center gap-3">
                  <button type="submit" className={btnPrimary} disabled={busy}>{busy ? "Saving…" : "Save enquiry"}</button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => apply(row)}>Undo changes</button>
                </div>
              )}
            </form>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Where it stands</h2>
            {statusError && <div className={`${errBox} mb-3`}>{statusError}</div>}
            {row.status === "LOST" && row.lostReason && (
              <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">Lost: {row.lostReason}</p>
            )}
            {canWrite && !converted && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {row.status !== "NEW" && <button type="button" className={btnGhost} disabled={busy} onClick={() => void move("NEW")}>Back to new</button>}
                  {row.status !== "QUOTED" && <button type="button" className={btnGhost} disabled={busy} onClick={() => void move("QUOTED")}>Mark quoted</button>}
                  {row.status !== "CLOSED" && <button type="button" className={btnGhost} disabled={busy} onClick={() => void move("CLOSED")}>Close</button>}
                </div>
                {row.status !== "LOST" && (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <span className={lbl}>Lost — why?</span>
                    <input className={inp} value={lostReason} onChange={(e) => setLostReason(e.target.value)} disabled={busy} placeholder="Price, lead time, gave it to another supplier…" />
                    <button type="button" className={`${btnGhost} mt-2`} disabled={busy || !lostReason.trim()} onClick={() => void move("LOST")}>Mark lost</button>
                  </div>
                )}
              </div>
            )}
            {converted && <p className="text-sm text-gray-500">The order carries this enquiry now.</p>}
            {!canWrite && !converted && <p className="text-sm text-gray-500">Read only for this login.</p>}
          </Card>

          <Card>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Convert to order</h2>
            {converted ? (
              <p className="text-sm text-gray-500">Already converted.</p>
            ) : !canWrite ? (
              <p className="text-sm text-gray-500">Read only for this login.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="block">
                  <span className={lbl}>Order kind</span>
                  <select className={inp} value={kind} onChange={(e) => setKind(e.target.value as "DOMESTIC" | "EXPORT")} disabled={busy}>
                    <option value="EXPORT">Export</option>
                    <option value="DOMESTIC">Domestic (DTA)</option>
                  </select>
                </label>
                <button type="button" className={btnPrimary} disabled={busy || !row.clientId} onClick={() => void convert()}>
                  {busy ? "Working…" : "Create the order"}
                </button>
                <p className="text-xs text-gray-400">
                  Creates a DRAFT order with these lines, the customer&apos;s defaults and the SOP checklist prefilled, then opens it.
                  {!row.clientId && " Pick the customer first."}
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">What they asked for</h2>
          <span className="text-xs text-gray-400">{row.items.length} line{row.items.length === 1 ? "" : "s"}</span>
        </div>
        {lineError && <div className={`${errBox} mx-5 mt-3`}>{lineError}</div>}
        <div className="mt-3 overflow-x-auto px-2 pb-4">
          <table className="w-full min-w-[960px] text-sm">
            <thead><LineHeader /></thead>
            <tbody className="divide-y divide-gray-100">
              {row.items.map((it) => (
                <tr key={it.id}>
                  <LineInputs
                    value={drafts[it.id] ?? lineFrom(it)}
                    onChange={(n) => setDrafts((d) => ({ ...d, [it.id]: n }))}
                    disabled={!editable}
                  />
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {canWrite && (
                      <>
                        <button type="button" className={btnSmall} disabled={busy} onClick={() => void saveLine(it.id)}>Save</button>
                        <button type="button" className="ml-2 text-xs text-gray-400 hover:text-red-600" disabled={busy} onClick={() => void removeLine(it.id)}>remove</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {canWrite && (
                <tr className="bg-gray-50/60">
                  <LineInputs value={newLine} onChange={setNewLine} disabled={busy} />
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button type="button" className={btnSmall} disabled={busy} onClick={() => void addLine()}>Add</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {row.items.length === 0 && (
          <div className="px-5 pb-5 text-sm text-gray-500">
            No lines yet. An enquiry can be logged without them, but the order it becomes will have none either.
          </div>
        )}
      </Card>
    </div>
  );
}
