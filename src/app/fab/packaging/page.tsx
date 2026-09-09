"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { ProcessSessionGate } from "@/components/fab/ProcessSessionGate";
import { OtherStageChips } from "@/components/fab/OtherStageChips";
import { RejectPieceButton } from "@/components/fab/RejectPieceButton";
import { rowLabel } from "@/lib/fab/pieceNaming";
import { getJson, postJson } from "@/lib/fab/postJson";
import { FabAlerts } from "@/components/fab/FabAlerts";
// scripts/0068 — the size AS THE CUSTOMER ORDERED IT. length/width are stored
// in inches because the feet and the square feet are built on inches; this is
// the only thing that turns them back into the centimetres a metric order was
// written in. NULL unit = inches = unchanged.
import { orderedSizeLabel } from "@/lib/fab/dimensions";


interface Piece {
  id: string; pieceCode: string;
  projectId: string;
  project: { projectCode: string; customerName: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; rowLetter: string | null; po: { poNumber: string } | null; length: number | null; width: number | null; dimUnit: string | null } | null;
  slab: { slabCode: string; colour: string | null } | null;
  otherDone?: string[];
  recent?: boolean;
}

interface Package {
  id: string; packageCode: string; remarks: string | null;
  createdAt: string; pieceCount: number; projects: string[];
  pieces: Array<{
    id: string; pieceCode: string; projectCode: string; customerName: string;
    drawingNumber: string | null; pieceLabel: string | null;
    length: number | null; width: number | null; dimUnit: string | null;
    slabCode: string | null; slabColour: string | null;
  }>;
}

export default function FabPackagingPage() {
  return (
    <ProcessSessionGate type="PACKAGING">
      <PackagingQueue />
    </ProcessSessionGate>
  );
}

function PackagingQueue() {
  const [tab, setTab]           = useState<"queue"|"packages">("queue");
  const [pieces, setPieces]     = useState<Piece[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading]   = useState(true);
  /** WHY THIS EXISTS. Both loaders below used a bare fetch and coerced anything
   *  that was not an array to []. So a 500, an expired session or a dropped
   *  connection drew the SAME screen as a genuinely empty queue: "nothing to
   *  pack". The packer goes home. This is the last stage before a piece ships,
   *  and it is the worst place in the plant for a failure to look like calm. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Multi-select state
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [projFilter, setProjFilter] = useState<string>("ALL");

  // Create package state
  const [creating, setCreating]       = useState(false);
  const [pkgCode, setPkgCode]         = useState("");
  const [remarks, setRemarks]         = useState("");
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Not an error — the package WAS created. Sample pieces inside it that
   *  reached no shelf, which nobody was being told about. */
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  // Package expand
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadQueue = useCallback(async () => {
    const r = await getJson<Piece>("/api/fab/queues/packaging");
    if (r.ok) { setPieces(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);

  const loadPackages = useCallback(async () => {
    const r = await getJson<Package>("/api/fab/packages");
    if (r.ok) { setPackages(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadQueue(), loadPackages()]).finally(() => setLoading(false));
    // Poll both every 20 s — but only while the tab is visible (a hidden tab
    // shows nothing, so polling it only burns two function calls and their Neon
    // reads all night), and once immediately when it becomes visible again so a
    // returned-to tab is current. Same pattern as components/AutoRefresh.
    const refresh = () => { loadQueue(); loadPackages(); };
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadQueue, loadPackages]);

  // Unique projects from queue
  const projects = useMemo(() => {
    const seen = new Map<string, string>(); // projectCode -> customerName
    for (const p of pieces) seen.set(p.project.projectCode, p.project.customerName);
    return [...seen.entries()];
  }, [pieces]);

  // Filtered pieces
  const filteredPieces = useMemo(() =>
    projFilter === "ALL" ? pieces : pieces.filter(p => p.project.projectCode === projFilter),
    [pieces, projFilter]
  );

  // Group filtered pieces by project for display
  const grouped = useMemo(() => {
    const map = new Map<string, Piece[]>();
    for (const p of filteredPieces) {
      const key = p.project.projectCode;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [filteredPieces]);

  function togglePiece(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setSuccessCode(null);
  }

  function toggleProject(code: string) {
    const group = grouped.get(code) ?? [];
    const allSelected = group.every(p => selected.has(p.id));
    setSelected(s => {
      const n = new Set(s);
      group.forEach(p => allSelected ? n.delete(p.id) : n.add(p.id));
      return n;
    });
    setSuccessCode(null);
  }

  function selectAll() {
    setSelected(new Set(filteredPieces.map(p => p.id)));
    setSuccessCode(null);
  }
  function clearAll() { setSelected(new Set()); setSuccessCode(null); }

  async function createPackage() {
    if (!selected.size) return;
    setCreating(true);
    setSuccessCode(null);
    setCreateError(null);
    // postJson, not fetch. The loaders above were moved off a bare fetch and
    // this write was left on one — with an UNGUARDED res.json(). An expired
    // session returns the login page as 200 + HTML, res.json() throws inside an
    // async handler with no try, and setCreating(false) below never runs: the
    // button reads "Creating…" for ever, createError stays null, and the
    // operator is looking at a wedged screen having packed nothing.
    const res = await postJson("/api/fab/queues/packaging/complete", {
      pieceIds:    [...selected],
      packageCode: pkgCode.trim() || undefined,
      remarks:     remarks.trim() || undefined,
    });
    if (res.ok) {
      const data = (res.data ?? {}) as {
        packageCode?: string; samplesCredited?: number; samplesUnattributed?: number;
      };
      setSuccessCode(data.packageCode ?? null);
      // WHAT THE SHELF DID NOT GET. The route counts sample pieces it could not
      // credit — a row that does not say which colour, finish and size it was
      // ordered against — and this screen used to read only packageCode and
      // throw the rest away. Those pieces are PACKAGED with no sampling_intake
      // and nobody downstream is told; the sampling desk finds out days later,
      // if ever, from a number that does not add up.
      setCreateNotice(
        data.samplesUnattributed
          ? `${data.samplesUnattributed} sample piece${data.samplesUnattributed === 1 ? "" : "s"} ` +
            `reached no shelf — the row does not say which colour, finish and size ` +
            `${data.samplesUnattributed === 1 ? "it was" : "they were"} ordered against. ` +
            `Tell the sampling desk.`
          : null,
      );
      setSelected(new Set());
      setPkgCode("");
      setRemarks("");
      await Promise.all([loadQueue(), loadPackages()]);
    } else {
      setCreateError(res.error ?? "Failed to create package");
    }
    setCreating(false);
  }

  function toggleExpand(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div className="pb-40">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Packaging</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pieces.length} piece{pieces.length !== 1 ? "s" : ""} ready · {packages.length} package{packages.length !== 1 ? "s" : ""} created</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setTab("queue")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "queue" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            Queue <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{pieces.length}</span>
          </button>
          <button onClick={() => setTab("packages")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "packages" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            Packages <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{packages.length}</span>
          </button>
        </div>
      </div>

      {/* A failed load must not read as an empty queue — see loadError above. */}
      <FabAlerts loadError={loadError} noun="packing queue" />

      {/* Queue tab */}
      {tab === "queue" && (
        <>
          {successCode && (
            <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-800">Package created!</p>
                <p className="text-xs text-green-600 font-mono mt-0.5">{successCode}</p>
              </div>
              <button onClick={() => setSuccessCode(null)} className="text-green-400 hover:text-green-600 text-lg">×</button>
            </div>
          )}

          {/* AMBER, not green, and separate from the package banner: the package
              was created, and something in it did not reach the shelf. */}
          {createNotice && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-start justify-between gap-3">
              <p className="text-xs text-amber-800">{createNotice}</p>
              <button onClick={() => setCreateNotice(null)}
                className="text-amber-400 hover:text-amber-600 text-lg shrink-0">×</button>
            </div>
          )}

          {/* Filters + bulk controls */}
          <div className="flex items-center gap-3 mb-4">
            <select value={projFilter} onChange={e => { setProjFilter(e.target.value); clearAll(); }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-200">
              <option value="ALL">All Projects</option>
              {projects.map(([code, name]) => (
                <option key={code} value={code}>{code}{name ? ` — ${name}` : ""}</option>
              ))}
            </select>
            {filteredPieces.length > 0 && (
              <>
                <button onClick={selectAll} className="text-xs text-green-600 hover:text-green-800 font-medium">Select All ({filteredPieces.length})</button>
                {selected.size > 0 && <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>}
              </>
            )}
          </div>

          {filteredPieces.length === 0 ? (
            <div className="text-center py-20 text-gray-400">No pieces ready for packaging.</div>
          ) : (
            <div className="space-y-4">
              {[...grouped.entries()].map(([projCode, group]) => {
                const allSel  = group.every(p => selected.has(p.id));
                const someSel = group.some(p => selected.has(p.id));
                return (
                  <div key={projCode} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Project group header */}
                    <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
                      <input type="checkbox" checked={allSel}
                        ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
                        onChange={() => toggleProject(projCode)}
                        className="w-4 h-4 rounded accent-green-600 cursor-pointer" />
                      <span className="font-semibold text-sm text-gray-800">{projCode}</span>
                      <span className="text-xs text-gray-400">{group[0].project.customerName}</span>
                      <span className="ml-auto text-xs text-gray-400">{group.length} piece{group.length !== 1 ? "s" : ""}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-400 bg-gray-50/50">
                        <tr>
                          <th className="w-10 px-5 py-2"></th>
                          <th className="text-left px-3 py-2">Piece</th>
                          <th className="text-left px-3 py-2">Row</th>
                          <th className="text-left px-3 py-2">PO</th>
                          <th className="text-left px-3 py-2">Size</th>
                          <th className="text-left px-3 py-2">Slab</th>
                          <th className="w-20 px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {group.map(p => (
                          <tr key={p.id}
                            onClick={() => togglePiece(p.id)}
                            className={`cursor-pointer transition ${selected.has(p.id) ? "bg-green-50" : p.recent ? "bg-amber-50/80 hover:bg-amber-50" : "hover:bg-gray-50"}`}>
                            <td className="px-5 py-2.5">
                              <input type="checkbox" checked={selected.has(p.id)}
                                onChange={() => togglePiece(p.id)}
                                onClick={e => e.stopPropagation()}
                                className="w-4 h-4 rounded accent-green-600 cursor-pointer" />
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-mono text-xs text-gray-700">{p.pieceCode}</span>
                              <OtherStageChips otherDone={p.otherDone} recent={p.recent} />
                            </td>
                            <td className="px-3 py-2.5 text-gray-500">{rowLabel(p.requirement?.rowLetter, p.requirement?.pieceLabel)}</td>
                            <td className="px-3 py-2.5 text-gray-500">{p.requirement?.po?.poNumber ?? p.drawing?.drawingNumber ?? "—"}</td>
                            <td className="px-3 py-2.5 text-gray-500">
                              {p.requirement?.length && p.requirement?.width
                                ? (orderedSizeLabel(p.requirement.length, p.requirement.width, p.requirement.dimUnit) ?? "—") : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500">
                              {p.slab?.slabCode ?? "—"}{p.slab?.colour ? ` · ${p.slab.colour}` : ""}
                            </td>
                            <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                              <RejectPieceButton
                                pieceId={p.id}
                                processType="PACKAGING"
                                onDone={() => {
                                  setSelected(s => { const n = new Set(s); n.delete(p.id); return n; });
                                  void loadQueue();
                                }}
                                onError={setCreateError}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky Create Package bar */}
          {selected.size > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl px-8 py-4 z-50">
              {createError && (
                <div className="max-w-5xl mx-auto mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                  <span>{createError}</span>
                  <button onClick={() => setCreateError(null)} className="ml-3 text-red-400 hover:text-red-600">×</button>
                </div>
              )}
              <div className="max-w-5xl mx-auto flex items-center gap-4">
                <div className="text-sm font-semibold text-gray-800 flex-shrink-0">
                  {selected.size} piece{selected.size !== 1 ? "s" : ""} selected
                </div>
                <input value={pkgCode} onChange={e => setPkgCode(e.target.value)}
                  placeholder="Package code (optional, auto-generated)"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                <input value={remarks} onChange={e => setRemarks(e.target.value)}
                  placeholder="Remarks / vehicle (optional)"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300" />
                <button onClick={clearAll}
                  className="text-sm text-gray-400 hover:text-gray-600 px-3 py-2 flex-shrink-0">
                  Cancel
                </button>
                <button onClick={createPackage} disabled={creating}
                  className="flex-shrink-0 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold transition">
                  {creating ? "Creating…" : `Create Package (${selected.size})`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Packages tab */}
      {tab === "packages" && (
        <div className="space-y-3">
          {packages.length === 0 ? (
            <div className="text-center py-20 text-gray-400">No packages created yet.</div>
          ) : packages.map(pkg => (
            <div key={pkg.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => toggleExpand(pkg.id)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-gray-800">{pkg.packageCode}</span>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      {pkg.pieceCount} piece{pkg.pieceCount !== 1 ? "s" : ""}
                    </span>
                    {pkg.projects.map(p => (
                      <span key={p} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{p}</span>
                    ))}
                    {pkg.remarks && (
                      <span className="text-xs text-gray-400 italic truncate">{pkg.remarks}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(pkg.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded.has(pkg.id) ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {expanded.has(pkg.id) && (
                <div className="border-t border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-400">
                      <tr>
                        <th className="text-left px-5 py-2">Piece</th>
                        <th className="text-left px-5 py-2">Row</th>
                        <th className="text-left px-5 py-2">PO</th>
                        <th className="text-left px-5 py-2">Size</th>
                        <th className="text-left px-5 py-2">Slab</th>
                        <th className="text-left px-5 py-2">Project</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pkg.pieces.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2 font-mono text-gray-700">{p.pieceCode}</td>
                          <td className="px-5 py-2 text-gray-500">{p.pieceLabel ?? "—"}</td>
                          <td className="px-5 py-2 text-gray-500">{p.drawingNumber ?? "—"}</td>
                          <td className="px-5 py-2 text-gray-500">
                            {orderedSizeLabel(p.length, p.width, p.dimUnit) ?? "—"}
                          </td>
                          <td className="px-5 py-2 text-gray-500">
                            {p.slabCode ?? "—"}{p.slabColour ? ` · ${p.slabColour}` : ""}
                          </td>
                          <td className="px-5 py-2 text-gray-500">{p.projectCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
