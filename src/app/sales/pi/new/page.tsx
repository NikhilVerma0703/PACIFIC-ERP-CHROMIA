"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Client = { id: string; name: string; country: string | null };
type Item = {
  colour: string; material: string; finish: string; thickness: string;
  noOfSlabs: number; sqft: number; sqm: number; unitPrice: number;
  // Granite-specific
  marksNo: string; woodenCrates: number;
};

const EMPTY_ITEM: Item = {
  colour: "", material: "", finish: "", thickness: "",
  noOfSlabs: 0, sqft: 0, sqm: 0, unitPrice: 0,
  marksNo: "", woodenCrates: 0,
};
const CURRENCIES = ["USD", "EUR", "GBP", "AED", "SGD", "INR"];

const inp = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500";

function PctBox({
  label, sublabel, pct, days, onPct, onDays, showDays = false,
}: {
  label: string; sublabel?: string; pct: number; days: number; onPct: (v: number) => void;
  onDays: (v: number) => void; showDays?: boolean;
}) {
  return (
    <div className="flex flex-col border border-slate-200 rounded-xl p-3 bg-slate-50 gap-2">
      <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">{label}</p>
      {sublabel && <p className="text-[10px] text-slate-400 -mt-1">{sublabel}</p>}
      <div className="flex items-center gap-1">
        <input
          type="number" min={0} max={100} step={5} value={pct || ""}
          onChange={e => onPct(Number(e.target.value))}
          placeholder="0"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-lg font-bold text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-center"
        />
        <span className="text-slate-500 font-semibold text-sm">%</span>
      </div>
      {showDays && (
        <div className="flex items-center gap-1">
          <input
            type="number" min={0} value={days || ""} onChange={e => onDays(Number(e.target.value))}
            placeholder="days"
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
          />
          <span className="text-slate-400 text-[10px]">days</span>
        </div>
      )}
    </div>
  );
}

export default function NewPIPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 text-sm">Loading...</div>}>
      <NewPIPageInner />
    </Suspense>
  );
}

function NewPIPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copyId = searchParams.get("copy");

  const [clients, setClients] = useState<Client[]>([]);
  const [productType, setProductType] = useState<"QUARTZ" | "GRANITE">("QUARTZ");
  const isGranite = productType === "GRANITE";
  const [editMode, setEditMode] = useState(false);
  const [loadingCopy, setLoadingCopy] = useState(false);

  const [form, setForm] = useState({
    clientId: "", currency: "USD", validityDays: 30,
    deliveryTerms: "", portOfLoading: "Chennai Port", portOfDischarge: "", notes: "",
    consigneeDetails: "", notifyPartyDetails: "", buyerPoNo: "", countryOfDestination: "",
    placeOfReceipt: "", finalDestination: "", buyerIfNotConsignee: "",
  });
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);

  const [pt, setPt] = useState({
    advancePct: 0,
    cadPct: 0, cadDays: 0,
    blToPayPct: 0, blToPayDays: 0,
    receiveToPayPct: 0, receiveToPayDays: 0,
    inspectionPct: 0, inspectionDays: 0,
    creditPct: 0, creditDays: 0,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [clientCredits, setClientCredits] = useState<{ creditNumber: string; amount: number; currency: string; reason: string }[]>([]);
  useEffect(() => {
    fetch("/api/sales/clients").then(r => r.json()).then(setClients);
  }, []);

  // Fetch available (ISSUED, unapplied) credit notes when client changes
  useEffect(() => {
    if (!form.clientId) { setClientCredits([]); return; }
    fetch(`/api/sales/credit-notes?clientId=${form.clientId}`)
      .then(r => r.json())
      .then((cns: any[]) => Array.isArray(cns) ? setClientCredits(cns) : setClientCredits([]))
      .catch(() => setClientCredits([]));
  }, [form.clientId]);

  // Prefill form when ?copy=<id> is present
  useEffect(() => {
    if (!copyId) return;
    setLoadingCopy(true);
    fetch(`/api/sales/pi/${copyId}`)
      .then(r => r.json())
      .then((pi: any) => {
        const editable = ["DRAFT", "UNDER_REVISION"].includes(pi.status);
        setEditMode(editable);
        setProductType(pi.productType === "GRANITE" ? "GRANITE" : "QUARTZ");
        setForm({
          clientId:             pi.clientId             ?? "",
          currency:             pi.currency             ?? "USD",
          validityDays:         pi.validityDays         ?? 30,
          deliveryTerms:        pi.deliveryTerms        ?? "",
          portOfLoading:        pi.portOfLoading        ?? "Chennai Port",
          portOfDischarge:      pi.portOfDischarge      ?? "",
          notes:                pi.notes                ?? "",
          consigneeDetails:     pi.consigneeDetails     ?? "",
          notifyPartyDetails:   pi.notifyPartyDetails   ?? "",
          buyerPoNo:            pi.buyerPoNo            ?? "",
          countryOfDestination: pi.countryOfDestination ?? "",
          placeOfReceipt:       pi.placeOfReceipt       ?? "",
          finalDestination:     pi.finalDestination     ?? "",
          buyerIfNotConsignee:  pi.buyerIfNotConsignee  ?? "",
        });
        const rawItems: any[] = Array.isArray(pi.items) ? pi.items : [];
        const mappedItems: Item[] = rawItems.map((it: any) => ({
          colour:       it.colour    ?? it.color       ?? it.description ?? "",
          material:     it.material  ?? "",
          finish:       it.finish    ?? "",
          thickness:    it.thickness ?? "",
          noOfSlabs:    Number(it.noOfSlabs ?? 0),
          sqft:         Number(it.sqft      ?? (it.unit === "SQFT" ? it.qty : 0) ?? 0),
          sqm:          Number(it.sqm       ?? (it.unit === "SQM"  ? it.qty : 0) ?? 0),
          unitPrice:    Number(it.unitPrice ?? 0),
          marksNo:      it.marksNo      ?? "",
          woodenCrates: Number(it.woodenCrates ?? 0),
        }));
        setItems(mappedItems.length > 0 ? mappedItems : [{ ...EMPTY_ITEM }]);
        const ptData = pi.paymentTerms as any;
        if (ptData && typeof ptData === "object") {
          setPt({
            advancePct:       Number(ptData.advancePct       ?? 0),
            cadPct:           Number(ptData.cadPct           ?? 0),
            cadDays:          Number(ptData.cadDays          ?? 0),
            blToPayPct:       Number(ptData.blToPayPct       ?? 0),
            blToPayDays:      Number(ptData.blToPayDays      ?? 0),
            receiveToPayPct:  Number(ptData.receiveToPayPct  ?? 0),
            receiveToPayDays: Number(ptData.receiveToPayDays ?? 0),
            inspectionPct:    Number(ptData.inspectionPct    ?? 0),
            inspectionDays:   Number(ptData.inspectionDays   ?? 0),
            creditPct:        Number(ptData.creditPct        ?? 0),
            creditDays:       Number(ptData.creditDays       ?? 0),
          });
        }
      })
      .finally(() => setLoadingCopy(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyId]);

  useEffect(() => {
    setForm(f => ({ ...f, portOfLoading: "Chennai Port" }));
  }, [isGranite]);

  function setItem(idx: number, key: keyof Item, val: any) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it));
  }
  function addItem() { setItems(prev => [...prev, { ...EMPTY_ITEM }]); }
  function removeItem(i: number) { setItems(prev => prev.filter((_, j) => j !== i)); }

  function getQty(it: Item) { return isGranite ? it.sqm : it.sqft; }
  function setQty(idx: number, val: number) {
    if (isGranite) setItem(idx, "sqm", val);
    else setItem(idx, "sqft", val);
  }

  const total = items.reduce((s, i) => s + getQty(i) * i.unitPrice, 0);
  const ptTotal = pt.advancePct + pt.cadPct + pt.blToPayPct + pt.receiveToPayPct + pt.inspectionPct + pt.creditPct;

  function ptSummary(): string {
    const parts: string[] = [];
    if (pt.advancePct > 0)       parts.push(`${pt.advancePct}% Advance`);
    if (pt.cadPct > 0)           parts.push(`${pt.cadPct}% CAD (before port arrival)`);
    if (pt.blToPayPct > 0)       parts.push(`${pt.blToPayPct}% After BL${pt.blToPayDays ? ` (${pt.blToPayDays}d)` : ""}`);
    if (pt.receiveToPayPct > 0)  parts.push(`${pt.receiveToPayPct}% After Receipt${pt.receiveToPayDays ? ` (${pt.receiveToPayDays}d)` : ""}`);
    if (pt.inspectionPct > 0)    parts.push(`${pt.inspectionPct}% Inspection${pt.inspectionDays ? ` (${pt.inspectionDays}d)` : ""}`);
    if (pt.creditPct > 0)        parts.push(`${pt.creditPct}% Credit${pt.creditDays ? ` (${pt.creditDays}d)` : ""}`);
    return parts.join(", ") || "To be agreed";
  }

  async function save() {
    if (!form.clientId)   { setError("Please select a client"); return; }
    if (!items[0].colour) { setError("Add at least one line item"); return; }
    if (ptTotal > 100)    { setError(`Payment terms add up to ${ptTotal}% -- must be <= 100%`); return; }
    setSaving(true); setError("");

    const itemsWithAmount = items.map(it => ({
      ...it,
      unit: isGranite ? "SQM" : "SQFT",
      amount: Number((getQty(it) * it.unitPrice).toFixed(2)),
    }));

    const paymentTerms = ptTotal > 0 ? {
      advancePct: pt.advancePct,
      cadPct: pt.cadPct, cadDays: pt.cadDays || null,
      blToPayPct: pt.blToPayPct, blToPayDays: pt.blToPayDays || null,
      receiveToPayPct: pt.receiveToPayPct, receiveToPayDays: pt.receiveToPayDays || null,
      inspectionPct: pt.inspectionPct, inspectionDays: pt.inspectionDays || null,
      creditPct: pt.creditPct, creditDays: pt.creditDays || null,
    } : undefined;

    const payload = {
      ...form,
      productType,
      paymentTermsSummary: ptSummary(),
      items: itemsWithAmount,
      ...(paymentTerms ? { paymentTerms } : {}),
    };

    const url    = editMode && copyId ? `/api/sales/pi/${copyId}` : "/api/sales/pi";
    const method = editMode && copyId ? "PATCH" : "POST";

    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json(); setError(d.error ?? "Save failed"); return; }
    const pi = await r.json();
    router.push(`/sales/pi/${pi.id}`);
  }

  if (loadingCopy) {
    return <div className="p-8 text-slate-500 text-sm">Loading PI data...</div>;
  }

  const pageTitle = editMode
    ? `Edit ${isGranite ? "PGI" : "PI"}`
    : copyId
    ? `Copy ${isGranite ? "PGI" : "PI"}`
    : `New ${isGranite ? "Proforma Granite Invoice" : "Proforma Invoice"}`;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-sm">Back</button>
        <h1 className="text-xl font-bold text-slate-900">{pageTitle}</h1>
        {editMode && (
          <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
            Editing Draft
          </span>
        )}
        {copyId && !editMode && (
          <span className="text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
            Copying (New PI)
          </span>
        )}
      </div>

      <div className="space-y-5">

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
            Product Type
            {copyId && <span className="ml-2 text-xs font-normal text-slate-400">{editMode ? "(locked on edit)" : ""}</span>}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => !copyId && setProductType("QUARTZ")}
              disabled={!!copyId}
              className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition ${
                !isGranite ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:border-teal-300"
              } ${copyId ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <div className="text-lg mb-0.5">Q</div>
              Quartz
              <div className="text-xs font-normal text-slate-400 mt-0.5">Pacific Engineered Surfaces - SQFT</div>
            </button>
            <button
              onClick={() => !copyId && setProductType("GRANITE")}
              disabled={!!copyId}
              className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition ${
                isGranite ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:border-amber-300"
              } ${copyId ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <div className="text-lg mb-0.5">G</div>
              Granite
              <div className="text-xs font-normal text-slate-400 mt-0.5">Pacific Granites India - SQM - PG-XXXX</div>
            </button>
          </div>
          {isGranite && (
            <p className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
              Granite PIs will use Pacific Granites (India) Pvt. Ltd. letterhead with IEC 3811000012, GST 33AAFCP5374A1ZQ.
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Client and Trade</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Client *</label>
              <select
                value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                disabled={editMode}
                className={`${inp} ${editMode ? "opacity-60 cursor-not-allowed bg-slate-50" : ""}`}
              >
                <option value="">Select client...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.country ? ` (${c.country})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={inp}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Delivery Terms (Incoterms)</label>
              <input value={form.deliveryTerms} onChange={e => setForm(f => ({ ...f, deliveryTerms: e.target.value }))}
                placeholder="e.g. CIF Dubai" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Validity (days)</label>
              <input type="number" value={form.validityDays} onChange={e => setForm(f => ({ ...f, validityDays: Number(e.target.value) }))} className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Port of Loading</label>
              <input value={form.portOfLoading} onChange={e => setForm(f => ({ ...f, portOfLoading: e.target.value }))}
                placeholder="Chennai Port" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Port of Discharge</label>
              <input value={form.portOfDischarge} onChange={e => setForm(f => ({ ...f, portOfDischarge: e.target.value }))}
                placeholder="e.g. Jebel Ali" className={inp} />
            </div>
          </div>
          {clientCredits.length > 0 && (
            <div className="mt-4 border border-green-200 bg-green-50 rounded-xl p-3">
              <p className="text-xs font-bold text-green-800 mb-2">
                Outstanding Credit Notes for this Customer ({clientCredits.length})
              </p>
              <div className="space-y-1">
                {clientCredits.map((cn, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-700">{cn.creditNumber}</span>
                    <span className="text-slate-500 truncate mx-2">{cn.reason}</span>
                    <span className="font-bold text-green-800 flex-shrink-0">{cn.currency} {Number(cn.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-green-700 mt-2">
                Total: <strong>{clientCredits[0]?.currency} {clientCredits.reduce((s, cn) => s + Number(cn.amount), 0).toFixed(2)}</strong> -- account for this in the PI amount, or apply after the order is created.
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Consignee and Notify Party</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Consignee Details</label>
              <textarea value={form.consigneeDetails} onChange={e => setForm(f => ({ ...f, consigneeDetails: e.target.value }))}
                rows={3} placeholder="Name, Address, Country..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Notify Party</label>
              <textarea value={form.notifyPartyDetails} onChange={e => setForm(f => ({ ...f, notifyPartyDetails: e.target.value }))}
                rows={3} placeholder="Notify party name and address..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Buyer PO No.</label>
              <input value={form.buyerPoNo} onChange={e => setForm(f => ({ ...f, buyerPoNo: e.target.value }))}
                placeholder="e.g. PO-2024-001" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Country of Destination</label>
              <input value={form.countryOfDestination} onChange={e => setForm(f => ({ ...f, countryOfDestination: e.target.value }))}
                placeholder="e.g. UAE" className={inp} />
            </div>
            {isGranite && (<>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Place of Receipt By Pre-Carrier</label>
                <input value={form.placeOfReceipt} onChange={e => setForm(f => ({ ...f, placeOfReceipt: e.target.value }))}
                  placeholder="e.g. Chennai Port" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Final Destination</label>
                <input value={form.finalDestination} onChange={e => setForm(f => ({ ...f, finalDestination: e.target.value }))}
                  placeholder="e.g. To be Confirmed" className={inp} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Buyer if Not Consignee</label>
                <input value={form.buyerIfNotConsignee} onChange={e => setForm(f => ({ ...f, buyerIfNotConsignee: e.target.value }))}
                  placeholder="Leave blank if same as consignee" className={inp} />
              </div>
            </>)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Payment Terms</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ptTotal > 100 ? "bg-red-100 text-red-600" : ptTotal === 100 ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-500"}`}>
              {ptTotal}% / 100%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <PctBox label="Advance" pct={pt.advancePct} days={0} showDays={false}
              onPct={v => setPt(p => ({ ...p, advancePct: v }))} onDays={() => {}} />
            <PctBox label="CAD" sublabel="Before port arrival" pct={pt.cadPct} days={0} showDays={false}
              onPct={v => setPt(p => ({ ...p, cadPct: v }))} onDays={() => {}} />
            <PctBox label="After BL" sublabel="On BL receipt" pct={pt.blToPayPct} days={pt.blToPayDays} showDays
              onPct={v => setPt(p => ({ ...p, blToPayPct: v }))} onDays={v => setPt(p => ({ ...p, blToPayDays: v }))} />
            <PctBox label="After Receipt" sublabel="On receiving goods" pct={pt.receiveToPayPct} days={pt.receiveToPayDays} showDays
              onPct={v => setPt(p => ({ ...p, receiveToPayPct: v }))} onDays={v => setPt(p => ({ ...p, receiveToPayDays: v }))} />
            <PctBox label="Inspection" pct={pt.inspectionPct} days={pt.inspectionDays} showDays
              onPct={v => setPt(p => ({ ...p, inspectionPct: v }))} onDays={v => setPt(p => ({ ...p, inspectionDays: v }))} />
            <PctBox label="Credit" pct={pt.creditPct} days={pt.creditDays} showDays
              onPct={v => setPt(p => ({ ...p, creditPct: v }))} onDays={v => setPt(p => ({ ...p, creditDays: v }))} />
          </div>
          {ptTotal > 0 && (
            <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Summary: <span className="font-medium text-slate-700">{ptSummary()}</span>
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
              Line Items
              <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-bold ${isGranite ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700"}`}>
                {isGranite ? "SQM" : "SQFT"}
              </span>
            </p>
            <button onClick={addItem} className="text-xs text-teal-600 font-semibold hover:text-teal-800 border border-teal-200 px-2 py-1 rounded-lg">+ Add Row</button>
          </div>
          <div className="overflow-x-auto">
            {isGranite ? (
              /* ── GRANITE columns: marksNo, woodenCrates, colour, thickness, noOfSlabs, sqm, unitPrice, amount ── */
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Marks & No.","W/Crates","Colour / Description *","Thickness (CM)","No. of Slabs/Pcs","SQM","Rate USD","Amount",""].map(h => (
                      <th key={h} className="px-2 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-1 py-1.5">
                        <input value={it.marksNo} onChange={e => setItem(idx, "marksNo", e.target.value)}
                          placeholder="e.g. M1" className="w-16 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} value={it.woodenCrates || ""}
                          onChange={e => setItem(idx, "woodenCrates", Number(e.target.value))}
                          className="w-14 border border-slate-200 rounded px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={it.colour} onChange={e => setItem(idx, "colour", e.target.value)}
                          placeholder="e.g. Black Galaxy" className="w-32 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={it.thickness} onChange={e => setItem(idx, "thickness", e.target.value)}
                          placeholder="e.g. 2" className="w-14 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} value={it.noOfSlabs || ""}
                          onChange={e => setItem(idx, "noOfSlabs", Number(e.target.value))}
                          className="w-16 border border-slate-200 rounded px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} step={0.001} value={it.sqm || ""}
                          onChange={e => setItem(idx, "sqm", Number(e.target.value))}
                          className="w-20 border border-slate-200 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} step={0.01} value={it.unitPrice || ""}
                          onChange={e => setItem(idx, "unitPrice", Number(e.target.value))}
                          className="w-20 border border-slate-200 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-slate-700 whitespace-nowrap text-right">
                        {form.currency} {(it.sqm * it.unitPrice).toFixed(2)}
                      </td>
                      <td className="px-1 py-1.5">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-base">x</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-right font-semibold text-slate-700">Grand Total</td>
                    <td className="px-2 py-2 font-bold text-slate-900 whitespace-nowrap text-right">
                      {form.currency} {total.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* ── QUARTZ columns (existing) ── */
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Colour / Description *","Material","Finish","Thickness","No. of Slabs","Sq.Ft","Unit Price","Amount",""].map(h => (
                      <th key={h} className="px-2 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-1 py-1.5">
                        <input value={it.colour} onChange={e => setItem(idx, "colour", e.target.value)}
                          placeholder="e.g. Calacatta Gold" className="w-32 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={it.material} onChange={e => setItem(idx, "material", e.target.value)}
                          placeholder="Quartz" className="w-20 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={it.finish} onChange={e => setItem(idx, "finish", e.target.value)}
                          placeholder="Polished" className="w-18 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input value={it.thickness} onChange={e => setItem(idx, "thickness", e.target.value)}
                          placeholder="20mm" className="w-16 border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} value={it.noOfSlabs || ""}
                          onChange={e => setItem(idx, "noOfSlabs", Number(e.target.value))}
                          className="w-16 border border-slate-200 rounded px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} step={0.01} value={getQty(it) || ""}
                          onChange={e => setQty(idx, Number(e.target.value))}
                          className="w-20 border border-slate-200 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-1 py-1.5">
                        <input type="number" min={0} step={0.01} value={it.unitPrice || ""}
                          onChange={e => setItem(idx, "unitPrice", Number(e.target.value))}
                          className="w-20 border border-slate-200 rounded px-2 py-1.5 text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-slate-700 whitespace-nowrap text-right">
                        {form.currency} {(getQty(it) * it.unitPrice).toFixed(2)}
                      </td>
                      <td className="px-1 py-1.5">
                        {items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-base">x</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={7} className="px-3 py-2 text-right font-semibold text-slate-700">Grand Total</td>
                    <td className="px-2 py-2 font-bold text-slate-900 whitespace-nowrap text-right">
                      {form.currency} {total.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Notes / Remarks</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3} placeholder="Additional notes for the client..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

        <div className="flex justify-end gap-3 pb-8">
          <button onClick={() => router.back()} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
          <button onClick={save} disabled={saving}
            className={`px-6 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition ${isGranite ? "bg-amber-600 hover:bg-amber-700" : "bg-teal-600 hover:bg-teal-700"}`}>
            {saving
              ? (editMode ? "Saving..." : "Creating...")
              : editMode
                ? `Save ${isGranite ? "PGI" : "PI"}`
                : `Create ${isGranite ? "PGI" : "PI"}`
            }
          </button>
        </div>
      </div>

    </div>
  );
}
