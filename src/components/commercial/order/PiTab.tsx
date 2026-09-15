"use client";
// The order workspace's PI tab: every proforma this order has had — the live
// one, the drafts, and the cancelled ones that a revision replaced — and the
// things anyone does with one: build a draft from the order as it stands,
// edit the draft's shipping facts and choose its bank and GSTIN, issue it,
// revise an issued one (a NEW number; the old stays live until the new one is
// issued, then is cancelled — answer 24), record the customer's acceptance,
// or (manager / admin) cancel it by hand.
// The PDF opens in a new tab straight from the route, so what the customer
// gets is what the server rendered.
//
// PIs come from the order detail (DESIGN.md §5 includes them, snapshots and
// all), so a write here only has to call refresh().
//
// Nothing on this screen decides anything: the badge tone, the warnings, the
// bank default and the printed date all come from lib/commercial/proforma-rules,
// which the PI routes and the PDF use too and tests/commercialProforma.test.ts
// runs. The bank and GSTIN options come from GET /proformas/choices (the
// settings route itself is the admin's, and the clerk issuing a PI is not).
//
// NO WRITE ON THIS TAB IS EVER HIDDEN (DESIGN.md §9). Create draft, Issue,
// Customer accepted and Revise are rendered for every login that can open the
// order and DISABLED WITH THE REASON when this one may not perform them, the
// way Cancel has always been. Whether it may is piWriteRefusal(actions,
// access): the `actions` the workspace passes down AND the proforma AREA's own
// answer, which arrives on the /proformas/choices payload this tab already
// fetches. Both are needed since answers 1 and 2 split the desk — Raghav and
// Murali hold the write action for their own screens and only read PIs, so
// actions.includes("write") alone would offer them four buttons the routes
// (commercialGate("write", "proforma")) refuse.
import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson, patchJson } from "@/lib/fab/postJson";
import { readJson } from "@/lib/readJson";
import { statusTone, orderWarnings, formatPiDate, defaultBankKey, revisionDraftFor, refuseCancel, registerOrder, replacementOf, piWriteRefusal, BANK_KEYS, type BankKey, type PiChoices } from "@/lib/commercial/proforma-rules";
import type { AreaAccess } from "@/lib/commercial/access-rules";
import type { GstinChoice } from "@/lib/commercial/settings-defaults";
import type { OrderTabProps, ProformaDto, ProformaSnapshot } from "@/lib/commercial/types";
import { isLiveHold } from "@/lib/commercial/orders-rules";
import {
  BTN, BTN_PRIMARY, BTN_DANGER, ErrorNote, OkNote, TextField, AreaField, SelectField,
  dmy, dateInputValue, money, qty,
} from "../orders/fields";

// Answer 24 put cancelling behind the "cancel" action; a login without it sees
// the button disabled with this beside it, never a screen missing a button.
const CANCEL_HINT = "Only the Commercial Manager or an admin cancels a PI";

interface DraftForm {
  deliveryDate: string;
  vessel: string;
  grossWeight: string;
  netWeight: string;
  discount: string;
  notes: string;
  salespersonName: string;
  bankKey: BankKey;
  gstinKey: string;
}

function formOf(s: ProformaSnapshot | null | undefined, kind: string, ownGstin: string): DraftForm {
  return {
    deliveryDate: dateInputValue(s?.deliveryDate),
    vessel: s?.vessel ?? "",
    grossWeight: s?.grossWeight ?? "",
    netWeight: s?.netWeight ?? "",
    discount: s?.discount ? String(s.discount) : "",
    notes: s?.notes ?? "",
    // Copied off the order when the draft was built (scripts/0084); correctable
    // here because the desk that typed the order and the salesperson the PI is
    // for are routinely two different people. A PI frozen before 2026-09-15
    // carries no such key at all, hence the blank.
    salespersonName: s?.salespersonName ?? "",
    bankKey: s?.bankKey ?? defaultBankKey(kind),
    gstinKey: s?.gstinKey ?? s?.company?.gstin ?? ownGstin,
  };
}

export default function PiTab({ order, actions, refresh }: OrderTabProps) {
  // null until GET /proformas/choices lands (or if it never does): unknown is
  // NOT read-only — the buttons stay live and the route stays the authority,
  // rather than a network hiccup greying the tab out.
  const [piAccess, setPiAccess] = useState<AreaAccess | null>(null);
  const writeRefusal = piWriteRefusal(actions, piAccess);
  const canWrite = writeRefusal === null;
  const canCancelPi = actions.includes("cancel");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(formOf(null, order.kind, ""));
  const [open, setOpen] = useState<string | null>(null);
  const [banks, setBanks] = useState<Array<{ value: string; label: string }>>(
    BANK_KEYS.map((k) => ({ value: k, label: k === "export" ? "Export account" : "Domestic account" })),
  );
  const [gstins, setGstins] = useState<GstinChoice[]>([]);
  const [validityDays, setValidityDays] = useState<number | null>(null);

  // The two dropdowns' options. Until (or unless) they load, the bank list
  // keeps its two fixed keys — the snapshot needs a key, not a name — and the
  // GSTIN list offers only what the draft already carries.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await readJson<PiChoices>(await fetch("/api/office/commercial/proformas/choices", { cache: "no-store" }));
        if (!alive || !res.ok || !res.data) return;
        setBanks(res.data.banks.map((b) => ({ value: b.key, label: b.label })));
        setGstins(res.data.gstins);
        setValidityDays(res.data.piValidityDays);
        setPiAccess(res.data.access ?? null);
      } catch {
        // the fallbacks above stand
      }
    })();
    return () => { alive = false; };
  }, []);

  // Round two, answer 8: newest first, except that a cancelled PI sits under
  // the PI that replaced it. registerOrder decides that, so the register page
  // and this tab read the same way.
  const proformas = useMemo(() => registerOrder(order.proformas ?? []), [order.proformas]);
  const warnings = useMemo(
    () => orderWarnings({ items: order.items, consignee: order.consignee, client: order.client }),
    [order.items, order.consignee, order.client],
  );
  const live = proformas.find((p) => p.status === "ISSUED" || p.status === "ACCEPTED") ?? null;
  // The stock check stands only while a hold does. Same rule as the server
  // gate (loadStageFacts + canEnter), so the tab never offers an issue the
  // route will refuse: an ACTIVE hold past its expiry is not a live hold, even
  // before the sweep marks it EXPIRED (answers 1, 11).
  const stockChecked = Boolean(order.stockCheckedAt) && (order.holds ?? []).some((h) => isLiveHold(h, new Date()));

  async function run(key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, ok: string): Promise<boolean> {
    setBusy(key); setError(null); setDone(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "That did not work."); return false; }
    setDone(ok);
    refresh();
    return true;
  }

  const createDraft = () =>
    run("create", () => postJson(`/api/office/commercial/orders/${order.id}/proformas`, {}), "Draft PI built from the order, under its own number.");

  const issue = (pi: ProformaDto) =>
    run(`issue:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/issue`, {}),
      `${pi.number} issued${live && live.id !== pi.id ? ` — ${live.number} is cancelled as revised` : ""}.`);

  const accept = (pi: ProformaDto) =>
    run(`accept:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/accept`, {}),
      `${pi.number} recorded as accepted by the customer.`);

  // Answer 24 as decided: the new draft gets a NEW number and names the PI it
  // revises; that PI stays live until the draft is issued, and is cancelled
  // then, in the same transaction — never here.
  function revise(pi: ProformaDto) {
    const reason = window.prompt(`Revise ${pi.number}? A new draft gets a NEW number; ${pi.number} stays live until the new one is issued, then is cancelled. Why?`, "");
    if (reason === null) return;
    void run(`revise:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/revise`, { reason }),
      `A draft revising ${pi.number} is ready under a new number — issue it to retire ${pi.number}.`);
  }

  // Answer 8: the reason is required. The route refuses a blank one; asking
  // here saves the round trip and says what the reason is for.
  function cancel(pi: ProformaDto) {
    const reason = window.prompt(`Cancel ${pi.number} — why? ${pi.number} stays in the register, struck through, with this reason beside it.`, "");
    if (reason === null) return;
    const refusal = refuseCancel({ status: pi.status }, reason);
    if (refusal) { setDone(null); setError(refusal); return; }
    void run(`cancel:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/cancel`, { reason: reason.trim() }),
      `${pi.number} cancelled — the register keeps the number.`);
  }

  async function saveDraft(pi: ProformaDto) {
    const ok = await run(`save:${pi.id}`, () => patchJson(`/api/office/commercial/proformas/${pi.id}`, {
      deliveryDate: form.deliveryDate || null,
      vessel: form.vessel || null,
      grossWeight: form.grossWeight || null,
      netWeight: form.netWeight || null,
      discount: form.discount.trim() === "" ? 0 : Number(form.discount),
      notes: form.notes || null,
      salespersonName: form.salespersonName || null,
      bankKey: form.bankKey,
      gstinKey: form.gstinKey,
    }), "Draft saved.");
    if (ok) setEditing(null);
  }

  function startEdit(pi: ProformaDto) {
    setForm(formOf(pi.snapshot, order.kind, gstins[0]?.gstin ?? ""));
    setEditing(pi.id);
    setOpen(pi.id);
    setError(null);
  }

  const gstinOptions = gstins.length
    ? gstins.map((c) => ({ value: c.gstin, label: `${c.gstin} — ${c.label}` }))
    : [{ value: form.gstinKey, label: form.gstinKey || "Company GSTIN" }];

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ul className="list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {!stockChecked && proformas.some((p) => p.status === "DRAFT") && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Stock check first: a PI is issued only once a hold is placed on this order and still live.
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      <OkNote>{done}</OkNote>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">
          Each PI has its own number from the proforma counter; the order stays <span className="font-medium text-gray-700">{order.number}</span>.
          A revision is a new number; the old PI stays live until the new one is issued, then is cancelled. The advance is asked for on the PI and recorded as a receipt on the order.
          {validityDays === null ? "" : validityDays > 0 ? ` A PI is valid for ${validityDays} days from issue.` : " A PI does not expire."}
          {live ? ` ${live.number} is live.` : ""}
        </p>
        <div className="flex flex-col items-end gap-1">
          <button className={BTN_PRIMARY} disabled={!canWrite || busy === "create"}
            title={writeRefusal ?? undefined} onClick={() => void createDraft()}>
            {busy === "create" ? "Building…" : "Create draft from this order"}
          </button>
          {writeRefusal && <span className="text-xs text-gray-400">{writeRefusal}</span>}
        </div>
      </div>

      {proformas.length === 0 ? (
        <Empty>No proforma invoice yet. Build a draft from the order&rsquo;s items, check it, then issue it.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {proformas.map((pi) => {
            const s: ProformaSnapshot | null = pi.snapshot ?? null;
            const isOpen = open === pi.id;
            const isEditing = editing === pi.id;
            const cancelledAt = pi.cancelledAt ?? null;
            const cancelReason = pi.cancelReason ?? null;
            const cancelled = pi.status === "CANCELLED";
            // The number of the PI issued in this one's place, read off the
            // siblings this screen already holds (answer 8).
            const replacement = cancelled ? replacementOf(proformas, pi) : null;
            // A draft already revising this PI: the route would refuse a second
            // (409), so the button says so instead of offering one.
            const pendingRevision = (pi.status === "ISSUED" || pi.status === "ACCEPTED") ? revisionDraftFor(proformas, pi.id) : null;
            return (
              <Card key={pi.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-base font-semibold ${cancelled ? "text-gray-400 line-through" : "text-gray-900"}`}>{pi.number}</span>
                      <Badge tone={statusTone(pi.status)}>{pi.status.toLowerCase()}</Badge>
                      {s?.kind && <span className="text-xs uppercase tracking-wide text-gray-400">{s.kind}</span>}
                    </div>
                    <div className="text-sm text-gray-600">{formatPiDate(s?.date) || "—"}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Issued {dmy(pi.issuedAt)}
                      {pi.validUntil ? ` · Valid until ${dmy(pi.validUntil)}` : ""}
                      {pi.acceptedAt ? ` · Accepted ${dmy(pi.acceptedAt)}` : ""}
                      {cancelledAt ? ` · Cancelled ${dmy(cancelledAt)}` : ""}
                      {s?.revises?.number ? ` · Revises ${s.revises.number}` : ""}
                    </div>
                    {cancelled && (replacement || cancelReason) && (
                      <div className="mt-1 text-xs text-gray-500">
                        {replacement && <>Replaced by <span className="font-medium text-gray-700">{replacement.number}</span></>}
                        {replacement && cancelReason ? " · " : ""}
                        {cancelReason && <span className="italic">{cancelReason}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-gray-900">{money(pi.totalAmount, pi.currency)}</div>
                    <div className="text-xs text-gray-500">{s?.totalSlabs ?? 0} slabs · {s?.lines?.length ?? 0} line(s)</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <a className={BTN} href={`/api/office/commercial/proformas/${pi.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>
                  <button className={BTN} onClick={() => setOpen(isOpen ? null : pi.id)}>{isOpen ? "Hide detail" : "Show detail"}</button>
                  {pi.status === "DRAFT" && (
                    <>
                      <button className={BTN} disabled={!canWrite} title={writeRefusal ?? undefined}
                        onClick={() => (isEditing ? setEditing(null) : startEdit(pi))}>
                        {isEditing ? "Stop editing" : "Edit draft"}
                      </button>
                      <button className={BTN_PRIMARY} disabled={!canWrite || busy === `issue:${pi.id}`}
                        title={writeRefusal ?? undefined} onClick={() => void issue(pi)}>
                        {busy === `issue:${pi.id}` ? "Issuing…" : "Issue"}
                      </button>
                    </>
                  )}
                  {pi.status === "ISSUED" && (
                    <button className={BTN_PRIMARY} disabled={!canWrite || busy === `accept:${pi.id}`}
                      title={writeRefusal ?? undefined} onClick={() => void accept(pi)}>
                      {busy === `accept:${pi.id}` ? "Saving…" : "Customer accepted"}
                    </button>
                  )}
                  {(pi.status === "ISSUED" || pi.status === "ACCEPTED") && (
                    pendingRevision ? (
                      <span className="self-center text-xs text-gray-500">Revision {pendingRevision.number} in draft — issue it to retire this PI</span>
                    ) : (
                      <button className={BTN} disabled={!canWrite || busy === `revise:${pi.id}`}
                        title={writeRefusal ?? undefined} onClick={() => revise(pi)}>
                        {busy === `revise:${pi.id}` ? "Revising…" : "Revise (new number)"}
                      </button>
                    )
                  )}
                  {/* The same treatment Cancel has always had: the buttons above stay
                      on screen, greyed, and this says why (DESIGN.md §9). */}
                  {writeRefusal && (pi.status === "DRAFT" || pi.status === "ISSUED" || pi.status === "ACCEPTED") && (
                    <span className="self-center text-xs text-gray-400">{writeRefusal}</span>
                  )}
                  {(pi.status === "DRAFT" || pi.status === "ISSUED" || pi.status === "ACCEPTED") && (
                    <button className={BTN_DANGER} disabled={!canCancelPi || busy === `cancel:${pi.id}`}
                      title={canCancelPi ? undefined : CANCEL_HINT} onClick={() => cancel(pi)}>
                      Cancel
                    </button>
                  )}
                  {!canCancelPi && (pi.status === "DRAFT" || pi.status === "ISSUED" || pi.status === "ACCEPTED") && (
                    <span className="self-center text-xs text-gray-400">{CANCEL_HINT}</span>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <SelectField label="Bank on the PI" value={form.bankKey} options={banks}
                        onChange={(v) => setForm({ ...form, bankKey: v === "domestic" ? "domestic" : "export" })}
                        hint="Kotak on export, ICICI on domestic by default." />
                      <SelectField label="GSTIN on the PI" value={form.gstinKey} options={gstinOptions}
                        onChange={(v) => setForm({ ...form, gstinKey: v })} hint="Defaults to the company's own." />
                      <TextField label="Delivery date" type="date" value={form.deliveryDate} onChange={(v) => setForm({ ...form, deliveryDate: v })} />
                      <TextField label="Vessel / flight no" value={form.vessel} onChange={(v) => setForm({ ...form, vessel: v })} />
                      <TextField label={`Discount (${pi.currency})`} value={form.discount} onChange={(v) => setForm({ ...form, discount: v })}
                        hint="Comes off the total; the amount in words is rewritten." />
                      <TextField label="Gross weight" value={form.grossWeight} onChange={(v) => setForm({ ...form, grossWeight: v })} placeholder="e.g. 24,500 KGS" />
                      <TextField label="Net weight" value={form.netWeight} onChange={(v) => setForm({ ...form, netWeight: v })} placeholder="e.g. 23,100 KGS" />
                      {/* Owner, 2026-09-15: the salesperson block on a DTA PI.
                          Offered on an export draft too and simply not printed
                          there — the order may carry the name either way — so
                          nothing is hidden and the hint says what happens. */}
                      <TextField label="Salesperson" value={form.salespersonName} onChange={(v) => setForm({ ...form, salespersonName: v })}
                        hint={order.kind === "EXPORT"
                          ? "Kept on the PI but not printed: the salesperson block is on the domestic (DTA) proforma only."
                          : "Who asked for this PI, for his customer. Prints as a small block on the PI."} />
                      {/* The box prints exactly what is typed here and nothing
                          else — no container size, no tonnage, no weight is
                          ever put in it for you (owner, 2026-09-15). Left
                          empty, the PI prints the labelled box empty. */}
                      <AreaField label={"Terms & conditions"} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2}
                        hint={"Prints on the PI under Terms & Conditions — only what you type here; blank prints an empty box."} className="sm:col-span-2 lg:col-span-1" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className={BTN_PRIMARY} disabled={busy === `save:${pi.id}`} onClick={() => void saveDraft(pi)}>
                        {busy === `save:${pi.id}` ? "Saving…" : "Save draft"}
                      </button>
                      <button className={BTN} onClick={() => setEditing(null)}>Discard changes</button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      Parties, lines and rates are frozen from the order the moment a draft is built — to change those, edit the order and build a new draft (or revise the issued PI).
                    </p>
                  </div>
                )}

                {isOpen && s && (
                  <div className="mt-4">
                    <div className="mb-3 grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                      <div><span className="text-gray-400">Consignee: </span>{s.consignee?.name || "—"}</div>
                      <div><span className="text-gray-400">Notify: </span>{s.notifyParty?.name || "—"}</div>
                      <div><span className="text-gray-400">Delivery terms: </span>{s.deliveryTerms || "—"}</div>
                      <div><span className="text-gray-400">Payment terms: </span>{s.paymentTerms || "—"}</div>
                      <div><span className="text-gray-400">Port of loading: </span>{s.portOfLoading || "—"}</div>
                      <div><span className="text-gray-400">Port of discharge: </span>{s.portOfDischarge || "—"}</div>
                      <div><span className="text-gray-400">Vessel: </span>{s.vessel || "—"}</div>
                      <div><span className="text-gray-400">Gross / net: </span>{s.grossWeight || "—"} / {s.netWeight || "—"}</div>
                      <div><span className="text-gray-400">Bank: </span>{s.bank?.name || "—"}{s.bankKey ? ` (${s.bankKey})` : ""}</div>
                      <div><span className="text-gray-400">GSTIN: </span>{s.company?.gstin || "—"}</div>
                      <div><span className="text-gray-400">Valid until: </span>{s.validUntil ? formatPiDate(s.validUntil) : "—"}</div>
                      {/* Frozen with the rest of the snapshot; printed on a DTA
                          PI only, so the export note says why it is not there. */}
                      <div>
                        <span className="text-gray-400">Salesperson: </span>{s.salespersonName || "—"}
                        {s.kind === "EXPORT" && s.salespersonName ? <span className="text-gray-400"> (not printed on an export PI)</span> : null}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                            <th className="py-2 pr-3">Item code</th>
                            <th className="py-2 pr-3">Description</th>
                            <th className="py-2 pr-3">Thick</th>
                            <th className="py-2 pr-3 text-right">Slabs</th>
                            <th className="py-2 pr-3">HSN</th>
                            <th className="py-2 pr-3">Unit</th>
                            <th className="py-2 pr-3 text-right">Quantity</th>
                            <th className="py-2 pr-3 text-right">Rate</th>
                            <th className="py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(s.lines ?? []).map((l) => (
                            <tr key={l.lineNo} className="border-b border-gray-100">
                              <td className="py-1.5 pr-3">{l.itemCode ?? ""}</td>
                              <td className="py-1.5 pr-3">{l.description}{l.isSample ? " (sample)" : ""}</td>
                              <td className="py-1.5 pr-3">{l.thickness ?? ""}</td>
                              <td className="py-1.5 pr-3 text-right">{l.slabs ?? ""}</td>
                              <td className="py-1.5 pr-3">{l.hsn}</td>
                              <td className="py-1.5 pr-3">{l.unit}</td>
                              <td className="py-1.5 pr-3 text-right">{qty(l.qty)}</td>
                              <td className="py-1.5 pr-3 text-right">{l.rate}</td>
                              <td className="py-1.5 text-right">{money(l.amount)}</td>
                            </tr>
                          ))}
                          {s.discount ? (
                            <tr className="border-b border-gray-100 text-gray-600">
                              <td className="py-1.5 pr-3" colSpan={8}>Less: discount</td>
                              <td className="py-1.5 text-right">−{money(s.discount)}</td>
                            </tr>
                          ) : null}
                          <tr className="font-semibold">
                            <td className="py-2 pr-3">Total</td>
                            <td className="py-2 pr-3" colSpan={2} />
                            <td className="py-2 pr-3 text-right">{s.totalSlabs}</td>
                            <td className="py-2 pr-3" colSpan={4} />
                            <td className="py-2 text-right">{money(s.totalAmount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">{s.amountInWords}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
