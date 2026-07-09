"use client";
/**
 * CommercialInvoiceClient
 * Commercial fills per-order invoice details. All fields pre-fill from the
 * last saved config for this factory type. On save → becomes new default.
 */
import { useEffect, useRef, useState } from "react";

type PIItem = {
  colour?: string;
  description?: string;
  thick?: string;
  sqft?: number;
  sqm?: number;
  rate?: number;
  total?: number;
};

type Props = {
  orderId:      string;
  orderNumber:  string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  piNumber?:    string;
  piDate?:      string;
  productType:  "QUARTZ" | "GRANITE";
  currency:     string;
  piItems:      PIItem[];
  spName?:      string | null;
  // Shipping doc snapshot (pre-fills transport fields)
  shipmentDocs?: Record<string, any>;
};

const FIELD = (label: string, value: string, onChange: (v: string) => void, opts?: { rows?: number; mono?: boolean }) => (
  <div>
    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">{label}</label>
    {(opts?.rows ?? 1) > 1 ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={opts!.rows}
        className={`w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-300 resize-y ${opts?.mono ? "font-mono" : ""}`}
      />
    ) : (
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-300 ${opts?.mono ? "font-mono" : ""}`}
      />
    )}
  </div>
);

export default function CommercialInvoiceClient({
  orderId, orderNumber, invoiceNumber, invoiceDate, piNumber, piDate,
  productType, currency, piItems, spName, shipmentDocs,
}: Props) {
  const [cfg,        setCfg]     = useState<Record<string, any>>({});
  const [weights,    setWeights] = useState<string[]>([]);
  const [marksNos,   setMarksNos]= useState("");
  const [loading,    setLoading] = useState(true);
  const [saving,     setSaving]  = useState(false);
  const [generating, setGen]     = useState(false);
  const [msg,        setMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const hasFetched = useRef(false);

  // ── Load config + any previously saved per-order data ────────────────────
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    (async () => {
      const [cfgRes, orderRes] = await Promise.all([
        fetch(`/api/sales/invoice-config?type=${productType}`),
        fetch(`/api/sales/orders/${orderId}/invoice-data`),
      ]);
      const cfgData   = cfgRes.ok   ? await cfgRes.json()   : {};
      const orderData = orderRes.ok ? await orderRes.json()  : {};

      // Per-order data overrides config; config is the base pre-fill
      const merged = { ...(cfgData.config ?? {}), ...(orderData.overrides ?? {}) };
      setCfg(merged);

      // Per-item weights
      const w = orderData.itemNetWeights ?? piItems.map(() => "");
      setWeights(Array.isArray(w) ? w.map(String) : piItems.map(() => ""));
      setMarksNos(orderData.marksNos ?? "");
      setLoading(false);
    })();
  }, [orderId, productType]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key: string, val: string) {
    setCfg(prev => ({ ...prev, [key]: val }));
  }

  // ── Save: updates global config (pre-fill for future) + per-order data ───
  async function save() {
    setSaving(true); setMsg(null);
    const [r1, r2] = await Promise.all([
      // Update global template for this factory
      fetch("/api/sales/invoice-config", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: productType, config: cfg }),
      }),
      // Save per-order specifics
      fetch(`/api/sales/orders/${orderId}/invoice-data`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          overrides:      cfg,
          itemNetWeights: weights,
          marksNos,
        }),
      }),
    ]);
    setSaving(false);
    if (!r1.ok || !r2.ok) {
      setMsg({ ok: false, text: "Failed to save" });
    } else {
      setMsg({ ok: true, text: "Saved — pre-filled for next order too" });
    }
  }

  // ── Generate PDF (save first, then generate) ──────────────────────────────
  async function generate() {
    setGen(true); setMsg(null);
    // Save first
    await fetch("/api/sales/invoice-config", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type: productType, config: cfg }),
    });
    await fetch(`/api/sales/orders/${orderId}/invoice-data`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ overrides: cfg, itemNetWeights: weights, marksNos }),
    });
    // Generate
    const r = await fetch(`/api/sales/orders/${orderId}/generate-invoice`, { method: "POST" });
    setGen(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setMsg({ ok: false, text: d.error ?? "Failed to generate invoice" });
    } else {
      setMsg({ ok: true, text: "Invoice generated & combined PDF updated. SP notified." });
    }
  }

  if (loading) return <p className="text-xs text-slate-400 py-4">Loading invoice config…</p>;

  const isGranite = productType === "GRANITE";
  // SP sales rep code shown in "RBI Code" field on template
  const spCode = spName ? `ABHI` : ""; // auto from SP first name — backend fills correctly

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="border border-slate-100 rounded-xl p-4 space-y-3">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{title}</p>
      {children}
    </div>
  );
  const Grid = ({ cols, children }: { cols: number; children: React.ReactNode }) => (
    <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{children}</div>
  );

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-4 py-2.5">
        <span><span className="font-semibold text-slate-700">Invoice No:</span> {invoiceNumber || orderNumber}</span>
        <span><span className="font-semibold text-slate-700">PI Ref:</span> {piNumber}</span>
        <span><span className="font-semibold text-slate-700">Factory:</span>
          <span className={`ml-1 font-bold ${isGranite ? "text-stone-600" : "text-sky-600"}`}>{productType}</span>
        </span>
        <span><span className="font-semibold text-slate-700">Currency:</span> {currency}</span>
      </div>

      {/* ── Company Header ── */}
      <Section title="Company Header">
        <Grid cols={2}>
          {FIELD("Company Name", cfg.companyName ?? "", v => setField("companyName", v))}
          {FIELD("IEC Code No.", cfg.iecCode ?? "", v => setField("iecCode", v))}
        </Grid>
        {FIELD("Company Address", cfg.companyAddress ?? "", v => setField("companyAddress", v), { rows: 3 })}
        <Grid cols={3}>
          {FIELD("GSTIN", cfg.gstin ?? "", v => setField("gstin", v), { mono: true })}
          {FIELD("State Code", cfg.stateCode ?? "", v => setField("stateCode", v))}
          {FIELD("District Code", cfg.districtCode ?? "", v => setField("districtCode", v))}
        </Grid>
        {isGranite && (
          <Grid cols={2}>
            {FIELD("TIN No.", cfg.tinNo ?? "", v => setField("tinNo", v), { mono: true })}
            {FIELD("CST No.", cfg.cstNo ?? "", v => setField("cstNo", v), { mono: true })}
          </Grid>
        )}
        {FIELD("Jurisdictional Office Address", cfg.jurisdictionalOfficeAddress ?? "", v => setField("jurisdictionalOfficeAddress", v), { rows: 3 })}
        <Grid cols={3}>
          {FIELD("HSN Code", cfg.hsnCode ?? "", v => setField("hsnCode", v), { mono: true })}
          {FIELD("Product Description", cfg.productDescription ?? "", v => setField("productDescription", v))}
          {FIELD("Unit (SQFT/SQM)", cfg.unit ?? "", v => setField("unit", v))}
        </Grid>
        <div className="flex gap-4 items-center">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={!!cfg.is100EOU} onChange={e => setField("is100EOU", String(e.target.checked))} className="rounded" />
            100% EOU badge
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={!!cfg.religiousHeader} onChange={e => setField("religiousHeader", e.target.checked ? "Sree Hari Om" : "")} className="rounded" />
            "Sree Hari Om" header
          </label>
        </div>
      </Section>

      {/* ── Bank Details ── */}
      <Section title="Bank Details">
        <Grid cols={2}>
          {FIELD("Bank Name", cfg.bankName ?? "", v => setField("bankName", v))}
          {FIELD("AD Code", cfg.adCode ?? "", v => setField("adCode", v), { mono: true })}
        </Grid>
        {FIELD("Bank Address", cfg.bankAddress ?? "", v => setField("bankAddress", v), { rows: 3 })}
        <Grid cols={2}>
          {FIELD("Account No.", cfg.accountNo ?? "", v => setField("accountNo", v), { mono: true })}
          {FIELD("SWIFT Code", cfg.swiftCode ?? "", v => setField("swiftCode", v), { mono: true })}
        </Grid>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide pt-1">Routing Bank</p>
        <Grid cols={2}>
          {FIELD("Routing Bank Name", cfg.routingBankName ?? "", v => setField("routingBankName", v))}
          {FIELD("Routing Bank SWIFT", cfg.routingBankSwift ?? "", v => setField("routingBankSwift", v), { mono: true })}
        </Grid>
        <Grid cols={2}>
          {FIELD("Routing Bank Address", cfg.routingBankAddress ?? "", v => setField("routingBankAddress", v))}
          {FIELD("Nostro A/c No.", cfg.routingBankNostro ?? "", v => setField("routingBankNostro", v), { mono: true })}
        </Grid>
      </Section>

      {/* ── Per-Item Net Weights + Marks ── */}
      <Section title="Item Details (Per-Order)">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Marks &amp; Nos (e.g. 01 to 72)</label>
          <input
            value={marksNos}
            onChange={e => setMarksNos(e.target.value)}
            placeholder="e.g. 01 to 08"
            className="w-48 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-300"
          />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Net Weight per Colour (kg)</p>
          <div className="space-y-2">
            {piItems.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-48 truncate font-medium">
                  {item.colour || item.description || `Item ${i + 1}`}
                  {item.thick ? ` · ${item.thick}` : ""}
                </span>
                <input
                  type="number"
                  value={weights[i] ?? ""}
                  onChange={e => {
                    const w = [...weights];
                    w[i] = e.target.value;
                    setWeights(w);
                  }}
                  placeholder="kg"
                  className="w-28 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
                <span className="text-[10px] text-slate-400">kg</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Charges ── */}
      <Section title="Charges (Pre-fills from last used)">
        <Grid cols={2}>
          {FIELD(`Ocean Freight (${currency})`, cfg.oceanFreight ?? "", v => setField("oceanFreight", v), { mono: true })}
          {FIELD(`Packing Charges (${currency})`, cfg.packingCharges ?? "", v => setField("packingCharges", v), { mono: true })}
        </Grid>
        <Grid cols={2}>
          {FIELD("Insurance % (e.g. 0.00)", cfg.insurancePct ?? "0.00", v => setField("insurancePct", v), { mono: true })}
          {FIELD(`Discount (${currency}) — leave blank if none`, cfg.discountAmount ?? "", v => setField("discountAmount", v), { mono: true })}
        </Grid>
      </Section>

      {/* ── Signature & Legal Footer ── */}
      <Section title="Signature & Footer">
        {FIELD("Signature Line", cfg.signatureLine ?? "", v => setField("signatureLine", v))}
        {FIELD("Legal Footer Text (pre-filled, edit if needed)", cfg.legalFooter ?? "", v => setField("legalFooter", v), { rows: 6 })}
      </Section>

      {/* ── Actions ── */}
      <div className="flex gap-3 items-center flex-wrap pt-1">
        <button
          onClick={save}
          disabled={saving || generating}
          className="px-5 py-2 text-xs font-bold bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition"
        >
          {saving ? "Saving…" : "Save (pre-fill next)"}
        </button>
        <button
          onClick={generate}
          disabled={saving || generating}
          className="px-5 py-2 text-xs font-bold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {generating ? "Generating…" : "Generate Invoice & Combined PDF"}
        </button>
        {msg && (
          <p className={`text-xs font-medium ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>
        )}
      </div>
      <p className="text-[10px] text-slate-400">
        Saving updates the template — next order for {productType} will pre-fill with these values.
        Marks &amp; Nos and item weights are per-order only and are not carried forward.
      </p>
    </div>
  );
}
