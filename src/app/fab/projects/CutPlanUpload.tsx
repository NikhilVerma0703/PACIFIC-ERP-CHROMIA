// RETIRED 2026-08 -- superseded fabrication intake.
//
// The manager-side uploader for the CLO Optimizer round-trip: it posted the slab
// allocation workbook to POST /api/fab/apply-slab-excel (and, in an earlier form, a
// scanned cut plan to /api/fab/parse-cutplan). Both endpoints are retired with it.
//
// Replaced mid-2026 by the supervisor slab screen at /fab/supervisor/slabs, which
// allocates pieces to slabs inside the app. Its only mount point was
// /fab/projects/[id], where the block that rendered it is commented out too.
//
// HOW THIS IS RETIRED. The whole module is commented out rather than deleted, per
// the owner's instruction. The `export {}` below is the only live statement: with
// isolatedModules on, a file with no import or export is a global script, not a
// module, and tsc refuses it (TS1208). Nothing imports this file any more.

export {};

/* ---- original implementation, retired 2026-08 -------------------------- */
// "use client";
// import { useState } from "react";
//
// interface AppliedEntry { label: string; slabCode: string; qty: number; }
// interface ApplyResult  {
//   applied:     number;
//   appliedList: AppliedEntry[];
//   unmatched:   string[];
// }
//
// function PreviewTable({ rows }: { rows: { slab: string; label: string; qty: number }[] }) {
//   if (!rows.length) return <p className="text-xs text-gray-400 italic">No rows detected</p>;
//   return (
//     <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100 bg-white">
//       <table className="w-full text-xs">
//         <thead className="bg-gray-50 sticky top-0">
//           <tr>
//             <th className="text-left px-2.5 py-1.5 text-gray-400 font-semibold">Slab</th>
//             <th className="text-left px-2.5 py-1.5 text-gray-400 font-semibold">Serial</th>
//             <th className="text-center px-2.5 py-1.5 text-gray-400 font-semibold">Qty</th>
//           </tr>
//         </thead>
//         <tbody className="divide-y divide-gray-50">
//           {rows.map((r, i) => (
//             <tr key={i} className="hover:bg-gray-50">
//               <td className="px-2.5 py-1 text-gray-500 font-mono text-[10px]">{r.slab}</td>
//               <td className="px-2.5 py-1 font-mono font-bold text-gray-800">{r.label}</td>
//               <td className="px-2.5 py-1 text-center text-gray-500">x{r.qty}</td>
//             </tr>
//           ))}
//         </tbody>
//       </table>
//     </div>
//   );
// }
//
// function ExcelPanel({
//   thickness, colour,
//   rows, uploading, parseError,
//   onFile, onDiscard,
// }: {
//   thickness: "2cm" | "3cm";
//   colour: string;
//   rows: { slab: string; label: string; qty: number }[] | null;
//   uploading: boolean;
//   parseError: string;
//   onFile: (f: File) => void;
//   onDiscard: () => void;
// }) {
//   const slabCount  = rows ? new Set(rows.map((r) => r.slab)).size : 0;
//   const labelCount = rows?.length ?? 0;
//
//   return (
//     <div className={`flex-1 min-w-0 border rounded-xl p-4 ${colour}`}>
//       <div className="flex items-center justify-between mb-3">
//         <span className="text-sm font-bold text-gray-800">{thickness} Allocation Excel</span>
//         {!rows && (
//           <label className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-dashed text-xs font-medium transition
//             ${uploading
//               ? "border-blue-300 bg-blue-50 text-blue-400 cursor-wait"
//               : "border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600"}`}>
//             {uploading ? "Reading..." : "Upload Excel"}
//             <input type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading}
//               onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
//           </label>
//         )}
//       </div>
//
//       {uploading && (
//         <div className="flex items-center gap-2 text-xs text-blue-600 py-1">
//           <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
//             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
//             <path className="opacity-75" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
//           </svg>
//           Parsing...
//         </div>
//       )}
//
//       {parseError && (
//         <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{parseError}</p>
//       )}
//
//       {!rows && !uploading && !parseError && (
//         <p className="text-xs text-gray-400 italic">
//           Upload the Excel Claude gave you from the {thickness} CLO PDF
//         </p>
//       )}
//
//       {rows && (
//         <div className="space-y-2">
//           <p className="text-xs font-semibold text-gray-700">
//             {slabCount} slab{slabCount !== 1 ? "s" : ""} &middot; {labelCount} piece{labelCount !== 1 ? "s" : ""}
//           </p>
//           <PreviewTable rows={rows} />
//           <button onClick={onDiscard}
//             className="text-xs text-gray-400 hover:text-gray-600 underline transition">
//             Discard
//           </button>
//         </div>
//       )}
//     </div>
//   );
// }
//
// async function clientParseExcel(file: File): Promise<{ slab: string; label: string; qty: number }[]> {
//   const XLSX    = await import("xlsx");
//   const ab      = await file.arrayBuffer();
//   const wb      = XLSX.read(ab, { type: "array" });
//   const ws      = wb.Sheets[wb.SheetNames[0]];
//   const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
//
//   if (rawRows.length < 2) return [];
//
//   let headerIdx = 0;
//   for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
//     if (rawRows[i].filter((c: string) => String(c).trim()).length >= 2) { headerIdx = i; break; }
//   }
//
//   const headers  = rawRows[headerIdx].map((h) => String(h).toLowerCase().trim());
//   const slabCol  = headers.findIndex((h) => /slab|sheet|stock/.test(h));
//   const labelCol = headers.findIndex((h) => /label|serial|piece|id/.test(h));
//   const qtyCol   = headers.findIndex((h) => /qty|quantity|count/.test(h));
//
//   const out: { slab: string; label: string; qty: number }[] = [];
//   for (const row of rawRows.slice(headerIdx + 1)) {
//     const slab  = slabCol  >= 0 ? String(row[slabCol]  ?? "").trim() : "";
//     const label = labelCol >= 0 ? String(row[labelCol] ?? "").trim() : "";
//     const qty   = qtyCol   >= 0 ? parseInt(String(row[qtyCol]  ?? "1")) || 1 : 1;
//     if (slab && label) out.push({ slab, label, qty });
//   }
//   return out;
// }
//
// export function CutPlanUpload({ projectId }: { projectId: string }) {
//   const [rows2,    setRows2]    = useState<{ slab: string; label: string; qty: number }[] | null>(null);
//   const [rows3,    setRows3]    = useState<{ slab: string; label: string; qty: number }[] | null>(null);
//   const [file2,    setFile2]    = useState<File | null>(null);
//   const [file3,    setFile3]    = useState<File | null>(null);
//   const [up2,      setUp2]      = useState(false);
//   const [up3,      setUp3]      = useState(false);
//   const [err2,     setErr2]     = useState("");
//   const [err3,     setErr3]     = useState("");
//   const [applying, setApplying] = useState(false);
//   const [result,   setResult]   = useState<ApplyResult | null>(null);
//   const [applyErr, setApplyErr] = useState("");
//
//   async function handleFile(file: File, thickness: "2cm" | "3cm") {
//     const setUploading = thickness === "2cm" ? setUp2 : setUp3;
//     const setRows      = thickness === "2cm" ? setRows2 : setRows3;
//     const setFile      = thickness === "2cm" ? setFile2 : setFile3;
//     const setErr       = thickness === "2cm" ? setErr2 : setErr3;
//
//     setUploading(true); setErr(""); setApplyErr("");
//     try {
//       const rows = await clientParseExcel(file);
//       if (!rows.length) {
//         setErr("No rows found - check column names (Slab, Label, Qty)");
//       } else {
//         setRows(rows); setFile(file);
//       }
//     } catch (e: unknown) {
//       setErr(e instanceof Error ? e.message : "Could not read Excel");
//     }
//     setUploading(false);
//   }
//
//   function discard(thickness: "2cm" | "3cm") {
//     if (thickness === "2cm") { setRows2(null); setFile2(null); setErr2(""); }
//     else                     { setRows3(null); setFile3(null); setErr3(""); }
//     setApplyErr("");
//   }
//
//   async function applyAll() {
//     if (!file2 && !file3) return;
//     setApplying(true); setApplyErr("");
//
//     async function applyOne(file: File): Promise<ApplyResult> {
//       const fd = new FormData();
//       fd.append("projectId", projectId);
//       fd.append("file", file);
//       const res  = await fetch("/api/fab/apply-slab-excel", { method: "POST", body: fd });
//       const data = await res.json();
//       if (!res.ok) throw new Error(data.error ?? "Apply failed");
//       return data as ApplyResult;
//     }
//
//     try {
//       const files = [file2, file3].filter(Boolean) as File[];
//       const results = await Promise.all(files.map(applyOne));
//
//       const merged: ApplyResult = { applied: 0, appliedList: [], unmatched: [] };
//       for (const r of results) {
//         merged.applied      += r.applied;
//         merged.appliedList   = [...merged.appliedList, ...r.appliedList];
//         for (const u of r.unmatched) {
//           if (!merged.unmatched.includes(u)) merged.unmatched.push(u);
//         }
//       }
//
//       setResult(merged);
//       setRows2(null); setFile2(null);
//       setRows3(null); setFile3(null);
//     } catch (e: unknown) {
//       setApplyErr(e instanceof Error ? e.message : "Apply failed");
//     }
//     setApplying(false);
//   }
//
//   const fileCount = [file2, file3].filter(Boolean).length;
//   const canApply  = !applying && fileCount > 0;
//
//   return (
//     <div className="bg-white rounded-xl border border-gray-200 p-5">
//       <div className="mb-4">
//         <h2 className="text-sm font-bold text-gray-800">Slab Allocation - Upload CLO Excel</h2>
//         <p className="text-xs text-gray-400 mt-0.5">
//           Upload the CLO PDF to Claude chat, get the slab allocation Excel, then upload it here.
//           Required columns: <span className="font-mono">Slab</span>,{" "}
//           <span className="font-mono">Label</span>,{" "}
//           <span className="font-mono">Qty</span>.
//         </p>
//       </div>
//
//       {applyErr && (
//         <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{applyErr}</p>
//       )}
//
//       {!result && (
//         <>
//           <div className="flex gap-4 mb-4">
//             <ExcelPanel
//               thickness="2cm"
//               colour="border-blue-100 bg-blue-50/30"
//               rows={rows2} uploading={up2} parseError={err2}
//               onFile={(f) => handleFile(f, "2cm")}
//               onDiscard={() => discard("2cm")}
//             />
//             <ExcelPanel
//               thickness="3cm"
//               colour="border-purple-100 bg-purple-50/30"
//               rows={rows3} uploading={up3} parseError={err3}
//               onFile={(f) => handleFile(f, "3cm")}
//               onDiscard={() => discard("3cm")}
//             />
//           </div>
//
//           {canApply && (
//             <button onClick={applyAll} disabled={applying}
//               className="w-full bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition">
//               {applying
//                 ? "Matching & allocating..."
//                 : `Apply to Project (${fileCount} file${fileCount > 1 ? "s" : ""})`}
//             </button>
//           )}
//         </>
//       )}
//
//       {result && (
//         <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 space-y-2">
//           <p className="text-sm font-semibold text-green-800">
//             {result.applied} requirement{result.applied !== 1 ? "s" : ""} allocated to slabs
//           </p>
//
//           {result.appliedList.length > 0 && (
//             <div className="max-h-48 overflow-y-auto rounded border border-green-200 bg-white">
//               <table className="w-full text-xs">
//                 <thead className="bg-green-50 sticky top-0">
//                   <tr>
//                     <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Serial</th>
//                     <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Slab</th>
//                     <th className="text-center px-3 py-1.5 text-gray-500 font-semibold">Qty</th>
//                   </tr>
//                 </thead>
//                 <tbody className="divide-y divide-gray-50">
//                   {result.appliedList.map((a, i) => (
//                     <tr key={i} className="hover:bg-gray-50">
//                       <td className="px-3 py-1 font-mono font-bold text-gray-800">{a.label}</td>
//                       <td className="px-3 py-1 font-mono text-gray-500 text-[10px]">{a.slabCode}</td>
//                       <td className="px-3 py-1 text-center text-gray-400">x{a.qty}</td>
//                     </tr>
//                   ))}
//                 </tbody>
//               </table>
//             </div>
//           )}
//
//           {result.unmatched.length > 0 && (
//             <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
//               <p>Serials not found in project: <span className="font-mono font-medium">{result.unmatched.join(", ")}</span></p>
//               <p className="text-gray-400 mt-0.5">Did you generate the CLO CSVs from this project first?</p>
//             </div>
//           )}
//
//           <button onClick={() => { setResult(null); setApplyErr(""); }}
//             className="text-xs text-green-600 hover:text-green-800 underline">
//             Upload more
//           </button>
//         </div>
//       )}
//     </div>
//   );
// }
