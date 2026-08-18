// RETIRED 2026-08 -- superseded fabrication intake.
//
// The legacy "New Project" screen: type a project code and a customer name, upload
// a Drawing Summary workbook to POST /api/fab/parse-excel, then create the project
// and all its requirements in one shot through POST /api/fab/projects.
//
// Replaced mid-2026 by the manager dashboard at /fab/manager: the project is created
// by hand, POs are created under it by hand, and each PO's document is uploaded
// against that PO (preview, then confirm). Both endpoints this screen used are
// retired in the same pass.
//
// HOW THIS IS RETIRED. Unlike a route handler, an App Router page.tsx MUST keep a
// default export or the build fails outright ("The default export is not a React
// Component"), so this cannot simply be commented out end to end. What is left is a
// redirect to the screen that replaced it -- which is also why the redirect target is
// /fab/manager and not a dead end: /fab/manager sends anyone who is not a MANAGER or
// ADMIN on to /fab/projects, so a supervisor following an old bookmark still lands on
// the projects list rather than a 403. The "+ New Project" link on /fab/projects that
// used to point here now points at /fab/manager directly.

import { redirect } from "next/navigation";

export default function RetiredNewFabProjectPage() {
  redirect("/fab/manager");
}

/* ---- original implementation, retired 2026-08 -------------------------- */
// "use client";
// import { useState } from "react";
// import { useRouter } from "next/navigation";
//
// interface ParsedRow {
//   drawingNumber: string; unitType?: string; units?: number; areaName?: string;
//   pieceLabel?: string; description?: string; length: number; width: number;
//   thickness?: number; sinkModel?: string; sinkCuts?: number; faucets?: number;
//   depLength?: number; joints?: number; sqftPerPiece?: number; quantity: number; totalSqft?: number; notes?: string;
// }
//
// export default function NewFabProjectPage() {
//   const router = useRouter();
//   const [step, setStep] = useState<"form" | "preview" | "saving">("form");
//   const [projectCode, setProjectCode] = useState("");
//   const [customerName, setCustomerName] = useState("");
//   const [remarks, setRemarks] = useState("");
//   const [rows, setRows] = useState<ParsedRow[]>([]);
//   const [preview, setPreview] = useState<any>(null);
//   const [error, setError] = useState("");
//   const [file, setFile] = useState<File | null>(null);
//
//   async function handleFileParse(f: File) {
//     setFile(f); setError("");
//     const fd = new FormData(); fd.append("file", f);
//     const res = await fetch("/api/fab/parse-excel", { method: "POST", body: fd });
//     const data = await res.json();
//     if (!res.ok || data.errors?.length) { setError(data.errors?.[0] ?? data.error ?? "Parse failed"); return; }
//     setRows(data.rows); setPreview(data.preview); setStep("preview");
//   }
//
//   async function handleSubmit() {
//     if (!projectCode.trim() || !customerName.trim()) { setError("Project code and customer name required"); return; }
//     setStep("saving"); setError("");
//     const res = await fetch("/api/fab/projects", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ projectCode, customerName, remarks, requirements: rows }),
//     });
//     const data = await res.json();
//     if (!res.ok) { setError(data.error ?? "Failed"); setStep("preview"); return; }
//     // The API returns { success, projectId } — reading data.id gave
//     // /fab/projects/undefined, whose detail page redirects back to the list. The
//     // project HAD been created, so it looked like the save silently failed.
//     router.push(`/fab/projects/${data.projectId}`);
//   }
//
//   return (
//     <div className="max-w-2xl mx-auto">
//       <h1 className="text-2xl font-bold text-gray-900 mb-6">New Project</h1>
//
//       <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Project Code</label>
//             <input value={projectCode} onChange={e => setProjectCode(e.target.value)}
//               className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. PRJ-001" />
//           </div>
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
//             <input value={customerName} onChange={e => setCustomerName(e.target.value)}
//               className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Alta River" />
//           </div>
//         </div>
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
//           <input value={remarks} onChange={e => setRemarks(e.target.value)}
//             className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Optional" />
//         </div>
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-1">Cutting Plan Excel (.xlsx)</label>
//           <input type="file" accept=".xlsx,.xls"
//             onChange={e => e.target.files?.[0] && handleFileParse(e.target.files[0])}
//             className="text-sm text-gray-600" />
//         </div>
//         {error && <p className="text-red-600 text-sm">{error}</p>}
//       </div>
//
//       {step === "preview" && preview && (
//         <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6">
//           <h2 className="font-semibold text-gray-800 mb-3">Preview</h2>
//           <div className="grid grid-cols-4 gap-3 mb-4">
//             {[
//               { label: "Rows", value: preview.rowCount },
//               { label: "Total Pieces", value: preview.totalPieces },
//               { label: "Drawings", value: preview.drawings },
//               { label: "Sink Pieces", value: preview.sinkPieces },
//             ].map(s => (
//               <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
//                 <p className="text-2xl font-bold text-gray-900">{s.value}</p>
//                 <p className="text-xs text-gray-500">{s.label}</p>
//               </div>
//             ))}
//           </div>
//           {preview.warnings?.map((w: string, i: number) => (
//             <p key={i} className="text-yellow-700 text-xs mb-1">⚠ {w}</p>
//           ))}
//           <button onClick={handleSubmit} disabled={step !== "preview"}
//             className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 mt-2">
//             {step !== "preview" ? "Creating…" : "Create Project"}
//           </button>
//         </div>
//       )}
//     </div>
//   );
// }
