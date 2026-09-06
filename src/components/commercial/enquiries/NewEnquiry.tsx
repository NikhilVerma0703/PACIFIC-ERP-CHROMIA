"use client";
// Logging an enquiry: who it is from, what they asked for, and what the mail
// said. One screen, because the person filling it in has the mail open beside
// it and will not come back for a second pass.
//
// The customer is picked from this module's own master. When they are not on
// it yet — which is the normal case for a first enquiry — the prospect fields
// carry the name and the contact, and the enquiry can be attached to a real
// customer later, before it is converted to an order.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { ClientPicker, type PickedClient } from "./ClientPicker";
import {
  LineInputs, LineHeader, ThicknessOptions, emptyLine, lineIsEmpty, lineBody, type LineDraft,
} from "./LineFields";

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

const SOURCES = ["EMAIL", "PHONE", "WHATSAPP", "VISIT", "WEBSITE", "REFERRAL", "OTHER"];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function NewEnquiry({ currentUserId, currentUserName }: { currentUserId: string; currentUserName: string }) {
  const router = useRouter();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [prospectName, setProspectName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [receivedAt, setReceivedAt] = useState(today());
  const [source, setSource] = useState("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [numberOverride, setNumberOverride] = useState("");
  const [mine, setMine] = useState(true);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, next: LineDraft) => setLines((ls) => ls.map((l, j) => (j === i ? next : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((_, j) => j !== i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!client && !prospectName.trim()) { setError("Pick the customer, or give the prospect's name."); return; }
    setSaving(true);
    setError(null);
    const items = lines.filter((l) => !lineIsEmpty(l)).map(lineBody);
    const res = await postJson("/api/office/commercial/enquiries", {
      clientId: client?.id ?? "",
      prospectName: client ? "" : prospectName,
      contactName, contactEmail, contactPhone,
      receivedAt, source, subject, body,
      assignedToId: mine ? currentUserId : "",
      numberOverride,
      items,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Could not log the enquiry"); return; }
    router.push(`/office/commercial/enquiries/${res.data.id}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <ThicknessOptions />
      {error && <div className={errBox}>{error}</div>}

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Who it is from</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <span className={lbl}>Customer on the master</span>
            <ClientPicker value={client} onChange={setClient} disabled={saving} />
            <span className="mt-1 block text-[11px] text-gray-400">
              Leave blank for a prospect. An order needs a customer here, so it has to be filled before Convert.
            </span>
          </div>
          <label className="block">
            <span className={lbl}>Prospect name {client ? "(not used — a customer is picked)" : ""}</span>
            <input className={inp} value={prospectName} onChange={(e) => setProspectName(e.target.value)} disabled={saving || Boolean(client)} placeholder="Stonewright LLC" />
          </label>
          <label className="block">
            <span className={lbl}>Contact person</span>
            <input className={inp} value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={saving} placeholder="Ravi Kumar" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className={lbl}>Contact e-mail</span>
              <input className={inp} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={saving} placeholder="buyer@customer.example" />
            </label>
            <label className="block">
              <span className={lbl}>Contact phone</span>
              <input className={inp} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={saving} placeholder="+1 214 555 0134" />
            </label>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">The enquiry</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="block">
            <span className={lbl}>Received</span>
            <input type="date" className={inp} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} disabled={saving} />
          </label>
          <label className="block">
            <span className={lbl}>How it arrived</span>
            <select className={inp} value={source} onChange={(e) => setSource(e.target.value)} disabled={saving}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className={lbl}>Subject</span>
            <input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={saving} placeholder="2cm quartz for the Baner site" />
          </label>
          <div className="md:col-span-4">
            <label className="block">
              <span className={lbl}>What they said</span>
              <textarea className={`${inp} min-h-[120px]`} value={body} onChange={(e) => setBody(e.target.value)} disabled={saving}
                placeholder="Paste the mail, or write down what was said on the phone." />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={saving} />
            Assign to me ({currentUserName})
          </label>
          <label className="block md:col-span-2">
            <span className={lbl}>Number (leave blank to let the ERP issue one)</span>
            <input className={inp} value={numberOverride} onChange={(e) => setNumberOverride(e.target.value)} disabled={saving} placeholder="ENQ/26-27/0004" />
          </label>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">What they asked for</h2>
          <span className="text-xs text-gray-400">Each line needs our design or the customer&apos;s SKU. Blank lines are ignored.</span>
        </div>
        <div className="mt-3 overflow-x-auto px-2 pb-4">
          <table className="w-full min-w-[900px] text-sm">
            <thead><LineHeader /></thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <tr key={i}>
                  <LineInputs value={l} onChange={(n) => setLine(i, n)} disabled={saving} />
                  <td className="px-2 py-2 text-right">
                    <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => removeLine(i)} disabled={saving}>remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-5">
          <button type="button" className={btnGhost} onClick={addLine} disabled={saving}>Add a line</button>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Log the enquiry"}</button>
        <Link href="/office/commercial/enquiries" className={btnGhost}>Cancel</Link>
      </div>
    </form>
  );
}
