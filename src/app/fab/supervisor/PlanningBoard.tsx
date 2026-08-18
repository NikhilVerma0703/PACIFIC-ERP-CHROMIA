// RETIRED 2026-08 -- superseded fabrication intake.
//
// The supervisor's requirement-first planning board: a table of every requirement in
// a project, each row given a slab, then "Release to production". It drove
// /api/fab/supervisor/allocate-requirement, /assign-drawing-slab and /release-project.
//
// Replaced mid-2026 by the slab-first screen at /fab/supervisor/slabs, which is worked
// the way the floor actually works: pick a slab, add the pieces that go on it with
// their quantities, mark the sinks, send that slab to cutting. Loss is computed by
// lib/fab/slabLoss.ts and persisted on FabSlabJob.
//
// Its host page (/fab/supervisor) keeps its other half, the Cut Queue, and no longer
// renders a Planning tab.
//
// HOW THIS IS RETIRED. The whole module is commented out rather than deleted, per
// the owner's instruction. The `export {}` below is the only live statement: with
// isolatedModules on, a file with no import or export is a global script, not a
// module, and tsc refuses it (TS1208). Nothing imports this file any more.

export {};

/* ---- original implementation, retired 2026-08 -------------------------- */
// "use client";
//
// // The supervisor's planning board.
// //
// // WHY THIS EXISTS. A project created by the manager (project form + requirement
// // Excel) has drawings and requirements but no FabSlab and no allocation. The
// // only supervisor screen that existed read /api/fab/slab-allocation, which
// // returns FabSlabs that ALREADY carry allocations — rows that appear only after
// // a CLO allocation Excel is applied. So a freshly created project was invisible
// // to the supervisor, and there was nowhere to do the one job the supervisor has:
// // put a physical slab against each piece.
// //
// // The endpoints for it were already there and unused
// // (allocate-requirement / assign-drawing-slab / release-project). This is their
// // screen. Once every requirement has a slab, "Release to production" cuts the
// // pieces and the work moves on to the Cut Queue tab.
//
// import { useCallback, useEffect, useState } from "react";
// import { postJson, getJson } from "@/lib/fab/postJson";
// import { FabAlerts } from "@/components/fab/FabAlerts";
// import { useQcSlabs } from "@/lib/fab/qcSlabs";
//
// /* -- Types ----------------------------------------------------------------- */
// interface Slab {
//   id: string; slabCode: string; colour: string | null; pacificQcId: string | null;
// }
// interface Allocation {
//   id: string; slabId: string; allocatedQuantity: number; slab: Slab | null;
// }
// interface Requirement {
//   id: string;
//   pieceLabel:     string | null;
//   description:    string | null;
//   length:         number | null;
//   width:          number | null;
//   thickness:      number | null;
//   quantity:       number;
//   status:         string;
//   sinkRequired:   boolean;
//   polishRequired: boolean;
//   allocations:    Allocation[];
// }
// interface Drawing {
//   id: string;
//   drawingNumber: string;
//   areaName:      string | null;
//   defaultSlabId: string | null;
//   defaultSlab:   Slab | null;
//   requirements:  Requirement[];
// }
// interface Project {
//   id: string;
//   projectCode:  string;
//   customerName: string | null;
//   status:       string;
//   createdAt:    string;
//   drawings:     Drawing[];
// }
//
// /* -- Helpers --------------------------------------------------------------- */
//
// /** 2cm / 3cm bucket from a requirement thickness. Mirrors the same function in
//  *  /api/fab/slab-allocation — requirements are stored in cm, but legacy rows
//  *  carry mm, so both are accepted. */
// function thickBucket(t: number | null | undefined): 2 | 3 | null {
//   if (!t) return null;
//   const r = Math.round(t);
//   if (r === 2) return 2;
//   if (r === 3) return 3;
//   const fromMm = Math.round(t / 25.4);
//   if (fromMm === 2) return 2;
//   if (fromMm === 3) return 3;
//   return null;
// }
//
// /** The slabs a requirement will actually be cut from: its own allocations if it
//  *  has any, otherwise the drawing default. Same precedence as release-project,
//  *  so what this screen shows is what the release will do — including a CLO split
//  *  across several slabs, which must be visible before a picker replaces it. */
// function effectiveSlabs(req: Requirement, drawing: Drawing): {
//   slabs: { slab: Slab | null; qty: number }[];
//   viaDrawing: boolean;
// } {
//   if (req.allocations.length) {
//     return {
//       slabs: req.allocations.map(a => ({ slab: a.slab, qty: a.allocatedQuantity })),
//       viaDrawing: false,
//     };
//   }
//   if (drawing.defaultSlab) return { slabs: [{ slab: drawing.defaultSlab, qty: req.quantity }], viaDrawing: true };
//   return { slabs: [], viaDrawing: false };
// }
//
// async function deleteJson(url: string): Promise<{ ok: boolean; error: string | null }> {
//   try {
//     const res = await fetch(url, { method: "DELETE" });
//     if (res.ok) return { ok: true, error: null };
//     const data = await res.json().catch(() => null);
//     return { ok: false, error: String(data?.error ?? `Could not clear (error ${res.status}).`) };
//   } catch {
//     return { ok: false, error: "No connection — the change was not saved. Try again." };
//   }
// }
//
// /* -- Slab picker ----------------------------------------------------------- */
// function SlabPicker({ current, thicknessBucket, busy, onPick, onClear, compact }: {
//   current:         Slab | null;
//   thicknessBucket: 2 | 3 | null;
//   busy:            boolean;
//   onPick:          (qcId: string) => Promise<void>;
//   onClear:         (() => Promise<void>) | null;
//   compact?:        boolean;
// }) {
//   const [open, setOpen] = useState(false);
//
//   // This used to be a client-side .slice(0, 200) over the whole QC history,
//   // ordered by ascending slab number — so with an empty search box it offered
//   // slabs 1..200, the oldest stock in the building, and nothing else was
//   // reachable without typing. The cap is server-side now and ordered newest
//   // first, and the search reaches every slab rather than only the sliced 200.
//   const { search, setSearch, slabs: filtered, loading, error, capped } =
//     useQcSlabs(open, thicknessBucket === 3 ? 30 : null);
//
//   return (
//     <div className="relative">
//       <button
//         onClick={() => setOpen(v => !v)}
//         disabled={busy}
//         className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition whitespace-nowrap disabled:opacity-40
//           ${current
//             ? "bg-white border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
//             : "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"}`}>
//         {busy ? "Saving..." : current ? "Change" : compact ? "Assign slab" : "Assign slab to all pieces"}
//       </button>
//
//       {open && (
//         <>
//           <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
//           <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
//             <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
//               <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">
//                 {thicknessBucket === 3 ? "3cm slabs only" : "All slabs"}
//                 <span className="ml-1 font-normal text-gray-400">
//                   ({capped ? `${filtered.length}+` : filtered.length})
//                 </span>
//               </span>
//               <button onClick={() => { setOpen(false); setSearch(""); }}
//                 className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
//             </div>
//             <div className="px-3 py-2 border-b border-gray-100">
//               <input
//                 autoFocus
//                 type="text"
//                 placeholder="Search slab number or colour..."
//                 value={search}
//                 onChange={e => setSearch(e.target.value)}
//                 className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
//               />
//             </div>
//             <div className="max-h-64 overflow-y-auto">
//               {onClear && current && (
//                 <button
//                   onClick={async () => { setOpen(false); await onClear(); }}
//                   className="w-full text-left px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 border-b border-gray-100">
//                   Clear this slab
//                 </button>
//               )}
//               {/* An empty list and a failed lookup must not look the same. */}
//               {error && <p className="px-4 py-4 text-xs text-red-600">{error}</p>}
//               {loading && !error && (
//                 <p className="px-4 py-4 text-xs text-gray-400 italic">Searching...</p>
//               )}
//               {!loading && !error && filtered.length === 0 && (
//                 <p className="px-4 py-4 text-xs text-gray-400 italic">No matching slabs</p>
//               )}
//               {filtered.map(q => (
//                 <button
//                   key={q.pacificQcId}
//                   onClick={async () => { setOpen(false); setSearch(""); await onPick(q.pacificQcId); }}
//                   className={`w-full text-left px-4 py-2.5 border-b border-gray-50 last:border-0 transition
//                     ${current?.pacificQcId === q.pacificQcId ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
//                   <div className="flex items-center justify-between">
//                     <span className="text-sm font-bold text-gray-900">Slab {q.slabCode}</span>
//                     {current?.pacificQcId === q.pacificQcId && (
//                       <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Current</span>
//                     )}
//                   </div>
//                   <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
//                     {q.colour       && <span>{q.colour}</span>}
//                     {q.thicknessMm  && <span>&middot; {q.thicknessMm}mm</span>}
//                     {q.qualityGrade && <span>&middot; Grade {q.qualityGrade}</span>}
//                     {q.batchKey     && <span>&middot; {q.batchKey}</span>}
//                   </div>
//                 </button>
//               ))}
//             </div>
//           </div>
//         </>
//       )}
//     </div>
//   );
// }
//
// /* -- Project card ---------------------------------------------------------- */
// function ProjectCard({ project, busyKey, onAssignRequirement, onClearRequirement, onAssignDrawing, onRelease, releasing }: {
//   project:             Project;
//   busyKey:             string | null;
//   onAssignRequirement: (req: Requirement, qcId: string) => Promise<void>;
//   onClearRequirement:  (req: Requirement) => Promise<void>;
//   onAssignDrawing:     (drawing: Drawing, qcId: string) => Promise<void>;
//   onRelease:           (project: Project) => Promise<void>;
//   releasing:           boolean;
// }) {
//   const [open, setOpen] = useState(true);
//
//   const allReqs   = project.drawings.flatMap(d => d.requirements.map(r => ({ r, d })));
//   const resolved  = allReqs.filter(({ r, d }) => effectiveSlabs(r, d).slabs.length > 0);
//   const totalPcs  = allReqs.reduce((s, { r }) => s + r.quantity, 0);
//   const readyToRelease = allReqs.length > 0 && resolved.length === allReqs.length;
//
//   return (
//     <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
//       {/* Header */}
//       <div className="px-5 py-4 flex items-center gap-4 flex-wrap border-b border-gray-100">
//         <button onClick={() => setOpen(v => !v)} className="text-gray-400 hover:text-gray-700 text-sm w-4">
//           {open ? "▾" : "▸"}
//         </button>
//         <div className="flex-1 min-w-0">
//           <div className="flex items-center gap-2 flex-wrap">
//             <span className="text-base font-bold text-gray-900">{project.projectCode}</span>
//             {project.customerName && <span className="text-sm text-gray-500">{project.customerName}</span>}
//             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide
//               ${project.status === "ALLOCATED" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
//               {project.status.replace(/_/g, " ")}
//             </span>
//           </div>
//           <p className="text-[11px] text-gray-400 mt-1">
//             {project.drawings.length} drawing{project.drawings.length !== 1 ? "s" : ""} &middot;{" "}
//             {allReqs.length} piece type{allReqs.length !== 1 ? "s" : ""} &middot; {totalPcs} pcs &middot;{" "}
//             <span className={readyToRelease ? "text-green-600 font-semibold" : "text-amber-600 font-semibold"}>
//               {resolved.length}/{allReqs.length} have a slab
//             </span>
//           </p>
//         </div>
//         <button
//           onClick={() => onRelease(project)}
//           disabled={!readyToRelease || releasing}
//           title={readyToRelease ? "Create the pieces and send the work to the machines" : "Every piece type needs a slab first"}
//           className="text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed bg-gray-900 text-white hover:bg-gray-700">
//           {releasing ? "Releasing..." : "Release to production"}
//         </button>
//       </div>
//
//       {/* Drawings */}
//       {open && (
//         <div className="divide-y divide-gray-100">
//           {project.drawings.length === 0 && (
//             <p className="px-5 py-6 text-xs text-gray-400 italic">
//               No drawings on this project — the manager needs to upload the requirement Excel.
//             </p>
//           )}
//           {project.drawings.map(drawing => {
//             const buckets = [...new Set(drawing.requirements.map(r => thickBucket(r.thickness)).filter(Boolean))];
//             const drawingBucket = buckets.length === 1 ? (buckets[0] as 2 | 3) : null;
//             return (
//               <div key={drawing.id}>
//                 <div className="px-5 py-2.5 bg-gray-50/70 flex items-center gap-3 flex-wrap">
//                   <span className="text-xs font-bold text-gray-700">Drawing {drawing.drawingNumber}</span>
//                   {drawing.areaName && <span className="text-[11px] text-gray-400">{drawing.areaName}</span>}
//                   {drawing.defaultSlab && (
//                     <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
//                       Default slab {drawing.defaultSlab.slabCode}
//                     </span>
//                   )}
//                   <div className="ml-auto">
//                     <SlabPicker
//                       current={drawing.defaultSlab}
//                       thicknessBucket={drawingBucket}
//                       busy={busyKey === `d:${drawing.id}`}
//                       onPick={qcId => onAssignDrawing(drawing, qcId)}
//                       onClear={null}
//                     />
//                   </div>
//                 </div>
//
//                 <div className="overflow-x-auto">
//                 <table className="w-full text-xs min-w-[720px]">
//                   <thead className="bg-white">
//                     <tr className="text-gray-400">
//                       <th className="px-5 py-2 text-left font-semibold">Piece</th>
//                       <th className="px-5 py-2 text-left font-semibold">Description</th>
//                       <th className="px-5 py-2 text-left font-semibold">Size (in)</th>
//                       <th className="px-5 py-2 text-center font-semibold">Qty</th>
//                       <th className="px-5 py-2 text-center font-semibold">Route</th>
//                       <th className="px-5 py-2 text-left font-semibold">Slab</th>
//                       <th className="px-5 py-2" />
//                     </tr>
//                   </thead>
//                   <tbody className="divide-y divide-gray-50">
//                     {drawing.requirements.map(req => {
//                       const { slabs, viaDrawing } = effectiveSlabs(req, drawing);
//                       const isSplit = req.allocations.length > 1;
//                       const bucket  = thickBucket(req.thickness);
//                       return (
//                         <tr key={req.id} className="hover:bg-gray-50/60">
//                           <td className="px-5 py-2 font-mono font-bold text-gray-800">
//                             {req.pieceLabel ?? "-"}
//                           </td>
//                           <td className="px-5 py-2 text-gray-500 max-w-xs truncate">{req.description ?? "-"}</td>
//                           <td className="px-5 py-2 font-mono text-gray-600">
//                             {req.length && req.width ? `${req.length} x ${req.width}` : "-"}
//                             {bucket && <span className="ml-1 text-gray-400">&middot; {bucket}cm</span>}
//                           </td>
//                           <td className="px-5 py-2 text-center font-bold text-gray-800">{req.quantity}</td>
//                           <td className="px-5 py-2 text-center whitespace-nowrap">
//                             {req.polishRequired && <span className="text-[10px] font-bold text-blue-600 mr-1">POL</span>}
//                             {req.sinkRequired   && <span className="text-[10px] font-bold text-orange-600">SINK</span>}
//                             {!req.polishRequired && !req.sinkRequired && <span className="text-gray-300">-</span>}
//                           </td>
//                           <td className="px-5 py-2">
//                             {slabs.length === 0 ? (
//                               <span className="text-amber-600 font-semibold">Needs a slab</span>
//                             ) : (
//                               <span className="inline-flex items-center gap-1.5 flex-wrap">
//                                 {slabs.map(({ slab, qty }, i) => (
//                                   <span key={slab?.id ?? i} className="whitespace-nowrap">
//                                     <span className="font-semibold text-gray-800">Slab {slab?.slabCode ?? "?"}</span>
//                                     {isSplit && <span className="text-gray-400"> &times;{qty}</span>}
//                                     {!isSplit && slab?.colour && <span className="text-gray-400"> {slab.colour}</span>}
//                                     {i < slabs.length - 1 && <span className="text-gray-300">,</span>}
//                                   </span>
//                                 ))}
//                                 {isSplit && (
//                                   <span className="text-[10px] text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-full">
//                                     split
//                                   </span>
//                                 )}
//                                 {viaDrawing && (
//                                   <span className="text-[10px] text-blue-500 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full">
//                                     from drawing
//                                   </span>
//                                 )}
//                               </span>
//                             )}
//                           </td>
//                           <td className="px-5 py-2 text-right">
//                             <SlabPicker
//                               compact
//                               current={req.allocations.length === 1 ? req.allocations[0].slab : null}
//                               thicknessBucket={bucket}
//                               busy={busyKey === `r:${req.id}`}
//                               onPick={qcId => onAssignRequirement(req, qcId)}
//                               onClear={req.allocations.length ? () => onClearRequirement(req) : null}
//                             />
//                           </td>
//                         </tr>
//                       );
//                     })}
//                   </tbody>
//                 </table>
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       )}
//     </div>
//   );
// }
//
// /* -- Board ----------------------------------------------------------------- */
// export function PlanningBoard() {
//   const [projects,    setProjects]    = useState<Project[]>([]);
//   const [loading,     setLoading]     = useState(true);
//   const [loadError,   setLoadError]   = useState<string | null>(null);
//   const [actionError, setActionError] = useState<string | null>(null);
//   const [notice,      setNotice]      = useState<string | null>(null);
//   const [releaseWarnings, setReleaseWarnings] = useState<string[]>([]);
//   const [busyKey,     setBusyKey]     = useState<string | null>(null);
//   const [releasingId, setReleasingId] = useState<string | null>(null);
//
//   const load = useCallback(async () => {
//     setLoading(true);
//     // Only the projects. The available-slab list is fetched per picker, on
//     // open — pulling the whole QC history up front is what made the board slow
//     // to appear and, past Vercel's response cap, fail outright.
//     const p = await getJson<Project>("/api/fab/supervisor/projects");
//     setProjects(p.data);
//     setLoadError(p.error);
//     setLoading(false);
//   }, []);
//
//   useEffect(() => { load(); }, [load]);
//
//   async function assignRequirement(req: Requirement, qcId: string) {
//     // allocate-requirement replaces every allocation this piece has. On a CLO
//     // split that silently throws away the other slabs, so it gets asked first.
//     if (req.allocations.length > 1 && !confirm(
//       `This piece is split across ${req.allocations.length} slabs. Assigning one slab replaces the whole split. Continue?`
//     )) return;
//     setBusyKey(`r:${req.id}`); setActionError(null);
//     const res = await postJson("/api/fab/supervisor/allocate-requirement", {
//       requirementId: req.id, slabId: `qc:${qcId}`, allocatedQuantity: req.quantity,
//     });
//     if (!res.ok) setActionError(res.error);
//     setBusyKey(null);
//     await load();
//   }
//
//   async function clearRequirement(req: Requirement) {
//     setBusyKey(`r:${req.id}`); setActionError(null);
//     const res = await deleteJson(`/api/fab/supervisor/allocate-requirement?requirementId=${req.id}`);
//     if (!res.ok) setActionError(res.error);
//     setBusyKey(null);
//     await load();
//   }
//
//   async function assignDrawing(drawing: Drawing, qcId: string) {
//     setBusyKey(`d:${drawing.id}`); setActionError(null);
//     const projectId = projects.find(p => p.drawings.some(d => d.id === drawing.id))?.id ?? null;
//     const res = await postJson("/api/fab/supervisor/assign-drawing-slab", {
//       drawingId: drawing.id, slabId: `qc:${qcId}`, projectId,
//     });
//     if (!res.ok) setActionError(res.error);
//     setBusyKey(null);
//     await load();
//   }
//
//   async function release(project: Project) {
//     if (!confirm(`Release ${project.projectCode} to production? This creates the pieces and sends them to the machine queues.`)) return;
//     setReleasingId(project.id); setActionError(null); setNotice(null); setReleaseWarnings([]);
//     const res = await postJson("/api/fab/supervisor/release-project", { projectId: project.id });
//     const warnings: string[] = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
//
//     if (!res.ok) {
//       // res.error is the route's own `error` string whenever it sent one — the
//       // named list of piece types with no slab, or the reason the write failed.
//       // postJson only falls back to "Could not save (error N)" when the body was
//       // not JSON at all, which now means the framework failed before the route.
//       setActionError(res.error);
//     } else if (res.data?.success !== true) {
//       // 200 without the route's own confirmation: do not paint this green. The
//       // board used to accept any 200 and report `piecesCreated ?? 0`, so an
//       // empty body read as "released — 0 piece(s) created".
//       setActionError(
//         `${project.projectCode} may not have been released — the server replied without confirming. ` +
//         `Refresh and check the project's status before releasing again.`
//       );
//     } else {
//       const count = res.data.piecesCreated;
//       setNotice(
//         `${project.projectCode} released — ${count} piece(s) created. ` +
//         `Assign the physical slabs in Cut Queue and send them to the cutter.`
//       );
//       // Warnings mean the release went through but some allocation data is
//       // wrong. They are not an error and must not be buried in the green
//       // banner, where they read as part of the good news.
//       setReleaseWarnings(warnings);
//     }
//     setReleasingId(null);
//     await load();
//   }
//
//   if (loading) return (
//     <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
//       <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
//         <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
//       </svg>
//       Loading...
//     </div>
//   );
//
//   return (
//     <div>
//       <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
//         <div>
//           <h1 className="text-2xl font-bold text-gray-900">Planning Board</h1>
//           <p className="text-sm text-gray-400 mt-0.5">
//             Give every piece a slab, then release the project to the machines
//           </p>
//         </div>
//         <button onClick={load}
//           className="text-xs text-gray-500 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition">
//           Refresh
//         </button>
//       </div>
//
//       <FabAlerts
//         loadError={loadError}
//         actionError={actionError}
//         onDismiss={() => setActionError(null)}
//         noun="board"
//       />
//
//       {notice && (
//         <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-start justify-between gap-4">
//           <span className="whitespace-pre-line">{notice}</span>
//           <button onClick={() => setNotice(null)} aria-label="Dismiss"
//             className="shrink-0 font-bold text-green-400 hover:text-green-700">✕</button>
//         </div>
//       )}
//
//       {/* Released, but something in the allocation data is wrong and a human has
//           to look at it. Amber, listed one per line, and separate from the green
//           banner so it cannot be skimmed past as part of the success message. */}
//       {releaseWarnings.length > 0 && (
//         <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start justify-between gap-4">
//           <div>
//             <b>Released, but check {releaseWarnings.length} piece type{releaseWarnings.length !== 1 ? "s" : ""}:</b>
//             <ul className="mt-1 list-disc pl-5 space-y-0.5">
//               {releaseWarnings.map((w, i) => <li key={i}>{w}</li>)}
//             </ul>
//           </div>
//           <button onClick={() => setReleaseWarnings([])} aria-label="Dismiss"
//             className="shrink-0 font-bold text-amber-400 hover:text-amber-700">✕</button>
//         </div>
//       )}
//
//       {projects.length === 0 ? (
//         <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
//           No projects waiting to be planned. A project appears here as soon as the manager creates it.
//         </div>
//       ) : (
//         <div className="space-y-4">
//           {projects.map(p => (
//             <ProjectCard
//               key={p.id}
//               project={p}
//               busyKey={busyKey}
//               releasing={releasingId === p.id}
//               onAssignRequirement={assignRequirement}
//               onClearRequirement={clearRequirement}
//               onAssignDrawing={assignDrawing}
//               onRelease={release}
//             />
//           ))}
//         </div>
//       )}
//     </div>
//   );
// }
