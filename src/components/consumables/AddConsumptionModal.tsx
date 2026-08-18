"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/consumables/toast-context";

interface Department  { id: string; name: string; }
interface InventoryItem { id: string; itemName: string; unit: string; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const labelCls = "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5";
const inputCls =
  "w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-colors";
const selectWrap = "relative";
const selectCls =
  "w-full appearance-none border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 transition-colors pr-9 cursor-pointer";

function ChevronIcon() {
  return (
    <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
      fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export default function AddConsumptionModal({ isOpen, onClose, onSuccess }: Props) {
  const { showToast }               = useToast();
  const [departments, setDepartments]       = useState<Department[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState({
    departmentId: "", inventoryStockId: "",
    itemName: "", quantity: "", unit: "", remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/consumables/departments").then((r) => r.json()).then(setDepartments).catch(console.error);
    fetch("/api/consumables/inventory").then((r) => r.json()).then(setInventoryItems).catch(console.error);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    if (name === "inventoryStockId") {
      const selected = inventoryItems.find((i) => i.id === value);
      setForm((prev) => ({
        ...prev,
        inventoryStockId: value,
        itemName: selected?.itemName ?? prev.itemName,
        unit:     selected?.unit     ?? prev.unit,
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
    setError("");
  };

  const handleSubmit = async () => {
    if (!form.departmentId || !form.itemName || !form.quantity || !form.unit) {
      setError("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/consumables/consumption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to save");
      const savedName = form.itemName;
      setForm({ departmentId: "", inventoryStockId: "", itemName: "", quantity: "", unit: "", remarks: "" });
      onSuccess?.();
      onClose();
      showToast(`Consumption entry for "${savedName}" saved!`, "success");
    } catch {
      setError("Something went wrong. Please try again.");
      showToast("Failed to save consumption entry.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">

        {/* Accent bar — green for consumption */}
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-400" />

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Consumption</p>
            <h2 className="text-xl font-bold text-gray-800 mt-0.5">Add Consumption Entry</h2>
            <p className="text-sm text-gray-400 mt-1">Record materials consumed by a department</p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0 mt-0.5">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Department */}
          <div>
            <label className={labelCls}>Department <span className="text-red-400 normal-case tracking-normal">*</span></label>
            <div className={selectWrap}>
              <select name="departmentId" value={form.departmentId} onChange={handleChange} className={selectCls}>
                <option value="">Select department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </div>

          {/* Link to inventory item */}
          <div>
            <label className={labelCls}>
              Link to Inventory Item
              <span className="ml-1.5 text-gray-300 normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <div className={selectWrap}>
              <select name="inventoryStockId" value={form.inventoryStockId} onChange={handleChange} className={selectCls}>
                <option value="">None — enter manually</option>
                {inventoryItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.itemName}</option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </div>

          {/* Item Name */}
          <div>
            <label className={labelCls}>Item Name <span className="text-red-400 normal-case tracking-normal">*</span></label>
            <input
              name="itemName" type="text" placeholder="e.g. Gloves"
              value={form.itemName} onChange={handleChange} className={inputCls}
            />
          </div>

          {/* Quantity */}
          <div>
            <label className={labelCls}>Quantity <span className="text-red-400 normal-case tracking-normal">*</span></label>
            <input
              name="quantity" type="number" placeholder="e.g. 100" min="0"
              value={form.quantity} onChange={handleChange} className={inputCls}
            />
          </div>

          {/* Unit */}
          <div>
            <label className={labelCls}>Unit <span className="text-red-400 normal-case tracking-normal">*</span></label>
            <input
              name="unit" type="text" placeholder="e.g. KG, PCS, Set"
              value={form.unit} onChange={handleChange} className={inputCls}
            />
          </div>

          {/* Remarks */}
          <div className="md:col-span-2">
            <label className={labelCls}>Remarks <span className="text-gray-300 normal-case tracking-normal font-normal">(optional)</span></label>
            <textarea
              name="remarks" placeholder="Any notes about this consumption…"
              rows={2} value={form.remarks} onChange={handleChange}
              className={inputCls + " resize-none"}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <p className="text-sm text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            <span className="text-red-400">*</span> Required fields
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-4 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors">
              {saving ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              )}
              {saving ? "Saving…" : "Save Consumption"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
