"use client";
// One smart form for the robo line: batch setup (collapses once saved) + slab
// logging against the active batch. There is NO shift UI — the RoboShift row
// the schema requires is created and rolled over per day silently on batch
// save. Robo doesn’t run in every production, so everything here is opt-in.
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { SearchableSelect, type SsOption } from "./SearchableSelect";
import { findDesignPreset } from "@/lib/robo/design-presets";
import { SLAB_IN_PROCESSING, slabStatusClass, slabStatusLabel } from "@/lib/robo/utils";

const MACHINE_ORDER = ["Roycut-1", "Roymix", "Roycut-2", "Roycut-3"];

const CATEGORY_COLOR: Record<string, string> = {
  ROBOT: "bg-blue-100 text-blue-700", MAINTENANCE: "bg-orange-100 text-orange-700",
  ROYMIX: "bg-emerald-100 text-emerald-700", LINE: "bg-slate-100 text-slate-700",
  DISTRIBUTOR: "bg-purple-100 text-purple-700", PRESS: "bg-rose-100 text-rose-700",
  GENERAL: "bg-gray-100 text-gray-700", POWERCUT: "bg-red-100 text-red-700", LINE_START: "bg-teal-100 text-teal-700",
};
const CATEGORY_ORDER = ["ROYMIX", "LINE", "DISTRIBUTOR", "LINE_START", "PRESS", "MAINTENANCE", "ROBOT", "GENERAL", "POWERCUT"];

interface Machine { id: string; name: string; type: string }
interface Design { id: string; name: string }
interface Program { id: string; name: string; design?: { name: string } | null }
interface Named { id: string; name: string }
interface DelayCode { id: string; code: string; description: string; category: string; isRobotSpecific: boolean }
interface BatchEntry {
  machine: { name: string };
  programName: string | null; toolName: string | null; liquidName: string | null;
  powderName: string | null; rollerHeight: string | null; targetCycleTime: number | null;
}
interface BatchRecipe { id: string; designName: string; thickness: number | null; targetSlabs: number | null; entries: BatchEntry[] }
interface ProdRecord {
  id: string; serialNumber: number | null; slabNumber: string;
  inTime: string | null; outTime: string | null; roymixCycleTime: number | null;
  roymixBodyWeight: number | null; status: string; remarks: string | null; createdAt: string;
}
interface ActiveShift {
  id: string; shiftNumber: number; date: string; operatorName: string;
  batchRecipes: BatchRecipe[]; productionRecords: ProdRecord[];
}
interface PendingDelay {
  tempId: number; delayCodeId: string; code: string; description: string; category: string;
  machineId: string; machineName: string; durationMinutes: number;
  startTime: string; endTime: string; remarks: string;
}

/** Duration between two HH:MM[:SS] strings, or null when the range is invalid.
 * An end before the start is treated as crossing midnight (night shift logging
 * 23:50 → 00:10), capped at 12h so an inverted typo still reads as invalid. */
function calcDuration(start: string, end: string): { minutes: number; seconds: number } | null {
  if (!start || !end) return null;
  const [h1, m1, s1 = 0] = start.split(":").map(Number);
  const [h2, m2, s2 = 0] = end.split(":").map(Number);
  let diff = h2 * 3600 + m2 * 60 + s2 - (h1 * 3600 + m1 * 60 + s1);
  if (diff < 0) diff += 24 * 3600;
  if (diff <= 0 || diff > 12 * 3600) return null;
  return { minutes: Math.floor(diff / 60), seconds: diff % 60 };
}
function fmtDuration(d: { minutes: number; seconds: number } | null): string {
  if (!d) return "—";
  if (d.minutes === 0) return `${d.seconds}s`;
  if (d.seconds === 0) return `${d.minutes}m`;
  return `${d.minutes}m ${d.seconds}s`;
}
/** RM1, RM2, …, RM10 instead of RM1, RM10, RM2. */
function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ap = a.match(re) || [], bp = b.match(re) || [];
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (i >= ap.length) return -1;
    if (i >= bp.length) return 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) { const d = Number(ap[i]) - Number(bp[i]); if (d !== 0) return d; }
    else { const c = ap[i].localeCompare(bp[i]); if (c !== 0) return c; }
  }
  return 0;
}
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** Local calendar date — toISOString() would flip to the next day mid-night-shift. */
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Fetch JSON, falling back instead of throwing so one bad lookup can't hang the form. */
async function getJson<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; }
}
/** Default shift number from wall clock: 1 = 06–14, 2 = 14–22, 3 = night. */
const shiftFromClock = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? "1" : h >= 14 && h < 22 ? "2" : "3"; };

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
const label = "mb-1 block text-xs font-medium text-gray-600";
const btnPrimary = "rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50";

type MachineEntry = { programName: string; toolName: string; liquidName: string; powderName: string; rollerHeight: string; targetCycleTime: string };
const emptyEntry = (): MachineEntry => ({ programName: "", toolName: "", liquidName: "", powderName: "", rollerHeight: "", targetCycleTime: "" });

export function RoboEntryForm() {
  // ---- lookups ----
  const [machines, setMachines] = useState<Machine[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [tools, setTools] = useState<Named[]>([]);
  const [liquids, setLiquids] = useState<Named[]>([]);
  const [powders, setPowders] = useState<Named[]>([]);
  const [delayCodes, setDelayCodes] = useState<DelayCode[]>([]);

  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");

  // ---- batch setup ----
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [batch, setBatch] = useState({ designName: "", targetSlabs: "", thickness: "", notes: "" });
  const [activeMachines, setActiveMachines] = useState<Record<string, boolean>>({});
  const [entries, setEntries] = useState<Record<string, MachineEntry>>({});

  // ---- slab entry ----
  const [slab, setSlab] = useState({ serialNumber: "", slabNumber: "", inTime: "", outTime: "", roymixCycleTime: "", roymixBodyWeight: "", remarks: "" });
  const [slabError, setSlabError] = useState("");
  const [slabSaving, setSlabSaving] = useState(false);
  /** Set while an In-Processing slab is loaded back into the form for
   *  finishing — save then PATCHes instead of creating a duplicate. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // ---- delays inside the slab entry ----
  const [delays, setDelays] = useState<PendingDelay[]>([]);
  const [delayForm, setDelayForm] = useState({ selectedCodeId: "", machineId: "", machineName: "", startTime: "", endTime: "", remarks: "" });
  const [delayError, setDelayError] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const refetchShift = async () => {
    const s = await getJson<ActiveShift | null>("/api/robo/shifts/active", null);
    setShift(s);
    return s;
  };

  useEffect(() => {
    (async () => {
      const [s] = await Promise.all([
        refetchShift(),
        getJson<Machine[]>("/api/robo/machines", []).then((ms) =>
          setMachines([...ms].sort((a, b) => MACHINE_ORDER.indexOf(a.name) - MACHINE_ORDER.indexOf(b.name)))),
        getJson<Design[]>("/api/robo/designs", []).then(setDesigns),
        getJson<Program[]>("/api/robo/programs", []).then(setPrograms),
        getJson<Named[]>("/api/robo/tools", []).then(setTools),
        getJson<Named[]>("/api/robo/liquids", []).then(setLiquids),
        getJson<Named[]>("/api/robo/powders", []).then(setPowders),
        getJson<DelayCode[]>("/api/robo/delay-codes", []).then((codes) =>
          setDelayCodes([...codes].sort((a, b) => {
            const ca = CATEGORY_ORDER.indexOf(a.category), cb = CATEGORY_ORDER.indexOf(b.category);
            if (ca !== cb) return (ca === -1 ? 999 : ca) - (cb === -1 ? 999 : cb);
            return naturalCompare(a.code, b.code);
          }))),
      ]);
      setBatchOpen(!(s?.batchRecipes?.length));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // seed per-machine entry state once machines arrive
  useEffect(() => {
    if (machines.length === 0) return;
    const e: Record<string, MachineEntry> = {}, a: Record<string, boolean> = {};
    for (const m of machines) { e[m.id] = emptyEntry(); a[m.id] = true; }
    setEntries(e); setActiveMachines(a);
  }, [machines]);

  // close the delay-code dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (codeRef.current && !codeRef.current.contains(e.target as Node)) setCodeOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const latestBatch = shift?.batchRecipes?.[shift.batchRecipes.length - 1] ?? null;
  const records = shift?.productionRecords ?? [];

  // suggest the next serial / slab number from what's already logged —
  // but never while an existing slab is loaded for editing
  useEffect(() => {
    if (editingId) return;
    const maxSerial = records.reduce((m, r) => Math.max(m, r.serialNumber ?? 0), 0);
    const lastSlab = records[0]?.slabNumber;
    setSlab((p) => ({
      ...p,
      serialNumber: String(maxSerial + 1),
      slabNumber: p.slabNumber || (lastSlab && /^\d+$/.test(lastSlab) ? String(Number(lastSlab) + 1) : ""),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift?.id, records.length, editingId]);

  const activeMachineNames = latestBatch
    ? latestBatch.entries
        .filter((e) => e.programName || e.targetCycleTime)
        .map((e) => e.machine.name)
        .sort((a, b) => MACHINE_ORDER.indexOf(a) - MACHINE_ORDER.indexOf(b))
    : [];
  const activeRoycuts = activeMachineNames.filter((n) => n !== "Roymix");
  const firstMachine = activeRoycuts[0] || activeMachineNames[0] || "";
  const lastMachine = activeRoycuts[activeRoycuts.length - 1] || activeMachineNames[activeMachineNames.length - 1] || "";
  const hasRoymix = activeMachineNames.includes("Roymix");

  const selectedCode = useMemo(() => delayCodes.find((d) => d.id === delayForm.selectedCodeId) ?? null, [delayCodes, delayForm.selectedCodeId]);
  const filteredCodes = useMemo(() => {
    const q = codeSearch.trim().toLowerCase();
    if (!q) return delayCodes;
    return delayCodes.filter((d) => d.code.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
  }, [delayCodes, codeSearch]);
  const delayDuration = useMemo(() => calcDuration(delayForm.startTime, delayForm.endTime), [delayForm.startTime, delayForm.endTime]);
  const totalDelay = delays.reduce((s, d) => s + d.durationMinutes, 0);

  const say = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(""), 4000); };

  // ---- master add-new handlers (shared by the comboboxes) ----
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("create failed");
    return r.json();
  };
  const ensureDesignId = async (): Promise<string> => {
    const name = batch.designName.trim();
    if (!name) throw new Error("no design");
    const hit = designs.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const created: Design = await post("/api/robo/designs", { name });
    setDesigns((p) => [...p, created]);
    return created.id;
  };
  const addDesign = async (name: string) => { const d: Design = await post("/api/robo/designs", { name }); setDesigns((p) => [...p, d]); };
  const addProgram = async (name: string) => {
    if (!batch.designName.trim()) { setBatchError("Pick the design first — new programs are filed under it."); throw new Error("design first"); }
    setBatchError("");
    const designId = await ensureDesignId();
    const created: Program = await post("/api/robo/programs", { name, designId });
    setPrograms((p) => [...p, created]);
  };
  const addTool = async (name: string) => { const t: Named = await post("/api/robo/tools", { name }); setTools((p) => [...p, t]); };
  const addLiquid = async (name: string) => { const l: Named = await post("/api/robo/liquids", { name }); setLiquids((p) => [...p, l]); };
  const addPowder = async (name: string) => { const w: Named = await post("/api/robo/powders", { name }); setPowders((p) => [...p, w]); };

  const setEntry = (machineId: string, field: keyof MachineEntry, value: string) =>
    setEntries((p) => ({ ...p, [machineId]: { ...(p[machineId] ?? emptyEntry()), [field]: value } }));

  /** Design picked → pre-fill tool/liquid/powder per machine from the plant
   *  in-charge's reference sheet. Never program, CT or roller height (those
   *  vary run to run), and everything stays editable — the preset is a head
   *  start, not a rule. */
  const applyDesignPreset = (designName: string) => {
    setBatch((p) => ({ ...p, designName }));
    const preset = findDesignPreset(designName);
    if (!preset) return;
    let touched = 0;
    setEntries((prev) => {
      const next = { ...prev };
      for (const m of machines) {
        const mp = preset.machines[m.name];
        if (!mp) continue;
        const cur = next[m.id] ?? emptyEntry();
        next[m.id] = {
          ...cur,
          toolName: mp.toolName ?? cur.toolName,
          liquidName: mp.liquidName ?? cur.liquidName,
          powderName: mp.powderName ?? cur.powderName,
        };
        touched += 1;
      }
      return next;
    });
    if (touched > 0) say(`Tool, liquid and powder pre-filled for ${touched} machine(s) from the ${preset.design} reference — check and adjust as needed.`);
  };

  // ---- the shift row is pure plumbing (schema requires it): reuse today's,
  // silently close a stale one from a previous day, create fresh as needed ----
  const ensureShiftId = async (): Promise<string> => {
    if (shift && shift.date === localDate()) return shift.id;
    if (shift) {
      // day rolled over — close yesterday's grouping row without any UI
      await fetch(`/api/robo/shifts/${shift.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED", endTime: nowHM() }),
      }).catch(() => null);
    }
    const res = await fetch("/api/robo/shifts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: localDate(),
        shiftNumber: shiftFromClock(),
        startTime: nowHM(),
        operatorName: "",
      }),
    });
    if (res.status === 409) { const s = await refetchShift(); if (s) return s.id; }
    if (!res.ok) throw new Error("shift create failed");
    const s = await res.json();
    return s.id as string;
  };

  const saveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError("");
    if (!batch.designName.trim()) { setBatchError("Design is required."); return; }
    const activeList = machines.filter((m) => activeMachines[m.id]);
    if (activeList.length === 0) { setBatchError("At least one machine must be active."); return; }
    setBatchSaving(true);
    try {
      const shiftId = await ensureShiftId();
      const res = await fetch("/api/robo/batch-recipes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId,
          designName: batch.designName.trim(),
          targetSlabs: batch.targetSlabs ? Number(batch.targetSlabs) : null,
          thickness: batch.thickness ? Number(batch.thickness) : null,
          notes: batch.notes || null,
          entries: activeList.map((m) => ({
            machineId: m.id,
            programName: entries[m.id]?.programName || "",
            toolName: entries[m.id]?.toolName || "",
            liquidName: entries[m.id]?.liquidName || "",
            powderName: entries[m.id]?.powderName || "",
            rollerHeight: entries[m.id]?.rollerHeight || "",
            targetCycleTime: entries[m.id]?.targetCycleTime ? Number(entries[m.id].targetCycleTime) : null,
          })),
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setBatchError(d.error || "Failed to save batch."); return; }
      await refetchShift();
      setBatchOpen(false);
      say(`Batch saved — ${batch.designName.trim()}.`);
    } catch {
      setBatchError("Failed to save the batch — try again.");
    } finally {
      setBatchSaving(false);
    }
  };

  // ---- delays ----
  const addDelay = () => {
    setDelayError("");
    if (!selectedCode) { setDelayError("Select a delay code."); return; }
    if (!delayForm.startTime || !delayForm.endTime) { setDelayError("Start and end time are required."); return; }
    const dur = calcDuration(delayForm.startTime, delayForm.endTime);
    if (!dur) { setDelayError("Invalid time range — check the start/end times (delays over 12h aren't accepted)."); return; }
    if (selectedCode.isRobotSpecific && !delayForm.machineId) { setDelayError("This code needs a machine."); return; }
    setDelays((prev) => [...prev, {
      tempId: prev.length ? Math.max(...prev.map((d) => d.tempId)) + 1 : 1,
      delayCodeId: selectedCode.id, code: selectedCode.code, description: selectedCode.description, category: selectedCode.category,
      machineId: delayForm.machineId, machineName: delayForm.machineName,
      durationMinutes: dur.minutes + (dur.seconds > 0 ? 1 : 0),
      startTime: delayForm.startTime, endTime: delayForm.endTime, remarks: delayForm.remarks,
    }]);
    setDelayForm({ selectedCodeId: "", machineId: "", machineName: "", startTime: "", endTime: "", remarks: "" });
    setCodeSearch("");
  };

  /** Load an In-Processing slab back into the form to finish it. */
  const editRecord = (r: ProdRecord) => {
    setEditingId(r.id);
    setDelays([]);
    setSlab({
      serialNumber: r.serialNumber != null ? String(r.serialNumber) : "",
      slabNumber: r.slabNumber,
      inTime: r.inTime ?? "",
      outTime: r.outTime ?? "",
      roymixCycleTime: r.roymixCycleTime != null ? String(r.roymixCycleTime) : "",
      roymixBodyWeight: r.roymixBodyWeight != null ? String(r.roymixBodyWeight) : "",
      remarks: r.remarks ?? "",
    });
    setSlabError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDelays([]);
    setSlab({ serialNumber: "", slabNumber: "", inTime: "", outTime: "", roymixCycleTime: "", roymixBodyWeight: "", remarks: "" });
  };

  const saveSlab = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlabError("");
    if (!shift) { setSlabError("Save a batch setup first."); return; }
    if (!slab.slabNumber.trim()) { setSlabError("Slab number is required."); return; }
    setSlabSaving(true);
    const delayPayload = delays.map((d) => ({
      delayCodeId: d.delayCodeId, machineId: d.machineId || null, machineName: d.machineName || null,
      durationMinutes: d.durationMinutes, startTime: d.startTime || null, endTime: d.endTime || null, remarks: d.remarks || null,
    }));
    // No status sent: the server derives it from Out time, so a slab still in
    // the line saves as In-Processing and can be finished from the table below.
    const res = await (editingId
      ? fetch(`/api/robo/production/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serialNumber: slab.serialNumber ? Number(slab.serialNumber) : null,
            slabNumber: slab.slabNumber.trim(),
            inTime: slab.inTime || null,
            outTime: slab.outTime || null,
            roymixCycleTime: slab.roymixCycleTime ? Number(slab.roymixCycleTime) : null,
            roymixBodyWeight: slab.roymixBodyWeight ? Number(slab.roymixBodyWeight) : null,
            remarks: slab.remarks || null,
            delays: delayPayload,
          }),
        })
      : fetch("/api/robo/production", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serialNumber: slab.serialNumber ? Number(slab.serialNumber) : null,
            slabNumber: slab.slabNumber.trim(),
            shiftId: shift.id,
            batchRecipeId: latestBatch?.id || null,
            inTime: slab.inTime || null,
            outTime: slab.outTime || null,
            roymixCycleTime: slab.roymixCycleTime ? Number(slab.roymixCycleTime) : null,
            roymixBodyWeight: slab.roymixBodyWeight ? Number(slab.roymixBodyWeight) : null,
            remarks: slab.remarks || null,
            delays: delayPayload,
          }),
        })
    ).catch(() => null);
    if (!res?.ok) { setSlabError(editingId ? "Failed to update the slab." : "Failed to save the slab."); setSlabSaving(false); return; }
    const saved = slab.slabNumber.trim();
    const wasEdit = Boolean(editingId);
    const finished = Boolean(slab.outTime);
    setEditingId(null);
    setDelays([]);
    setSlab((p) => ({ ...p, slabNumber: "", inTime: "", outTime: "", roymixCycleTime: "", roymixBodyWeight: "", remarks: "" }));
    await refetchShift();
    setSlabSaving(false);
    say(wasEdit
      ? `Slab ${saved} updated${finished ? " and completed" : ""}.`
      : finished ? `Slab ${saved} saved.` : `Slab ${saved} saved as In-Processing — finish it from the table below when it leaves the line.`);
  };

  if (loading) return <Empty>Loading robo line…</Empty>;

  const programOptions: SsOption[] = programs.map((p) => ({ id: p.id, name: p.name, hint: p.design?.name ?? undefined }));

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{flash}</div>}

      {/* ---- context bar: the batch currently running ---- */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {latestBatch ? (
          <>
            <Badge tone="green">Batch running</Badge>
            <span className="flex min-w-0 items-center gap-2 text-sm text-gray-600">
              <span className="font-medium text-gray-900">{latestBatch.designName}</span>
              <span className="truncate text-gray-400">{activeMachineNames.join(" → ")}</span>
              {latestBatch.thickness != null && <span className="text-gray-400">{latestBatch.thickness} cm</span>}
            </span>
            <span className="text-sm text-gray-400">{records.length} slab{records.length === 1 ? "" : "s"} logged</span>
            <button type="button" className={`${btnGhost} ml-auto`} onClick={() => setBatchOpen((o) => !o)}>
              {batchOpen ? "Hide batch setup" : "New batch"}
            </button>
          </>
        ) : (
          <>
            <Badge tone="amber">No batch running</Badge>
            <span className="text-sm text-gray-500">Robo doesn’t run in every production — set up a batch below when it does.</span>
          </>
        )}
      </Card>

      {/* ---- batch setup (one-time per run, collapses after save) ---- */}
      {batchOpen && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Batch setup</h2>
            <span className="text-xs text-gray-400">{machines.filter((m) => activeMachines[m.id]).length} of {machines.length} machines active</span>
          </div>
          {batchError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{batchError}</div>}

          <form onSubmit={saveBatch} className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="col-span-2">
                <span className={label}>Design <span className="text-red-500">*</span></span>
                <SearchableSelect value={batch.designName} options={designs} placeholder="Search designs or add new…"
                  onSelect={applyDesignPreset} onCreate={addDesign} />
              </div>
              <div>
                <span className={label}>Thickness (cm)</span>
                <input type="number" step="0.1" value={batch.thickness} onChange={(e) => setBatch((p) => ({ ...p, thickness: e.target.value }))} placeholder="e.g. 2" className={inp} />
              </div>
              <div>
                <span className={label}>Target slabs</span>
                <input type="number" value={batch.targetSlabs} onChange={(e) => setBatch((p) => ({ ...p, targetSlabs: e.target.value }))} placeholder="e.g. 120" className={inp} />
              </div>
            </div>

            <div className="space-y-3">
              {machines.map((m) => {
                const entry = entries[m.id] ?? emptyEntry();
                const isRoymix = m.name === "Roymix";
                const isRoycut3 = m.name === "Roycut-3";
                const on = activeMachines[m.id] ?? true;
                return (
                  <div key={m.id} className={`rounded-xl border p-4 transition ${on ? "border-gray-200" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                    <div className="mb-3 flex items-center gap-3">
                      <input type="checkbox" checked={on} onChange={() => setActiveMachines((p) => ({ ...p, [m.id]: !p[m.id] }))}
                        className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" />
                      <h3 className="text-sm font-medium text-gray-900">{m.name}</h3>
                      {isRoymix && <Badge tone="green">liquid optional · CT varies per slab</Badge>}
                      {!on && <span className="ml-auto text-xs text-gray-400">Not in use</span>}
                    </div>
                    {on && (
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <div className={isRoymix ? "col-span-2" : ""}>
                          <span className={label}>Program</span>
                          <SearchableSelect value={entry.programName} options={programOptions} placeholder="Search programs or add new…"
                            onSelect={(name) => setEntry(m.id, "programName", name)} onCreate={addProgram} />
                        </div>
                        {!isRoymix && (
                          <div>
                            <span className={label}>Tool</span>
                            <SearchableSelect value={entry.toolName} options={tools} placeholder="Search tools…"
                              onSelect={(name) => setEntry(m.id, "toolName", name)} onCreate={addTool} />
                          </div>
                        )}
                        {!isRoymix && (
                          <div>
                            <span className={label}>Target cycle time (sec)</span>
                            <input type="number" value={entry.targetCycleTime} onChange={(e) => setEntry(m.id, "targetCycleTime", e.target.value)} placeholder="e.g. 214" className={inp} />
                          </div>
                        )}
                        <div>
                          <span className={label}>Liquid</span>
                          <SearchableSelect value={entry.liquidName} options={liquids} placeholder="Search liquids…"
                            onSelect={(name) => setEntry(m.id, "liquidName", name)} onCreate={addLiquid} />
                        </div>
                        {!isRoymix && (
                          <div>
                            <span className={label}>Powder</span>
                            <SearchableSelect value={entry.powderName} options={powders} placeholder="Search powders…"
                              onSelect={(name) => setEntry(m.id, "powderName", name)} onCreate={addPowder} />
                          </div>
                        )}
                        {!isRoymix && !isRoycut3 && (
                          <div>
                            <span className={label}>Roller height (mm)</span>
                            <input value={entry.rollerHeight} onChange={(e) => setEntry(m.id, "rollerHeight", e.target.value)} placeholder="e.g. 20" className={inp} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3">
              <div className="mr-auto w-full max-w-sm">
                <input value={batch.notes} onChange={(e) => setBatch((p) => ({ ...p, notes: e.target.value }))} placeholder="Batch notes (optional)" className={inp} />
              </div>
              {latestBatch && <button type="button" className={btnGhost} onClick={() => setBatchOpen(false)}>Cancel</button>}
              <button type="submit" disabled={batchSaving} className={btnPrimary}>{batchSaving ? "Saving…" : "Save batch setup"}</button>
            </div>
          </form>
        </Card>
      )}

      {/* ---- slab entry (the fast, repeated action) ---- */}
      <Card className={!shift || !latestBatch ? "opacity-60" : ""}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Slab entry</h2>
          {latestBatch && latestBatch.entries.some((e) => e.machine.name !== "Roymix" && e.targetCycleTime) && (
            <div className="flex gap-2">
              {latestBatch.entries
                .filter((e) => e.machine.name !== "Roymix" && e.targetCycleTime)
                .sort((a, b) => MACHINE_ORDER.indexOf(a.machine.name) - MACHINE_ORDER.indexOf(b.machine.name))
                .map((e) => (
                  <span key={e.machine.name} className="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-500">
                    {e.machine.name} CT <span className="font-semibold text-gray-700">{e.targetCycleTime}s</span>
                  </span>
                ))}
            </div>
          )}
        </div>

        {!shift || !latestBatch ? (
          <Empty>No batch running. Save a batch setup above to start logging slabs.</Empty>
        ) : (
          <form onSubmit={saveSlab} className="space-y-4">
            {editingId && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span>Finishing slab <span className="font-semibold">{slab.slabNumber}</span> — add the Out time and save to complete it.</span>
                <button type="button" onClick={cancelEdit} className="ml-auto text-xs font-medium text-amber-700 underline hover:text-amber-900">Cancel edit</button>
              </div>
            )}
            {slabError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{slabError}</div>}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <span className={label}>S.No.</span>
                <input type="number" value={slab.serialNumber} onChange={(e) => setSlab((p) => ({ ...p, serialNumber: e.target.value }))} className={inp} />
              </div>
              <div>
                <span className={label}>Slab number <span className="text-red-500">*</span></span>
                <input value={slab.slabNumber} onChange={(e) => setSlab((p) => ({ ...p, slabNumber: e.target.value }))} placeholder="e.g. 140748" className={inp} required />
              </div>
              <div>
                <span className={label}>In time{firstMachine ? ` (${firstMachine})` : ""}</span>
                <input type="time" value={slab.inTime} onChange={(e) => setSlab((p) => ({ ...p, inTime: e.target.value }))} className={inp} />
              </div>
              <div>
                <span className={label}>Out time{lastMachine ? ` (${lastMachine})` : ""}</span>
                <input type="time" value={slab.outTime} onChange={(e) => setSlab((p) => ({ ...p, outTime: e.target.value }))} className={inp} />
              </div>
              {hasRoymix && (
                <>
                  <div>
                    <span className={label}>RoyMix body weight (kg)</span>
                    <input type="number" step="0.1" value={slab.roymixBodyWeight} onChange={(e) => setSlab((p) => ({ ...p, roymixBodyWeight: e.target.value }))} placeholder="e.g. 42.5" className={inp} />
                  </div>
                  <div>
                    <span className={label}>RoyMix cycle time (sec)</span>
                    <input type="number" value={slab.roymixCycleTime} onChange={(e) => setSlab((p) => ({ ...p, roymixCycleTime: e.target.value }))} placeholder="e.g. 185" className={inp} />
                  </div>
                </>
              )}
              <div className={hasRoymix ? "col-span-2" : "col-span-2 md:col-span-4"}>
                <span className={label}>Remarks</span>
                <input value={slab.remarks} onChange={(e) => setSlab((p) => ({ ...p, remarks: e.target.value }))} placeholder="Optional notes for this slab" className={inp} />
              </div>
            </div>

            {/* delays — error codes straight in the dropdown, with descriptions */}
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800">Delays this slab</h3>
                {delays.length > 0 && <Badge tone="amber">{delays.length} · {totalDelay} min</Badge>}
              </div>

              {delays.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  {delays.map((d) => {
                    const dur = calcDuration(d.startTime, d.endTime);
                    return (
                      <div key={d.tempId} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                        <span className="w-10 shrink-0 text-xs font-bold text-gray-800">{d.code}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${CATEGORY_COLOR[d.category] || "bg-gray-100 text-gray-600"}`}>{d.category}</span>
                        {d.machineName && <span className="shrink-0 text-xs text-gray-500">{d.machineName}</span>}
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{d.description}</span>
                        <span className="shrink-0 text-xs text-gray-400">{d.startTime}–{d.endTime}</span>
                        <span className="shrink-0 text-xs font-medium text-amber-700">{dur ? fmtDuration(dur) : `${d.durationMinutes}m`}</span>
                        <button type="button" onClick={() => setDelays((prev) => prev.filter((x) => x.tempId !== d.tempId))}
                          className="shrink-0 text-xs text-gray-300 hover:text-red-500">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {delayError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{delayError}</div>}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <div ref={codeRef} className="relative col-span-2 md:col-span-3">
                  <span className={label}>Delay code</span>
                  {selectedCode ? (
                    <div className="flex items-center gap-1.5">
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm">
                        <span className="shrink-0 text-sm font-bold text-gray-800">{selectedCode.code}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${CATEGORY_COLOR[selectedCode.category] || "bg-gray-100 text-gray-600"}`}>{selectedCode.category}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{selectedCode.description}</span>
                      </div>
                      <button type="button" aria-label="Clear code" onClick={() => { setDelayForm((p) => ({ ...p, selectedCodeId: "", machineId: "", machineName: "" })); setCodeSearch(""); }}
                        className="shrink-0 rounded-md px-1.5 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-500">✕</button>
                    </div>
                  ) : (
                    <>
                      <input value={codeSearch} onChange={(e) => { setCodeSearch(e.target.value); setCodeOpen(true); }} onFocus={() => setCodeOpen(true)}
                        placeholder="Search code, description or category…" className={inp} autoComplete="off" />
                      {codeOpen && (
                        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                          {filteredCodes.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400">No matching delay codes.</div>
                          ) : (
                            filteredCodes.map((dc) => (
                              <button key={dc.id} type="button" onClick={() => { setDelayForm((p) => ({ ...p, selectedCodeId: dc.id })); setCodeSearch(""); setCodeOpen(false); }}
                                className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left transition last:border-0 hover:bg-brand/5">
                                <span className="w-12 shrink-0 text-sm font-bold text-gray-800">{dc.code}</span>
                                <span className="min-w-0 flex-1 truncate text-sm text-gray-600">{dc.description}</span>
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${CATEGORY_COLOR[dc.category] || "bg-gray-100 text-gray-600"}`}>{dc.category}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {selectedCode?.isRobotSpecific && (
                  <div className="col-span-2 md:col-span-3">
                    <span className={label}>Machine</span>
                    <select value={delayForm.machineId}
                      onChange={(e) => { const m = machines.find((x) => x.id === e.target.value); setDelayForm((p) => ({ ...p, machineId: e.target.value, machineName: m?.name || "" })); }}
                      className={inp}>
                      <option value="">Select machine</option>
                      {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <span className={label}>Start <span className="text-red-500">*</span></span>
                  <input type="time" step="1" value={delayForm.startTime} onChange={(e) => setDelayForm((p) => ({ ...p, startTime: e.target.value }))} className={inp} />
                </div>
                <div>
                  <span className={label}>End <span className="text-red-500">*</span></span>
                  <input type="time" step="1" value={delayForm.endTime} onChange={(e) => setDelayForm((p) => ({ ...p, endTime: e.target.value }))} className={inp} />
                </div>
                <div>
                  <span className={label}>Duration</span>
                  <div className={`w-full rounded-lg border px-3 py-2 text-sm ${
                    delayDuration ? "border-green-200 bg-green-50 font-semibold text-green-800"
                      : delayForm.startTime && delayForm.endTime ? "border-red-200 bg-red-50 text-red-600"
                      : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                    {delayDuration ? fmtDuration(delayDuration) : delayForm.startTime && delayForm.endTime ? "Invalid" : "Auto"}
                  </div>
                </div>
                <div className="flex items-end gap-2 md:col-span-3">
                  <input value={delayForm.remarks} onChange={(e) => setDelayForm((p) => ({ ...p, remarks: e.target.value }))} placeholder="Delay remarks (optional)" className={inp} />
                  <button type="button" onClick={addDelay} className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700">+ Add</button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {!editingId && !slab.outTime && slab.slabNumber && (
                <span className="text-xs text-gray-400">No Out time — will save as In-Processing.</span>
              )}
              <button type="submit" disabled={slabSaving} className={btnPrimary}>
                {slabSaving ? "Saving…" : editingId ? "Update slab" : "Save slab"}
              </button>
            </div>
          </form>
        )}
      </Card>

      {/* ---- recently logged slabs ---- */}
      {records.length > 0 && (
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Recent slabs · last {Math.min(records.length, 10)}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">#</th>
                  <th className="py-2 pr-4 font-medium">Slab</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">In → Out</th>
                  <th className="py-2 pr-4 font-medium">RoyMix CT</th>
                  <th className="py-2 pr-4 font-medium">Body wt</th>
                  <th className="py-2 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 10).map((r) => (
                  <tr key={r.id} className={`border-b border-gray-50 last:border-0 ${editingId === r.id ? "bg-amber-50/60" : ""}`}>
                    <td className="py-2 pr-4 text-gray-400">{r.serialNumber ?? "—"}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{r.slabNumber}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${slabStatusClass(r.status)}`}>{slabStatusLabel(r.status)}</span>
                      {r.status === SLAB_IN_PROCESSING && editingId !== r.id && (
                        <button type="button" onClick={() => editRecord(r)}
                          className="ml-2 text-xs font-medium text-brand hover:underline">finish →</button>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.inTime || "—"}{" → "}{r.outTime || "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.roymixCycleTime ? `${r.roymixCycleTime}s` : "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.roymixBodyWeight ? `${r.roymixBodyWeight} kg` : "—"}</td>
                    <td className="py-2 text-gray-500">{r.remarks || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
