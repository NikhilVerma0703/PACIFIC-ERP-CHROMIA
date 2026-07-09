// "use client";

// import { useState } from "react";
// import { useToast } from "@/components/consumables/toast-context";

// interface Props {
//   isOpen: boolean;
//   onClose: () => void;
//   onSuccess?: () => void;
// }

// const labelCls = "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5";
// const inputCls =
//   "w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white placeholder-gray-400 " +
//   "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-colors";

// export default function AddFilmRollModal({ isOpen, onClose, onSuccess }: Props) {
//   const { showToast } = useToast();
//   const [form, setForm] = useState({
//     rollNumber: "", filmType: "", machine: "",
//     initialWeight: "", weightPerLayer: "", layersUsed: "0",
//   });
//   const [saving, setSaving] = useState(false);
//   const [error, setError]   = useState("");

//   if (!isOpen) return null;

//   const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
//     setError("");
//   };

//   const handleSubmit = async () => {
//     if (!form.rollNumber || !form.filmType || !form.machine || !form.initialWeight || !form.weightPerLayer) {
//       setError("Please fill in all required fields.");
//       return;
//     }
//     setSaving(true);
//     setError("");
//     try {
//       const res = await fetch("/api/consumables/film-rolls", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           rollNumber:     form.rollNumber,
//           filmType:       form.filmType,
//           machine:        form.machine,
//           initialWeight:  parseFloat(form.initialWeight),
//           weightPerLayer: parseFloat(form.weightPerLayer),
//           layersUsed:     parseInt(form.layersUsed) || 0,
//         }),
//       });
//       if (!res.ok) {
//         const err = await res.json();
//         throw new Error(err?.error || "Failed to save");
//       }
//       const savedRoll = form.rollNumber;
//       setForm({ rollNumber: "", filmType: "", machine: "", initialWeight: "", weightPerLayer: "", layersUsed: "0" });
//       onSuccess?.();
//       onClose();
//       showToast(`Film Roll ${savedRoll} added successfully!`, "success");
//     } catch (e: unknown) {
//       const msg = e instanceof Error ? e.message : "Something went wrong.";
//       setError(msg.includes("Unique") ? "Roll number already exists." : msg);
//       showToast("Failed to add film roll.", "error");
//     } finally {
//       setSaving(false);
//     }
//   };

//   const maxLayers =
//     form.initialWeight && form.weightPerLayer
//       ? Math.floor(parseFloat(form.initialWeight) / parseFloat(form.weightPerLayer))
//       : null;

//   return (
//     <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
//       <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

//         {/* Accent bar — amber/orange for film tracking */}
//         <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-400" />

//         {/* Header */}
//         <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
//           <div>
//             <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Film Roll</p>
//             <h2 className="text-xl font-bold text-gray-800 mt-0.5">Add Film Roll</h2>
//             <p className="text-sm text-gray-400 mt-1">Register a new roll for production tracking</p>
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

//           <div>
//             <label className={labelCls}>Roll Number <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="rollNumber" type="text" placeholder="e.g. FILM005"
//               value={form.rollNumber} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           <div>
//             <label className={labelCls}>Film Type <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="filmType" type="text" placeholder="e.g. BOPP, PVC, PE"
//               value={form.filmType} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           <div className="md:col-span-2">
//             <label className={labelCls}>Machine <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="machine" type="text" placeholder="e.g. Mixer Unloading Cabin"
//               value={form.machine} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           <div>
//             <label className={labelCls}>Initial Weight (KG) <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="initialWeight" type="number" placeholder="e.g. 500" min="0" step="0.01"
//               value={form.initialWeight} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           <div>
//             <label className={labelCls}>Weight Per Layer (KG) <span className="text-red-400 normal-case tracking-normal">*</span></label>
//             <input
//               name="weightPerLayer" type="number" placeholder="e.g. 2.5" min="0" step="0.001"
//               value={form.weightPerLayer} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           <div>
//             <label className={labelCls}>
//               Starting Layers Used
//               <span className="ml-1.5 text-gray-300 normal-case tracking-normal font-normal">(optional)</span>
//             </label>
//             <input
//               name="layersUsed" type="number" placeholder="0" min="0"
//               value={form.layersUsed} onChange={handleChange} className={inputCls}
//             />
//           </div>

//           {/* Live preview */}
//           {maxLayers !== null && (
//             <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
//               <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
//                   d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
//               </svg>
//               <div>
//                 <p className="text-xs font-semibold text-amber-700">Roll Preview</p>
//                 <p className="text-sm text-amber-600 mt-0.5">
//                   Max <strong>{maxLayers}</strong> layers from {form.initialWeight} KG at {form.weightPerLayer} KG/layer
//                 </p>
//               </div>
//             </div>
//           )}
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
//               className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors">
//               {saving ? (
//                 <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
//                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
//                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
//                 </svg>
//               ) : (
//                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
//                 </svg>
//               )}
//               {saving ? "Adding…" : "Add Film Roll"}
//             </button>
//           </div>
//         </div>


// </div>
//  </div>
//   );
//  }


"use client";

import { useState } from "react";
import { useToast } from "@/components/consumables/toast-context";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const labelCls =
  "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm bg-white placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-colors";

const FILM_TYPES = [
  "Adhesive",
  "Pet Coil",
  "Antistatic Film",
];

const MACHINES = [
  "Mixer Unloading Cabin",
  "Horizontal Belt",
  "Ring Loading Belt",
  "Inclined Belt-1",
  "Inclined Belt-2",
  "Mobile Belt",
  "Crusher Loading Hopper",
  "Crusher Loading Belt",
  "Distributor Loading Belt",
  "Distributor Loading Hopper",
  "Distributor Belt",
  "ROY Mixer Unloading Belt",
];

export default function AddFilmRollModal({
  isOpen,
  onClose,
  onSuccess,
}: Props) {
  const { showToast } = useToast();

  const [form, setForm] = useState({
    rollNumber: "",
    filmType: "",
    machine: "",
    initialWeight: "",
    weightPerLayer: "",
    layersUsed: "0",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setError("");
  };

  const handleSubmit = async () => {
    if (
      !form.rollNumber ||
      !form.filmType ||
      !form.machine ||
      !form.initialWeight ||
      !form.weightPerLayer
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/consumables/film-rolls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rollNumber: form.rollNumber,
          filmType: form.filmType,
          machine: form.machine,
          initialWeight: parseFloat(form.initialWeight),
          weightPerLayer: parseFloat(form.weightPerLayer),
          layersUsed: parseInt(form.layersUsed) || 0,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || "Failed to save");
      }

      const savedRoll = form.rollNumber;

      setForm({
        rollNumber: "",
        filmType: "",
        machine: "",
        initialWeight: "",
        weightPerLayer: "",
        layersUsed: "0",
      });

      onSuccess?.();
      onClose();

      showToast(`Film Roll ${savedRoll} added successfully!`, "success");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Something went wrong.";

      setError(
        msg.includes("Unique")
          ? "Roll number already exists."
          : msg
      );

      showToast("Failed to add film roll.", "error");
    } finally {
      setSaving(false);
    }
  };

  const maxLayers =
    form.initialWeight && form.weightPerLayer
      ? Math.floor(
          parseFloat(form.initialWeight) /
            parseFloat(form.weightPerLayer)
        )
      : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-400" />

        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Film Roll
            </p>

            <h2 className="text-xl font-bold text-gray-800 mt-0.5">
              Add Film Roll
            </h2>

            <p className="text-sm text-gray-400 mt-1">
              Register a new roll for production tracking
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

        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-5">

          <div>
            <label className={labelCls}>
              Roll Number{" "}
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <input
              name="rollNumber"
              type="text"
              placeholder="e.g. FILM005"
              value={form.rollNumber}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Film Type{" "}
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <select
              name="filmType"
              value={form.filmType}
              onChange={handleChange}
              className={inputCls}
            >
              <option value="">Select Film Type</option>

              {FILM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>
              Machine{" "}
              <span className="text-red-400 normal-case tracking-normal">
                *
              </span>
            </label>

            <select
              name="machine"
              value={form.machine}
              onChange={handleChange}
              className={inputCls}
            >
              <option value="">Select Machine</option>

              {MACHINES.map((machine) => (
                <option key={machine} value={machine}>
                  {machine}
                </option>
              ))}
            </select>
          </div>
                    <div>
            <label className={labelCls}>
              Initial Weight (KG)
              <span className="text-red-400 normal-case tracking-normal">*</span>
            </label>

            <input
              name="initialWeight"
              type="number"
              placeholder="e.g. 500"
              min="0"
              step="0.01"
              value={form.initialWeight}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Weight Per Layer (KG)
              <span className="text-red-400 normal-case tracking-normal">*</span>
            </label>

            <input
              name="weightPerLayer"
              type="number"
              placeholder="e.g. 2.5"
              min="0"
              step="0.001"
              value={form.weightPerLayer}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              Starting Layers Used
              <span className="ml-1.5 text-gray-300 normal-case tracking-normal font-normal">
                (optional)
              </span>
            </label>

            <input
              name="layersUsed"
              type="number"
              placeholder="0"
              min="0"
              value={form.layersUsed}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          {maxLayers !== null && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <svg
                className="w-5 h-5 text-amber-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>

              <div>
                <p className="text-xs font-semibold text-amber-700">
                  Roll Preview
                </p>

                <p className="text-sm text-amber-600 mt-0.5">
                  Max <strong>{maxLayers}</strong> layers from{" "}
                  {form.initialWeight} KG at {form.weightPerLayer} KG/layer
                </p>
              </div>
            </div>
          )}
        </div>

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
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
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
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              )}

              {saving ? "Adding…" : "Add Film Roll"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}