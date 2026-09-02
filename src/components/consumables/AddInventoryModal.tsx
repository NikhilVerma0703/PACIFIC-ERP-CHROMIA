// "use client";

// import { useState } from "react";
// import { useToast } from "@/components/consumables/toast-context";

// interface Props {
//   isOpen: boolean;
//   onClose: () => void;
//   onSuccess?: () => void;
// }

// const CATEGORY_OPTIONS = [
//   { label: "Direct Material",        value: "DIRECT_MATERIAL" },
//   { label: "Production Consumable",  value: "PRODUCTION_CONSUMABLE" },
//   { label: "Polishing Consumable",   value: "POLISHING_CONSUMABLE" },
// ];

// const labelCls = "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5";
// const inputCls =
//   "w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white placeholder-gray-400 " +
//   "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-colors";
// const selectCls =
//   "w-full appearance-none border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white " +
//   "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-colors pr-9 cursor-pointer";

// function ChevronIcon() {
//   return (
//     <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
//       fill="none" stroke="currentColor" viewBox="0 0 24 24">
//       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
//     </svg>
//   );
// }

// export default function AddInventoryModal({ isOpen, onClose, onSuccess }: Props) {
//   const { showToast } = useToast();
//   const [form, setForm] = useState({
//     itemName: "", category: "", unit: "", currentStock: "", minStock: "",
//   });
//   const [saving, setSaving] = useState(false);
//   const [error, setError]   = useState("");

//   if (!isOpen) return null;

//   const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
//     setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
//     setError("");
//   };

//   const handleSubmit = async () => {
//     if (!form.itemName || !form.category || !form.unit || !form.currentStock) {
//       setError("Please fill in all required fields.");
//       return;
//     }
//     setSaving(true);
//     setError("");
//     try {
//       const res = await fetch("/api/consumables/inventory", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(form),
//       });
//       if (!res.ok) throw new Error("Failed to save");
//       const savedName = form.itemName;
//       setForm({ itemName: "", category: "", unit: "", currentStock: "", minStock: "" });
//       onSuccess?.();
//       onClose();
//       showToast(`"${savedName}" added to inventory!`, "success");
//     } catch {
//       setError("Something went wrong. Please try again.");
//       showToast("Failed to add inventory.", "error");
//     } finally {
//       setSaving(false);
//     }
//   };

//   return (
//     <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
//       <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">

//         {/* Accent bar — blue for inventory */}
//         <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-500" />

//         {/* Header */}
//         <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
//           <div>
//             <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Inventory</p>
//             <h2 className="text-xl font-bold text-gray-800 mt-0.5">Add Inventory Item</h2>
//             <p className="text-sm text-gray-400 mt-1">Create a new item in the inventory stock register</p>
//           </div>
//           <button onClick={onClose}
//             className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0 mt-0.5">
//             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
//             </svg>
//           </button>
//         </div>

//         {/* Form */}
//         <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">

//           {/* Item Name */}
//           <div className="md:col-span-2">
//             <label className={labelCls}>Item Name <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="itemName" type="text" placeholder="e.g. Soap Oil, Gloves, PVA Roll"
//               value={form.itemName} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           {/* Category */}
//           <div>
//             <label className={labelCls}>Category <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <div className="relative">
//               <select name="category" value={form.category} onChange={handleChange} className={selectCls}>
//                 <option value="">Select category…</option>
//                 {CATEGORY_OPTIONS.map((opt) => (
//                   <option key={opt.value} value={opt.value}>{opt.label}</option>
//                 ))}
//               </select>
//               <ChevronIcon />
//             </div>
//           </div>

//           {/* Unit */}
//           <div>
//             <label className={labelCls}>Unit <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="unit" type="text" placeholder="e.g. KG, PCS, Set, Litre"
//               value={form.unit} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           {/* Current Stock */}
//           <div>
//             <label className={labelCls}>Current Stock <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="currentStock" type="number" placeholder="0" min="0" step="0.01"
//               value={form.currentStock} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           {/* Min Stock */}
//           <div>
//             <label className={labelCls}>
//               Minimum Stock
//               <span className="ml-1.5 text-gray-300 normal-case tracking-normal font-normal">(optional)</span>
//             </label>
//             <input
//               name="minStock" type="number" placeholder="0" min="0" step="0.01"
//               value={form.minStock} onChange={handleChange} className={inputCls}
//             />
//             <p className="text-xs text-gray-400 mt-1.5">
//               Alert threshold — shown as "Low" when stock falls below this value
//             </p>
//           </div>
//         </div>

//         {/* Error */}
//         {error && (
//           <div className="mx-6 mb-4 flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
//             <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
//                 d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
//             </svg>
//             <p className="text-sm text-red-700 font-medium">{error}</p>
//           </div>
//         )}

//         {/* Footer */}
//         <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
//           <p className="text-xs text-gray-400">
//             <span className="text-red-400">*</span> Required fields
//           </p>
//           <div className="flex items-center gap-3">
//             <button onClick={onClose}
//               className="px-4 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
//               Cancel
//             </button>
//             <button onClick={handleSubmit} disabled={saving}
//               className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors">
//               {saving ? (
//                 <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
//                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
//                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
//                 </svg>
//               ) : (
//                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
//                     d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
//                 </svg>
//               )}
//               {saving ? "Saving…" : "Add to Inventory"}
//             </button>
//           </div>
//         </div>

//       </div>
//     </div>
//   );
// }


"use client";

import { useEffect, useState } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";
import { useToast } from "@/components/consumables/toast-context";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/** Only the three fields this modal needs off /api/consumables/inventory. */
interface StockRow {
  id: string;
  itemName: string;
  unit: string;
  currentStock: number;
}

const CATEGORY_OPTIONS = [
  {
    label: "Direct Materials",
    value: "DIRECT_MATERIAL",
  },
  {
    label: "Production Consumables",
    value: "PRODUCTION_CONSUMABLE",
  },
  {
    label: "Polishing Consumables",
    value: "POLISHING_CONSUMABLE",
  },
];

const INVENTORY_ITEMS = {
  DIRECT_MATERIAL: [
    "Quartz Grit : A&A Silicates 0.1-0.4MM (PM)",
    "Quartz Grit : Phenikaa Cristobalite 0.1-0.4MM",
    "Quartz Powder : A&A Silicates 400# (PM)",
    "Resin : Orson",
    "Resin : Ineos",
    "Catalyst : Catalyst 93",
    "Catalyst : Catalyst S21",
    "Catalyst : Catalyst Ambani",
    "Cobalt : Cobalt Ambani",
    "Cobalt : Cobalt Nouryon",
    "Silane",
    "TiO-2",
    "Pigment",
  ],

  PRODUCTION_CONSUMABLE: [
    "Moulds",
    "PVA Roll",
    "Glue Can",
    "Guard Sheets",
    "Gas",
    "Cotton Waste",
    "Acetone",
    "Gloves",
    "Coolant Oil",
    "Soap Oil",
    "Mask N95",
    "Ear Plug",
    "Scrapper",
    "Stationery Items",
    "Goggles",
  ],

  POLISHING_CONSUMABLE: [
    "Calibration",
    "Polishing",
    "Slab Repair + Sealant",
    "Musa Edge Polishing",
    "Hand Polishing",
  ],
};

const ITEM_UNITS: Record<string, string> = {
  "Quartz Grit : A&A Silicates 0.1-0.4MM (PM)": "KG",
  "Quartz Grit : Phenikaa Cristobalite 0.1-0.4MM": "KG",
  "Quartz Powder : A&A Silicates 400# (PM)": "KG",

  "Resin : Orson": "KG",
  "Resin : Ineos": "KG",

  "Catalyst : Catalyst 93": "KG",
  "Catalyst : Catalyst S21": "KG",
  "Catalyst : Catalyst Ambani": "KG",

  "Cobalt : Cobalt Ambani": "Can",
  "Cobalt : Cobalt Nouryon": "Can",

  Silane: "KG",
  "TiO-2": "KG",
  Pigment: "KG",

  Moulds: "PCS",
  "PVA Roll": "Roll",
  "Glue Can": "KG",
  "Guard Sheets": "PCS",
  Gas: "Cylinder",
  "Cotton Waste": "KG",
  Acetone: "KG",
  Gloves: "Set",
  "Coolant Oil": "Litre",
  "Soap Oil": "Litre",
  "Mask N95": "PCS",
  "Ear Plug": "PCS",
  Scrapper: "PCS",
  "Stationery Items": "Nos",
  Goggles: "Nos",

  Calibration: "PCS",
  Polishing: "PCS",
  "Slab Repair + Sealant": "PCS",
  "Musa Edge Polishing": "PCS",
  "Hand Polishing": "PCS",
};

const labelCls =
  "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-colors";

const selectCls =
  "w-full appearance-none border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-colors pr-9 cursor-pointer";

function ChevronIcon() {
  return (
    <svg
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

export default function AddInventoryModal({
  isOpen,
  onClose,
  onSuccess,
}: Props) {
  const { showToast } = useToast();

  const [form, setForm] = useState({
    itemName: "",
    category: "",
    unit: "",
    currentStock: "",
    minStock: "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // What is on the shelf right now, per item. The item name is a fixed
  // ~33-entry dropdown, so the item the clerk picks almost always exists
  // already and this form is a RECEIPT against it, not a creation. Without
  // the existing count on screen, "there are 100 gloves" got typed into a box
  // and added to the 140 already recorded.
  const [stock, setStock] = useState<StockRow[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/consumables/inventory").then(jsonOrThrow).then(setStock).catch(console.error);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (name === "category") {
      setForm((prev) => ({
        ...prev,
        category: value,
        itemName: "",
        unit: "",
      }));

      setError("");
      return;
    }

    if (name === "itemName") {
      setForm((prev) => ({
        ...prev,
        itemName: value,
        unit: ITEM_UNITS[value] || "",
      }));

      setError("");
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setError("");
  };

  const handleSubmit = async () => {
    if (
      !form.itemName ||
      !form.category ||
      !form.unit ||
      !form.currentStock
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/consumables/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const saved = await jsonOrThrow(res);

      setForm({
        itemName: "",
        category: "",
        unit: "",
        currentStock: "",
        minStock: "",
      });

      onSuccess?.();

      onClose();

      // Report the TOTAL the server came back with, not the number that was
      // typed. On an existing item the server tops up, so "added" next to the
      // received quantity read as "the shelf holds 100" when it now holds 240
      // — and an inflated shelf keeps the low-stock alert and the depletion
      // forecast green while the store room is empty.
      showToast(
        saved?.toppedUp
          ? `+${saved.received} ${saved.unit} received — ${saved.itemName} now at ${saved.currentStock} ${saved.unit}`
          : `"${saved.itemName}" created with ${saved.currentStock} ${saved.unit}`,
        "success"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";

      setError(msg);

      showToast(
        msg,
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const availableItems =
    form.category
      ? INVENTORY_ITEMS[
          form.category as keyof typeof INVENTORY_ITEMS
        ]
      : [];

  // Case-insensitive, because that is how the API decides whether this is a
  // top-up (findFirst with mode: "insensitive"). Matching more strictly here
  // would show "new item" for a row the server is about to add to.
  const existing = form.itemName
    ? stock.find(
        (s) =>
          s.itemName.toLowerCase() === form.itemName.toLowerCase()
      )
    : undefined;

  const received = Number(form.currentStock);

  // Blank is not zero here: with no quantity typed there is no "after" figure
  // to preview, and showing the unchanged count as a result reads like the
  // form has already done something.
  const newTotal =
    existing && form.currentStock !== "" && Number.isFinite(received)
      ? Math.round((existing.currentStock + received) * 100) / 100
      : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">

      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">

        {/* Accent Bar */}

        <div className="h-1 w-full bg-gradient-to-r from-blue-500 to-indigo-500" />

        {/* Header */}

        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">

          <div>

            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Inventory
            </p>

            <h2 className="text-xl font-bold text-gray-800 mt-0.5">
              Add Inventory Item
            </h2>

            <p className="text-sm text-gray-400 mt-1">
              Record stock received — an item already in the register is topped up
            </p>

          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0 mt-0.5"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>

          </button>

        </div>

        {/* Form */}

        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Category */}

          <div className="md:col-span-2">

            <label className={labelCls}>
              Category
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <div className="relative">

              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                className={selectCls}
              >

                <option value="">
                  Select Category...
                </option>

                {CATEGORY_OPTIONS.map((category) => (
                  <option
                    key={category.value}
                    value={category.value}
                  >
                    {category.label}
                  </option>
                ))}

              </select>

              <ChevronIcon />

            </div>

          </div>

          {/* Item Name */}

          <div>

            <label className={labelCls}>
              Item Name
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <div className="relative">

              <select
                name="itemName"
                value={form.itemName}
                onChange={handleChange}
                className={selectCls}
                disabled={!form.category}
              >

                <option value="">
                  {form.category
                    ? "Select Item..."
                    : "Select category first"}
                </option>

                {availableItems.map((item) => (
                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>
                ))}

              </select>

              <ChevronIcon />

            </div>

            {form.itemName && (
              existing ? (
                <p className="text-xs text-gray-500 mt-1.5">
                  Already in the register —{" "}
                  <span className="font-semibold text-gray-700">
                    {existing.currentStock} {existing.unit}
                  </span>{" "}
                  in stock. What you enter below is ADDED to that.
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1.5">
                  Not in the register yet — this will create it.
                </p>
              )
            )}

          </div>

          {/* Unit */}

          <div>

            <label className={labelCls}>
              Unit
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <input
              name="unit"
              value={form.unit}
              readOnly
              className={`${inputCls} bg-gray-50`}
            />

          </div>

                    {/* Quantity Received */}

          <div>
            {/* Labelled "Current Stock" until 2026-09, which is exactly the
                wrong word: the server ADDS this to whatever the item already
                holds. A clerk reading the label as "state the shelf count"
                typed 100 for an item at 140 and left it at 240. */}
            <label className={labelCls}>
              Quantity Received
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <input
              name="currentStock"
              type="number"
              placeholder="0"
              min="0"
              step="0.01"
              value={form.currentStock}
              onChange={handleChange}
              className={inputCls}
            />

            <p className="text-xs text-gray-400 mt-1.5">
              {newTotal !== null
                ? `Added to the existing count — the item will read ${newTotal} ${existing?.unit}.`
                : "How much arrived, not the shelf total."}
            </p>
          </div>

          {/* Minimum Stock */}

          <div>
            <label className={labelCls}>
              Minimum Stock
              <span className="ml-1.5 text-gray-300 normal-case tracking-normal font-normal">
                (optional)
              </span>
            </label>

            <input
              name="minStock"
              type="number"
              placeholder="0"
              min="0"
              step="0.01"
              value={form.minStock}
              onChange={handleChange}
              className={inputCls}
            />

            <p className="text-xs text-gray-400 mt-1.5">
              Alert threshold — shown as &quot;Low&quot; when stock falls below this
              value. Leave blank on an existing item to keep the threshold it
              already has.
            </p>
          </div>

          {/* Inventory Preview */}

          {form.itemName && (
            <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">

              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Inventory Preview
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">

                <div>
                  <p className="text-xs text-gray-500">
                    Category
                  </p>

                  <p className="font-semibold text-gray-800">
                    {
                      CATEGORY_OPTIONS.find(
                        (c) => c.value === form.category
                      )?.label
                    }
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    Item
                  </p>

                  <p className="font-semibold text-gray-800">
                    {form.itemName}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500">
                    Unit
                  </p>

                  <p className="font-semibold text-blue-700">
                    {form.unit}
                  </p>
                </div>

              </div>

              {/* The before/after line. This modal writes a top-up, so the only
                  number worth checking before saving is the one the shelf will
                  read afterwards. */}
              {existing && (
                <p className="text-xs text-blue-700 mt-3">
                  In stock now{" "}
                  <span className="font-semibold">
                    {existing.currentStock} {existing.unit}
                  </span>
                  {newTotal !== null && (
                    <>
                      {" "}→ after this receipt{" "}
                      <span className="font-semibold">
                        {newTotal} {existing.unit}
                      </span>
                    </>
                  )}
                </p>
              )}

            </div>
          )}

        </div>

        {/* Error */}

        {error && (

          <div className="mx-6 mb-4 flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">

            <svg
              className="w-4 h-4 text-red-500 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >

              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />

            </svg>

            <p className="text-sm text-red-700 font-medium">
              {error}
            </p>

          </div>

        )}

        {/* Footer */}

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">

          <p className="text-xs text-gray-400">
            <span className="text-red-400">*</span> Required fields
          </p>

          <div className="flex items-center gap-3">

            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >

              {saving ? (

                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >

                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />

                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />

                </svg>

              ) : (

                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >

                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />

                </svg>

              )}

              {saving ? "Saving…" : "Add to Inventory"}

            </button>

          </div>

        </div>

              </div>
    </div>
  );
}