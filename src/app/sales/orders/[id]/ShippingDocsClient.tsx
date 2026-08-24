"use client";
import { useEffect, useState, useRef } from "react";

type Photo = { url: string; filename: string; caption?: string };

type PackingItem = { index: number; netWeight: number | null };

type ShipDocs = {
  containerNo?:        string | null;
  vesselName?:         string | null;
  portOfLoading?:      string | null;
  portOfDischarge?:    string | null;
  etaDate?:            string | null;
  etdDate?:            string | null;
  blDate?:             string | null;
  blNo?:               string | null;
  sbNo?:               string | null;
  linerOtlNo?:         string | null;
  eSealNo?:            string | null;
  vehicleNo?:          string | null;
  trackingLink?:       string | null;
  packageDescription?: string | null;
  grossWeight?:        number | null;
  netWeight?:          number | null;
  packingItems?:       PackingItem[] | null;
  blDocUrl?:           string | null;
  fumigationCertUrl?:  string | null;
  bankDetailsUrl?:     string | null;
  stuffingPhotos?:     Photo[];
  stuffingMailSentAt?:     string | null;
  shippingDocsMailSentAt?: string | null;
  paymentDueDate?:     string | null;
};

function isBase64DataUri(s: string | null | undefined): boolean {
  return !!s && s.startsWith("data:");
}

function fmt(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}
function fmtDisplay(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ShippingDocsClient({ orderId, piItems = [] }: { orderId: string; piItems?: any[] }) {
  const [docs,    setDocs]    = useState<ShipDocs>({});
  const [form,    setForm]    = useState<ShipDocs>({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [loaded,  setLoaded]  = useState(false);

  const [dispatchSending, setDispatchSending] = useState(false);
  const [dispatchSent,    setDispatchSent]    = useState(false);
  const [dispatchError,   setDispatchError]   = useState<string | null>(null);

  const [shippingSending, setShippingSending] = useState(false);
  const [shippingSent,    setShippingSent]    = useState(false);
  const [shippingError,   setShippingError]   = useState<string | null>(null);

  const [photos,       setPhotos]       = useState<Photo[]>([]);
  const [uploading,    setUploading]    = useState(false);
  const [packingItems, setPackingItems] = useState<PackingItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // PDF doc states (saved via main shipping PATCH)
  const [blDocFile,       setBlDocFile]       = useState<{ name: string; data: string } | null>(null);
  const [fumigationFile,  setFumigationFile]  = useState<{ name: string; data: string } | null>(null);
  const [bankDetailsFile, setBankDetailsFile] = useState<{ name: string; data: string } | null>(null);
  const blDocRef       = useRef<HTMLInputElement>(null);
  const fumigationRef  = useRef<HTMLInputElement>(null);
  const bankDetailsRef = useRef<HTMLInputElement>(null);

  // Packing list + measurement list upload states (saved immediately via /doc-upload)
  const [hasPackingList,     setHasPackingList]     = useState(false);
  const [hasMeasurementList, setHasMeasurementList] = useState(false);
  const [hasInvoice,         setHasInvoice]         = useState(false);
  const [plUploading,        setPlUploading]        = useState(false);
  const [mlUploading,        setMlUploading]        = useState(false);
  const plRef = useRef<HTMLInputElement>(null);
  const mlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/sales/orders/${orderId}/shipping`)
      .then(r => r.json())
      .then(d => {
        setDocs(d);
        setForm(d);
        setPhotos(Array.isArray(d.stuffingPhotos) ? d.stuffingPhotos : []);
        if (isBase64DataUri(d.blDocUrl))          setBlDocFile({ name: "bl_document.pdf", data: d.blDocUrl });
        if (isBase64DataUri(d.fumigationCertUrl)) setFumigationFile({ name: "fumigation_cert.pdf", data: d.fumigationCertUrl });
        if (isBase64DataUri(d.bankDetailsUrl))    setBankDetailsFile({ name: "bank_details.pdf", data: d.bankDetailsUrl });
        // Load per-item net weights saved by commercial
        if (Array.isArray(d.packingItems)) setPackingItems(d.packingItems);
        setLoaded(true);
      });

    // Load packing list + measurement list upload status
    fetch(`/api/sales/orders/${orderId}/doc-upload`)
      .then(r => r.json())
      .then(d => {
        setHasPackingList(!!d.hasPackingList);
        setHasMeasurementList(!!d.hasMeasurementList);
        setHasInvoice(!!d.hasInvoice);
      })
      .catch(() => {});
  }, [orderId]);

  function setF(key: keyof ShipDocs, val: string) {
    setForm(f => ({ ...f, [key]: val || null }));
  }

  async function handlePdfUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: { name: string; data: string } | null) => void,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(file);
    });
    setter({ name: file.name, data });
    e.target.value = "";
  }

  async function handlePackingListUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPlUploading(true);
    const data = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(file);
    });
    // A refused file (415 non-PDF, 413 too large) must not paint the green
    // "uploaded" state — that lie survives until the next reload and gets
    // discovered at shipping-docs-email time.
    const r = await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "packingList", data }),
    });
    if (r.ok) { setHasPackingList(true); setError(null); }
    else {
      const err = await r.json().then((j) => j?.error).catch(() => null);
      setError(`The packing list was not accepted${err ? ` — ${err}` : ""} (HTTP ${r.status}).`);
    }
    setPlUploading(false);
    if (plRef.current) plRef.current.value = "";
  }

  async function clearPackingList() {
    setPlUploading(true);
    await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "packingList", data: null }),
    });
    setHasPackingList(false);
    setPlUploading(false);
  }

  async function handleMeasurementListUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMlUploading(true);
    const data = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(file);
    });
    const r = await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "measurementList", data }),
    });
    if (r.ok) { setHasMeasurementList(true); setError(null); }
    else {
      const err = await r.json().then((j) => j?.error).catch(() => null);
      setError(`The measurement list was not accepted${err ? ` — ${err}` : ""} (HTTP ${r.status}).`);
    }
    setMlUploading(false);
    if (mlRef.current) mlRef.current.value = "";
  }

  async function clearMeasurementList() {
    setMlUploading(true);
    await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "measurementList", data: null }),
    });
    setHasMeasurementList(false);
    setMlUploading(false);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const dataUrl = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.readAsDataURL(file);
      });
      // Upload immediately to server — keeps photos out of the large shipping PATCH body
      try {
        const r = await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "photoAppend", data: { url: dataUrl, filename: file.name } }),
        });
        if (!r.ok) {
          // The server REFUSED it (bad type, too large) — showing it in the
          // strip anyway makes a rejected photo look stored until reload.
          const err = await r.json().then((j) => j?.error).catch(() => null);
          setError(`${file.name} was not accepted${err ? ` — ${err}` : ""} (HTTP ${r.status}).`);
          continue;
        }
        const d = await r.json();
        if (d.photos) setPhotos(d.photos);
        else setPhotos(p => [...p, { url: dataUrl, filename: file.name }]);
      } catch {
        // Fallback: keep in local state if the NETWORK failed (the save path
        // still carries it later) — refusals are handled above and never land here.
        setPhotos(p => [...p, { url: dataUrl, filename: file.name }]);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removePhoto(idx: number) {
    setPhotos(p => p.filter((_, i) => i !== idx));
    // Remove from server immediately
    try {
      const r = await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "photoRemove", data: idx }),
      });
      const d = await r.json();
      if (d.photos) setPhotos(d.photos);
    } catch { /* non-fatal — local state already updated */ }
  }

  function buildPayload() {
    // Explicitly whitelist small metadata fields only.
    // Large base64 PDFs (blDocUrl, fumigationCertUrl, bankDetailsUrl) go via /doc-upload.
    const f = form as Record<string, unknown>;
    return {
      containerNo:        f.containerNo        ?? null,
      vesselName:         f.vesselName         ?? null,
      portOfLoading:      f.portOfLoading      ?? null,
      portOfDischarge:    f.portOfDischarge     ?? null,
      etaDate:            f.etaDate            ?? null,
      etdDate:            f.etdDate            ?? null,
      blDate:             f.blDate             ?? null,
      blNo:               f.blNo               ?? null,
      sbNo:               f.sbNo               ?? null,
      linerOtlNo:         f.linerOtlNo         ?? null,
      eSealNo:            f.eSealNo            ?? null,
      vehicleNo:          f.vehicleNo          ?? null,
      trackingLink:       f.trackingLink       ?? null,
      packageDescription: f.packageDescription ?? null,
      grossWeight:        f.grossWeight        ?? null,
      netWeight:          f.netWeight          ?? null,
      paymentDueDate:     f.paymentDueDate     ?? null,
      packingItems,
      // stuffingPhotos are saved immediately per-photo via /doc-upload — not in this payload
    };
  }

  async function uploadShippingDocs() {
    // Upload the three large PDF files via the dedicated doc-upload endpoint.
    // The route refuses non-PDFs (415) and oversized files (413) — a refusal
    // must THROW so the caller's catch shows it, not vanish into a discarded
    // Promise.all while the screen claims the document is in.
    const uploads: Array<{ type: string; label: string; file: { data: string } | null }> = [
      { type: "blDoc",          label: "BL document",           file: blDocFile },
      { type: "fumigationCert", label: "fumigation certificate", file: fumigationFile },
      { type: "bankDetails",    label: "bank details",           file: bankDetailsFile },
    ];
    await Promise.all(
      uploads
        .filter(u => u.file !== null)
        .map(async u => {
          const r = await fetch(`/api/sales/orders/${orderId}/doc-upload`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: u.type, data: u.file!.data }),
          });
          if (!r.ok) {
            const err = await r.json().then((j) => j?.error).catch(() => null);
            throw new Error(`The ${u.label} was not accepted${err ? ` — ${err}` : ""} (HTTP ${r.status}).`);
          }
        })
    );
  }

  function setItemNetWeight(idx: number, val: string) {
    setPackingItems(prev => {
      const next = [...prev];
      const existing = next.findIndex(p => p.index === idx);
      const nw = val === "" ? null : Number(val);
      if (existing >= 0) next[existing] = { index: idx, netWeight: nw };
      else next.push({ index: idx, netWeight: nw });
      return next;
    });
  }

  function getItemNetWeight(idx: number): string {
    const found = packingItems.find(p => p.index === idx);
    return found?.netWeight != null ? String(found.netWeight) : "";
  }

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      // Upload large PDF docs first (separate endpoint, no body size limit issue)
      await uploadShippingDocs();
      // Then save metadata (small JSON payload)
      const r = await fetch(`/api/sales/orders/${orderId}/shipping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      const d = await r.json();
      setDocs(d); setForm(d);
      setPhotos(Array.isArray(d.stuffingPhotos) ? d.stuffingPhotos : photos);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendDispatchEmail() {
    setDispatchSending(true); setDispatchSent(false); setDispatchError(null);
    try {
      // Upload PDFs first, then save metadata — inside the try, so a refused
      // upload lands in dispatchError instead of an unhandled rejection with
      // the button stuck on "sending".
      await uploadShippingDocs();
      await fetch(`/api/sales/orders/${orderId}/shipping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const r = await fetch(`/api/sales/orders/${orderId}/dispatch-email`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to send");
      setDispatchSent(true);
      setDocs(d => ({ ...d, stuffingMailSentAt: new Date().toISOString() }));
    } catch (e: any) {
      setDispatchError(e.message);
    } finally {
      setDispatchSending(false);
    }
  }

  async function sendShippingDocsEmail() {
    setShippingSending(true); setShippingSent(false); setShippingError(null);
    // Save first (includes newly-uploaded PDFs)
    try {
      await fetch(`/api/sales/orders/${orderId}/shipping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
    } catch { /* non-blocking */ }
    try {
      const r = await fetch(`/api/sales/orders/${orderId}/shipping-docs-email`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to send");
      setShippingSent(true);
      setDocs(d => ({ ...d, shippingDocsMailSentAt: new Date().toISOString() }));
    } catch (e: any) {
      setShippingError(e.message);
    } finally {
      setShippingSending(false);
    }
  }

  if (!loaded) return <p className="text-xs text-slate-400 py-3">Loading shipping docs...</p>;

  const hasContainer    = !!(docs.containerNo || docs.blNo);
  const hasBlPdf        = !!(blDocFile       || isBase64DataUri(docs.blDocUrl));
  const hasFumigation   = !!(fumigationFile   || isBase64DataUri(docs.fumigationCertUrl));
  const hasBankDetails  = !!(bankDetailsFile  || isBase64DataUri(docs.bankDetailsUrl));
  const shippingDocsReady = !!(docs.blNo && hasBlPdf && hasFumigation && hasBankDetails);
  const allDocsReady = hasInvoice && hasPackingList && hasMeasurementList;

  return (
    <div className="space-y-6">
      {/* Status chips */}
      {hasContainer && (
        <div className="flex flex-wrap gap-2">
          {docs.containerNo && (
            <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full border border-indigo-100">
              Container: {docs.containerNo}
            </span>
          )}
          {docs.blNo && (
            <span className="px-3 py-1 bg-green-50 text-green-700 text-xs font-semibold rounded-full border border-green-100">
              BL: {docs.blNo}
            </span>
          )}
          {docs.etaDate && (
            <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full border border-amber-100">
              ETA: {fmtDisplay(docs.etaDate)}
            </span>
          )}
          {docs.stuffingMailSentAt && (
            <span className="px-3 py-1 bg-teal-50 text-teal-700 text-xs font-semibold rounded-full border border-teal-100">
              Dispatch sent {fmtDisplay(docs.stuffingMailSentAt)}
            </span>
          )}
          {docs.shippingDocsMailSentAt && (
            <span className="px-3 py-1 bg-purple-50 text-purple-700 text-xs font-semibold rounded-full border border-purple-100">
              Ship.Docs sent {fmtDisplay(docs.shippingDocsMailSentAt)}
            </span>
          )}
        </div>
      )}

      {/* PDF downloads + packing/measurement list uploads */}
      <div className="space-y-3">
        {/* Standard generated docs */}
        <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
          <p className="w-full text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">Documents</p>
          <a href={`/api/sales/orders/${orderId}/invoice-pdf`} target="_blank"
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-100 transition">
            Commercial Invoice
          </a>
          <a href={`/api/sales/orders/${orderId}/packing-list-pdf`} target="_blank"
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              hasPackingList
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
            }`}>
            Packing List{hasPackingList ? " ✓ (uploaded)" : ""}
          </a>
          {hasMeasurementList && (
            <a href={`/api/sales/orders/${orderId}/measurement-list-pdf`} target="_blank"
              className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition">
              Measurement List ✓ (uploaded)
            </a>
          )}
          {allDocsReady ? (
            <a href={`/api/sales/orders/${orderId}/combined-pdf`} target="_blank"
              className="px-3 py-1.5 bg-brand text-white text-xs font-semibold rounded-lg hover:bg-brand-dark transition">
              Combined PDF (Invoice + PL + DML)
            </a>
          ) : (
            <span
              title={`Missing: ${[
                !hasInvoice && "Invoice (needs an Accepted PI)",
                !hasPackingList && "Packing List upload",
                !hasMeasurementList && "Measurement List upload",
              ].filter(Boolean).join(", ")}`}
              className="px-3 py-1.5 bg-brand text-white text-xs font-semibold rounded-lg opacity-40 cursor-not-allowed select-none">
              Combined PDF (Invoice + PL + DML)
            </span>
          )}
          <a href={`/api/sales/orders/${orderId}/stuffing-list-pdf`} target="_blank"
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-100 transition">
            Stuffing List
          </a>
        </div>

        {/* Packing list upload */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-2">Upload Custom Documents</p>
          <p className="text-xs text-slate-400 mb-3">
            Upload your own packing list / measurement list PDFs. The uploaded file will be served instead of the auto-generated one.
          </p>
          <div className="space-y-2">
            {/* Packing List upload row */}
            <div className="flex items-center gap-3 p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-xs font-medium text-slate-600 w-44 shrink-0">Packing List (PL)</span>
              {hasPackingList ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs text-green-700 font-semibold">Uploaded ✓</span>
                  <a href={`/api/sales/orders/${orderId}/packing-list-pdf`} target="_blank"
                    className="text-xs text-blue-600 hover:underline">View</a>
                  <button type="button" onClick={clearPackingList} disabled={plUploading}
                    className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium shrink-0 disabled:opacity-50">
                    {plUploading ? "Removing..." : "Remove"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-slate-400">Auto-generated from packages</span>
                  <button type="button" onClick={() => plRef.current?.click()} disabled={plUploading}
                    className="ml-auto px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition shrink-0 disabled:opacity-50">
                    {plUploading ? "Uploading..." : "Upload PDF"}
                  </button>
                  <input ref={plRef} type="file" accept="application/pdf" className="hidden"
                    onChange={handlePackingListUpload} />
                </div>
              )}
            </div>

            {/* Measurement List upload row */}
            <div className="flex items-center gap-3 p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-xs font-medium text-slate-600 w-44 shrink-0">Measurement List (DML)</span>
              {hasMeasurementList ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs text-green-700 font-semibold">Uploaded ✓</span>
                  <a href={`/api/sales/orders/${orderId}/measurement-list-pdf`} target="_blank"
                    className="text-xs text-blue-600 hover:underline">View</a>
                  <button type="button" onClick={clearMeasurementList} disabled={mlUploading}
                    className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium shrink-0 disabled:opacity-50">
                    {mlUploading ? "Removing..." : "Remove"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-slate-400">Included in Combined PDF</span>
                  <button type="button" onClick={() => mlRef.current?.click()} disabled={mlUploading}
                    className="ml-auto px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition shrink-0 disabled:opacity-50">
                    {mlUploading ? "Uploading..." : "Upload PDF"}
                  </button>
                  <input ref={mlRef} type="file" accept="application/pdf" className="hidden"
                    onChange={handleMeasurementListUpload} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Per-item Net Weights — entered by Commercial for invoice / packing list */}
      {piItems.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Net Weight per Line Item (MT)</p>
          <p className="text-xs text-slate-400 mb-3">Enter the net weight for each item. These values appear in the Commercial Invoice and Packing List.</p>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 w-8">#</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Description / Colour</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500">Thickness</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500">Slabs</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500 w-32">Net Weight (MT)</th>
                </tr>
              </thead>
              <tbody>
                {piItems.map((item: any, idx: number) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 text-slate-700 font-medium">{item.colour || item.description || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{item.thickness || "—"}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{item.noOfSlabs ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number" min={0} step={0.001}
                        value={getItemNetWeight(idx)}
                        onChange={e => setItemNetWeight(idx, e.target.value)}
                        placeholder="0.000"
                        className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Container Details */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Container Details</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Container No."    value={form.containerNo ?? ""}    onChange={v => setF("containerNo", v)}    placeholder="MSBU 1095261" />
          <F label="Vessel Name"      value={form.vesselName ?? ""}      onChange={v => setF("vesselName", v)}      placeholder="Sree Hari Om" />
          <F label="Liner OTL No."   value={form.linerOtlNo ?? ""}     onChange={v => setF("linerOtlNo", v)}     placeholder="LG00661914" />
          <F label="E-Seal No."      value={form.eSealNo ?? ""}        onChange={v => setF("eSealNo", v)}        placeholder="ESST 0099 6569" />
          <F label="Vehicle No."     value={form.vehicleNo ?? ""}      onChange={v => setF("vehicleNo", v)}      placeholder="TN 52 K 2255" />
          <F label="Tracking Link"   value={form.trackingLink ?? ""}   onChange={v => setF("trackingLink", v)}   placeholder="https://track.cma-cgm.com/..." />
          <F label="Package Desc."   value={form.packageDescription ?? ""} onChange={v => setF("packageDescription", v)} placeholder="08 Wooden Crate(S) + 03 Sample Box" />
          <F label="Gross Weight (MT)" value={form.grossWeight != null ? String(form.grossWeight) : ""}
            onChange={v => setF("grossWeight" as any, v)} placeholder="27.00" type="number" />
          <F label="Net Weight (MT)"   value={form.netWeight != null ? String(form.netWeight) : ""}
            onChange={v => setF("netWeight" as any, v)} placeholder="26.50" type="number" />
        </div>
      </div>

      {/* Ports & Dates */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Ports &amp; Dates</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Port of Loading"   value={form.portOfLoading ?? ""}   onChange={v => setF("portOfLoading", v)}   placeholder="ENNORE PORT, INDIA" />
          <F label="Port of Discharge" value={form.portOfDischarge ?? ""} onChange={v => setF("portOfDischarge", v)} placeholder="PORT EVERGLADES, FL" />
          <F label="ETD Date"          value={fmt(form.etdDate)}          onChange={v => setF("etdDate", v)}          type="date" />
          <F label="ETA Date"          value={fmt(form.etaDate)}          onChange={v => setF("etaDate", v)}          type="date" />
          <F label="BL Date"           value={fmt(form.blDate)}           onChange={v => setF("blDate", v)}           type="date" />
          <F label="Payment Due Date"  value={fmt(form.paymentDueDate)}   onChange={v => setF("paymentDueDate", v)}   type="date" />
        </div>
      </div>

      {/* BL / SB */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Shipping Bill &amp; BL</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="BL No."  value={form.blNo ?? ""}  onChange={v => setF("blNo", v)}  placeholder="HLCUBOM260504401" />
          <F label="SB No."  value={form.sbNo ?? ""}  onChange={v => setF("sbNo", v)}  placeholder="8574291" />
        </div>
      </div>

      {/* Document PDFs */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Document Attachments</p>
        <p className="text-xs text-slate-400 mb-3">Uploaded PDFs are attached to the shipping docs email.</p>
        <div className="space-y-2">
          <PdfUploadRow
            label="BL Document"
            file={blDocFile}
            onUpload={e => handlePdfUpload(e, setBlDocFile)}
            onClear={() => { setBlDocFile(null); setForm(f => ({ ...f, blDocUrl: null })); }}
          />
          <PdfUploadRow
            label="Fumigation Certificate"
            file={fumigationFile}
            onUpload={e => handlePdfUpload(e, setFumigationFile)}
            onClear={() => { setFumigationFile(null); setForm(f => ({ ...f, fumigationCertUrl: null })); }}
          />
          <PdfUploadRow
            label="Bank / Account Details"
            file={bankDetailsFile}
            onUpload={e => handlePdfUpload(e, setBankDetailsFile)}
            onClear={() => { setBankDetailsFile(null); setForm(f => ({ ...f, bankDetailsUrl: null })); }}
          />
        </div>
      </div>

      {/* Stuffing Photos */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          Stuffing Photos ({photos.length})
        </p>
        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {photos.map((p, i) => (
              <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.filename} className="w-full h-20 object-cover" />
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  x
                </button>
                <p className="text-[9px] text-slate-500 truncate px-1 py-0.5 bg-white">{p.filename}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoUpload}
            className="hidden"
            id={`photo-upload-${orderId}`}
          />
          <label htmlFor={`photo-upload-${orderId}`}
            className="cursor-pointer px-4 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition">
            {uploading ? "Processing..." : "+ Add Photos"}
          </label>
          {photos.length > 0 && (
            <button onClick={() => setPhotos([])} className="text-xs text-red-500 hover:underline">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition">
          {saving ? "Saving..." : "Save Shipping Docs"}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {/* Email Actions */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Send Emails</p>

        {/* Dispatch / Stuffing email */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Dispatch / Stuffing Email</p>
              <p className="text-xs text-slate-500">
                Sends combined PDF + stuffing table to customer. Use immediately after container is stuffed.
                {docs.stuffingMailSentAt && (
                  <span className="ml-2 text-teal-600 font-medium">
                    Last sent: {fmtDisplay(docs.stuffingMailSentAt)}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={sendDispatchEmail}
              disabled={dispatchSending}
              className="shrink-0 px-4 py-2 text-xs font-bold bg-brand text-white rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
              {dispatchSending ? "Sending..." : dispatchSent ? "Sent!" : "Send Dispatch Email"}
            </button>
          </div>
          {dispatchError && <p className="text-xs text-red-500">{dispatchError}</p>}
        </div>

        <div className="border-t border-slate-200" />

        {/* Shipping Docs email */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Shipping Documents Email</p>
              <p className="text-xs text-slate-500">
                {!docs.blNo           && <span className="text-amber-600 ml-1">Set BL No.</span>}
                {docs.blNo && !hasBlPdf       && <span className="text-amber-600 ml-1">Upload BL PDF</span>}
                {docs.blNo && !hasFumigation  && <span className="text-amber-600 ml-1">Upload Fumigation PDF</span>}
                {docs.blNo && !hasBankDetails && <span className="text-amber-600 ml-1">Upload Bank Details PDF</span>}
                {shippingDocsReady && <span className="text-green-600 ml-1 font-medium">All docs ready</span>}
                {docs.shippingDocsMailSentAt && (
                  <span className="ml-2 text-purple-600 font-medium">
                    Last sent: {fmtDisplay(docs.shippingDocsMailSentAt)}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={sendShippingDocsEmail}
              disabled={shippingSending || !docs.blNo}
              className="shrink-0 px-4 py-2 text-xs font-bold bg-brand text-white rounded-lg hover:bg-brand-dark disabled:opacity-50 transition">
              {shippingSending ? "Sending..." : shippingSent ? "Sent!" : "Send Shipping Docs"}
            </button>
          </div>
          {shippingError && <p className="text-xs text-red-500">{shippingError}</p>}
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      />
    </div>
  );
}

function PdfUploadRow({ label, file, onUpload, onClear }: {
  label:    string;
  file:     { name: string; data: string } | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear:  () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 p-2.5 bg-white border border-slate-200 rounded-lg">
      <span className="text-xs font-medium text-slate-600 w-44 shrink-0">{label}</span>
      {file ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-green-700 font-semibold">PDF Uploaded</span>
          <span className="text-xs text-slate-400 truncate">({file.name})</span>
          <button type="button" onClick={onClear}
            className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium shrink-0">
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-slate-400">No PDF uploaded</span>
          <button type="button" onClick={() => ref.current?.click()}
            className="ml-auto px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition shrink-0">
            Upload PDF
          </button>
          <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={onUpload} />
        </div>
      )}
    </div>
  );
}
