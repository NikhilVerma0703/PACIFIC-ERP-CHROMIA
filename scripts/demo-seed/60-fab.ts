/**
 * DEMO SEED — module 60: fabrication.
 *
 * Writes into the `pacificdemo` database ONLY. Everything here is invented:
 * no real customer, design, slab number or price appears in this file.
 *
 * `db` is the already-connected PrismaClient handed in by the runner. This file
 * imports nothing at all — in particular never "@/lib/prisma", which is the
 * production singleton.
 *
 * Tables written (each in its own try/catch, so one missing column costs one
 * table and not the run):
 *   fab_machine, fab_worker, fab_project, fab_po, fab_requirement,
 *   fab_slab, fab_slab_job, cutting_entry, polish_entry, polish_qc
 *
 * ──────────────────────────────────────────────────────────────── UNITS ────
 * THE ONE THING THIS MODULE CAN GET WRONG WITHOUT ANYTHING ERRORING. The
 * fabrication tables store three different units and the schema says so
 * nowhere — src/lib/fab/slabLoss.ts calls it a landmine and names the unit in
 * every parameter it takes:
 *
 *   fab_requirement.length / .width     INCHES
 *   fab_requirement.thickness           MILLIMETRES  (api/sampling/requests:
 *                                       "sampling_size stores the edges in
 *                                       INCHES and the thickness in
 *                                       MILLIMETRES; fab_requirement stores
 *                                       exactly the same way")
 *   fab_slab.length / .width            MILLIMETRES  (every writer in the app
 *                                       stores STANDARD_SLAB_MM)
 *   fab_slab.thickness                  MILLIMETRES  (parseThicknessMm; the
 *                                       rate card in lib/fab/pricing.ts is
 *                                       keyed on 20 / 30, not 2 / 3)
 *   fab_slab.total_area / .available_area / .reserved_area
 *                                       SQUARE MILLIMETRES (length x width)
 *   fab_slab_job.used_area_sqft         SQUARE FEET
 *   fab_slab_job.*_pct                  PERCENT
 *
 * Seeding a slab in inches and square feet does not fail: computeSlabLoss puts
 * inch pieces on a "millimetre" slab 25.4x too small and every slab on the
 * board reads ~100% wasted, which is plausible enough that nobody questions it.
 */

type Ctx = {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
  [key: string]: any;
};

export async function seed(db: any, ctx: Ctx): Promise<void> {
  // ── local helpers ──────────────────────────────────────────────────────────

  const warn = (table: string, e: unknown) =>
    console.warn(`  [fab] ${table} skipped:`, (e as Error).message);

  /** Deterministic PRNG, so two runs of the demo seed produce the same floor. */
  let _s = 20260918;
  const rnd = () => {
    _s = (_s * 1103515245 + 12345) & 0x7fffffff;
    return _s / 0x7fffffff;
  };
  const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];
  const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

  /** A point in the last 90 days, with an hour on it so charts have a shape. */
  const at = (daysBack: number, hour = 9, minute = 0): Date => {
    const d = new Date(ctx.daysAgo(daysBack).getTime());
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  /**
   * Mirrors src/lib/normalizeBatch.ts exactly (uppercase, strip spaces/commas,
   * strip a leading run of letters + optional hyphen). Copied rather than
   * imported because this file may not import from @/lib — if the app
   * recomputes the key for a batch it must land on the same string.
   */
  const batchKeyOf = (s: string): string => {
    const str = String(s ?? "").trim().toUpperCase().replace(/[\s,]+/g, "");
    const stripped = str.replace(/^[A-Z]+-?/, "").trim();
    const base = stripped || str;
    const m = base.match(/^(\d+)-?([A-Z]+)$/);
    return m ? `${m[1]}-${m[2]}` : base;
  };

  const id = (kind: string, n: number) => `demo_fab_${kind}_${String(n).padStart(4, "0")}`;

  // ── inputs from ctx, with invented fallbacks so the module stands alone ────

  const designs: string[] = ctx.designs?.length
    ? ctx.designs
    : [
        "Aurora Mist", "Verona Grey", "Lumen Ivory", "Basalt Noir", "Cascade Sand",
        "Nordic Frost", "Cobalt Vein", "Dune Pearl", "Slate Harbour", "Opal Drift",
        "Umber Ridge", "Glacier Bloom",
      ];
  const batches: string[] = ctx.batches?.length
    ? ctx.batches
    : ["PES.0101", "PES.0102", "PES.0103", "PES.0104", "PES.0105", "PES.0106"];
  const users = ctx.users ?? [];
  const userId = (i: number): string | null => (users.length ? users[i % users.length].id : null);

  const clientNames: string[] = (ctx.clients ?? []).map((c) => c.name).filter(Boolean);
  const customers: string[] = clientNames.length
    ? clientNames
    : [
        "Northwind Interiors Pvt Ltd",
        "Bluegrass Kitchens LLP",
        "Meridian Contracts Pvt Ltd",
        "Harbourline Developers",
        "Copperleaf Hospitality",
        "Stonegate Retail Pvt Ltd",
      ];

  const THICKNESS = ["2 cm", "3 cm", "1.2 cm"];
  const THICKNESS_MM: Record<string, number> = { "2 cm": 20, "3 cm": 30, "1.2 cm": 12 };

  // ── the unit constants, copied from src/lib/fab/slabLoss.ts ───────────────
  // (copied, not imported: this file may not import from @/lib, and the app's
  // own slabLoss.ts imports nothing for the same kind of reason.)
  const INCH_TO_MM = 25.4;
  /** 25.4 x 25.4 x 144 = 92,903.04 mm² in one square foot. */
  const SQ_MM_PER_SQ_FT = INCH_TO_MM * INCH_TO_MM * 144;
  /** The standard Pacific slab, 137 x 79 INCHES, as fab_slab stores it. */
  const STANDARD_SLAB_MM = {
    lengthMm: round(137 * INCH_TO_MM, 2),   // 3479.8
    widthMm: round(79 * INCH_TO_MM, 2),     // 2006.6
  };
  /** SQUARE MILLIMETRES — what total_area / available_area hold. */
  const STANDARD_SLAB_SQMM = round(STANDARD_SLAB_MM.lengthMm * STANDARD_SLAB_MM.widthMm, 2);
  const sqftFromSqMm = (areaSqMm: number) => areaSqMm / SQ_MM_PER_SQ_FT;
  /** The same slab in the unit fab_slab_job reports: ~75.16 sqft. */
  const STANDARD_SLAB_SQFT = round(sqftFromSqMm(STANDARD_SLAB_SQMM), 2);

  /**
   * fab_requirement.slab_code is String NOT NULL and a purchase order has no
   * slab code — the slab is picked later on the allocation board. The PO
   * importer and the sample-request route both write this exact word
   * (PO_REQUIREMENT_SLAB_CODE / SAMPLE_REQUIREMENT_SLAB_CODE), and nothing in
   * the app reads the column; inventing a code here would show a slab as
   * chosen on a row the board correctly reports as unallocated.
   */
  const REQUIREMENT_SLAB_CODE = "UNASSIGNED";
  /** api/fab/slabs: the one rw_status that takes a slab out of the picker. */
  const REWORK_PENDING = "RW Required and ongoing";
  // Canonical QC dropdown values (src/lib/tables.ts PRESET_OPTIONS).
  const RW_STATUS = ["Direct Ok", "RW Done Ok", "RW Required and ongoing", "Can't be Reworked"];
  const REPOLISH_STATUS = ["Direct Ok", "Polish Ok", "Repolish Done", "Repolish Required"];
  const GRADES = ["A", "A2", "B", "C (Reject)", "Not graded yet"];
  const POLISH_TYPE = ["Polish", "Suede", "Honed", "Leathered"];
  const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"];
  const ISSUES = ["Pinhole", "Shade variation", "Scratch", "Edge chip", "Rubber", "Hairline crack"];

  const WORKER_NAMES = [
    "Arun Selvam", "Devi Prasad", "Farid Khan", "Gopal Menon", "Hari Nandan",
    "Iqbal Sheriff", "Jeeva Raman", "Karthik Bose", "Latha Murugan", "Manoj Pillai",
  ];
  const INSPECTORS = ["Nithya Rao", "Suresh Babu", "Priya Varghese", "Anand Kumar"];
  const CALLIBERATORS = ["Vimal Raj", "Sathish M", "Rekha Nair", "Joseph Antony"];

  // ─────────────────────────────────────────────────────────────────────────
  // fab_machine — parents for fab_slab_job.machine_id
  // ─────────────────────────────────────────────────────────────────────────
  const machines = [
    { id: id("mch", 1), code: "DEMO-CUT-01", name: "Bridge Saw 01", type: "CUTTING" },
    { id: id("mch", 2), code: "DEMO-CUT-02", name: "Bridge Saw 02", type: "CUTTING" },
    { id: id("mch", 3), code: "DEMO-POL-01", name: "Edge Polisher 01", type: "POLISHING" },
    { id: id("mch", 4), code: "DEMO-SNK-01", name: "Sink Router 01", type: "SINK_CUTTING" },
    { id: id("mch", 5), code: "DEMO-FAB-01", name: "Hand Bench 01", type: "FABRICATION" },
    { id: id("mch", 6), code: "DEMO-PKG-01", name: "Packing Line 01", type: "PACKAGING" },
  ];
  try {
    await db.fabMachine.createMany({
      data: machines.map((m, i) => ({ ...m, createdAt: at(88 - i, 8) })),
      skipDuplicates: true,
    });
  } catch (e) { warn("fab_machine", e); }

  const cuttingMachines = machines.filter((m) => m.type === "CUTTING");

  // ─────────────────────────────────────────────────────────────────────────
  // fab_worker — ~10 floor names (the operator login is shared; these are who
  // actually stood at the machine)
  // ─────────────────────────────────────────────────────────────────────────
  const workers = WORKER_NAMES.map((name, i) => ({
    id: id("wkr", i + 1),
    name,
    active: i < 9, // one retired name, so the "active" filter has something to do
    createdAt: at(89 - i, 7, 30),
    createdById: userId(i),
  }));
  try {
    await db.fabWorker.createMany({ data: workers, skipDuplicates: true });
  } catch (e) { warn("fab_worker", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // fab_project — 6 projects across the status ladder
  // ─────────────────────────────────────────────────────────────────────────
  const PROJECT_STATUS = ["COMPLETED", "RELEASED_TO_PRODUCTION", "RELEASED_TO_PRODUCTION", "ALLOCATED", "PLANNING", "COMPLETED"];

  // The PO layout is declared here, above the projects, because
  // fab_project.number_of_pieces is not a free-standing header figure: every
  // writer in the app moves it by a requirement row's quantity
  // (pos/import, pos/[poId]/rows, sampling/requests all increment or set it
  // from the rows), and the project page prints it as "Pieces Ordered". A
  // number that disagrees with the rows underneath it is the first thing a
  // viewer would check and the first thing they would catch.
  const poSpread = [0, 0, 1, 2, 2, 3, 4, 5];   // project index per PO
  const REQ_ROWS_PER_PO = 3;
  /** The quantity on PO p's row r — ONE formula, used by the requirement rows
   *  below and by the piece counts here, so the two cannot drift apart. */
  const reqQty = (p: number, r: number) => 2 + ((p + r) % 5);
  const piecesFor = (projectIndex: number) =>
    poSpread.reduce((n, proj, p) => proj !== projectIndex ? n
      : n + Array.from({ length: REQ_ROWS_PER_PO }, (_, r) => reqQty(p, r)).reduce((a, b) => a + b, 0), 0);

  const projects = Array.from({ length: 6 }, (_, i) => ({
    id: id("prj", i + 1),
    projectCode: `DEMO-P${String(i + 1).padStart(3, "0")}`,
    kind: i === 5 ? "SAMPLE" : "PO",
    customerName: pick(customers, i),
    status: PROJECT_STATUS[i],
    numberOfPieces: piecesFor(i),
    remarks: i === 5 ? "Sampling desk job — sink and fabrication off." : null,
    createdAt: at(85 - i * 12, 10, 15),
  }));
  try {
    await db.fabProject.createMany({ data: projects, skipDuplicates: true });
  } catch (e) { warn("fab_project", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // fab_po — 8 customer POs spread over the projects (unique per project)
  // ─────────────────────────────────────────────────────────────────────────
  const pos = poSpread.map((p, i) => ({
    id: id("po", i + 1),
    projectId: projects[p].id,
    poNumber: `PO-DEMO-${2026}-${String(i + 1).padStart(3, "0")}`,
    pdfFileName: i % 4 === 3 ? null : `demo-po-${String(i + 1).padStart(3, "0")}.pdf`,
    pdfImportedAt: i % 4 === 3 ? null : at(80 - i * 8, 11),
    createdAt: at(82 - i * 8, 10, 45),
  }));
  try {
    await db.fabPo.createMany({ data: pos, skipDuplicates: true });
  } catch (e) { warn("fab_po", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // fab_requirement — ~3 rows per PO so a PO page is not an empty table
  // ─────────────────────────────────────────────────────────────────────────
  const LETTERS = ["A", "B", "C", "D"];
  /** A row is PENDING, ALLOCATED or RELEASED according to where its PROJECT has
   *  got to — a completed project holding pending rows is a state the ladder
   *  does not have. */
  const REQ_STATUS_FOR: Record<string, string> = {
    PLANNING: "PENDING",
    ALLOCATED: "ALLOCATED",
    RELEASED_TO_PRODUCTION: "RELEASED",
    COMPLETED: "RELEASED",
  };
  const requirements: any[] = [];
  let rIdx = 0;
  for (let p = 0; p < pos.length; p++) {
    for (let r = 0; r < REQ_ROWS_PER_PO; r++) {
      rIdx++;
      const thick = pick(THICKNESS, p + r);
      const length = 48 + r * 12;   // inches
      const width = 25 + r * 3;     // inches
      const qty = reqQty(p, r);
      const sqft = round((length * width) / 144, 3);
      requirements.push({
        id: id("req", rIdx),
        projectId: pos[p].projectId,
        poId: pos[p].id,
        pieceLabel: `Row ${r + 1}`,
        rowLetter: LETTERS[r],
        finishedEdges: r === 0 ? "front,left,right" : r === 1 ? "front" : "",
        edgeFaces: r === 1 ? "BOTH" : null,
        description: r === 0 ? "Counter top" : r === 1 ? "Island top" : "Splashback",
        slabCode: REQUIREMENT_SLAB_CODE,
        length,                          // INCHES
        width,                           // INCHES
        dimUnit: "IN",                   // fab_requirement_dim_unit_ck: NULL | IN | CM
        thickness: THICKNESS_MM[thick],  // MILLIMETRES — 20 / 30 / 12, the rate card's keys
        quantity: qty,
        shapeType: r === 2 ? "L_SHAPE" : "RECTANGLE",
        sinkRequired: r === 1,
        fabricationRequired: r !== 2,
        polishRequired: true,
        sinkQuantity: r === 1 ? 1 : 0,
        sinkCuts: r === 1 ? 1 : 0,
        faucetCount: r === 1 ? 1 : 0,
        sqftPerPiece: sqft,
        totalSqft: round(sqft * qty, 3),
        status: REQ_STATUS_FOR[projects[poSpread[p]].status],
        notes: null,
        createdAt: at(80 - p * 8, 12, r * 7),
      });
    }
  }
  try {
    await db.fabRequirement.createMany({ data: requirements, skipDuplicates: true });
  } catch (e) { warn("fab_requirement", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // THE POLISHED SLABS — 120 of them, built here because everything below is
  // downstream of them: a fab_slab IS a polish_qc row that fabrication took
  // (api/fab/supervisor/slab-assignment copies the slab number, the design and
  // the thickness across and stores the QC row's id in pacific_qc_id). The
  // polish_qc and polish_entry rows themselves are written further down.
  // ─────────────────────────────────────────────────────────────────────────
  const SLAB_BASE = 80100;
  const COUNT = 120;

  type Row = {
    n: number; slabNumber: number; batch: string; batchKey: string; design: string;
    thickness: string; thicknessMm: number; grade: string; when: Date;
    qcId: string; qcAirtableId: string;
    rw: string; repolish: string; issues: string[]; dispatched: boolean;
  };
  const rows: Row[] = Array.from({ length: COUNT }, (_, i) => {
    const batch = pick(batches, Math.floor(i / 7));
    // Dates walk backwards across the 90 days with a per-row wobble, so the QC
    // charts get a slope rather than one spike.
    const daysBack = Math.max(1, 89 - Math.floor(i * 0.73) + ((i % 5) - 2));
    // Grade mix: mostly A, a tail of A2/B, a few rejects, a couple ungraded.
    const g = i % 20;
    const grade = g < 11 ? "A" : g < 15 ? "A2" : g < 18 ? "B" : g === 18 ? "C (Reject)" : "Not graded yet";
    const thickness = pick(THICKNESS, i);
    // rw_status: most slabs go straight through. "Can't be Reworked" is a
    // REPAIRABILITY flag, not scrap — it is a final state and stays in stock.
    const rw = i % 13 === 0 ? RW_STATUS[2] : i % 17 === 0 ? RW_STATUS[3] : i % 4 === 1 ? RW_STATUS[1] : RW_STATUS[0];
    const repolish = i % 11 === 0 ? REPOLISH_STATUS[3] : i % 5 === 2 ? REPOLISH_STATUS[2] : pick(REPOLISH_STATUS, i);
    const issues =
      grade === "A" || grade === "Not graded yet"
        ? []
        : [...new Set([pick(ISSUES, i), ...(i % 9 === 0 ? [pick(ISSUES, i + 3)] : [])])];
    return {
      n: i,
      slabNumber: SLAB_BASE + i,
      batch,
      batchKey: batchKeyOf(batch),
      design: pick(designs, i),
      thickness,
      thicknessMm: THICKNESS_MM[thickness],
      grade,
      when: at(daysBack, 6 + (i % 14), (i * 23) % 60),
      qcId: id("qc", i + 1),
      qcAirtableId: `recDEMOQC${String(i + 1).padStart(6, "0")}`,
      rw,
      repolish,
      issues,
      dispatched: i % 3 === 0 && grade !== "C (Reject)",
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fab_slab — 5 per project, the parents fab_slab_job needs.
  //
  // Each one is a real QC slab off the board above, chosen the way the picker
  // chooses: api/fab/slabs offers a slab only while it is NOT on the rework
  // line and NOT dispatched, so a fab_slab against a dispatched slab is a state
  // the app cannot produce. Dimensions are the standard slab in MILLIMETRES and
  // the areas are SQUARE MILLIMETRES — see the units note at the top.
  // ─────────────────────────────────────────────────────────────────────────
  const takeable = rows.filter((r) => !r.dispatched && r.rw !== REWORK_PENDING);
  const SLABS_PER_PROJECT = 5;
  const takenRows = new Set<number>();

  /** Five slabs for one project, evenly spread across the slabs that existed
   *  by the time the project did — fabrication cannot cut stone that has not
   *  been polished yet. */
  const takeFor = (bornAt: Date, wanted: number): Row[] => {
    const pool = takeable.filter((r) => !takenRows.has(r.n) && r.when.getTime() > bornAt.getTime());
    const out: Row[] = [];
    const stride = Math.max(1, Math.floor(pool.length / wanted));
    for (let k = 0; k < wanted && k * stride < pool.length; k++) {
      const r = pool[k * stride];
      takenRows.add(r.n);
      out.push(r);
    }
    for (const r of pool) {           // top up if the stride ran short
      if (out.length >= wanted) break;
      if (takenRows.has(r.n)) continue;
      takenRows.add(r.n);
      out.push(r);
    }
    return out;
  };

  const slabs: any[] = [];
  let sIdx = 0;
  for (let p = 0; p < projects.length; p++) {
    for (const r of takeFor(projects[p].createdAt, SLABS_PER_PROJECT)) {
      sIdx++;
      // Imported a day or so after QC passed it, and never inside the last two
      // days — the cutting job below hangs its own hours off this.
      const born = new Date(Math.min(
        r.when.getTime() + (20 + (sIdx % 7) * 4) * 3_600_000,
        ctx.now.getTime() - 2 * 86_400_000,
      ));
      slabs.push({
        id: id("slb", sIdx),
        slabCode: String(r.slabNumber),          // what the app writes: the QC slab number
        colour: r.design,
        material: "Quartz",
        thickness: r.thicknessMm,                // MILLIMETRES
        length: STANDARD_SLAB_MM.lengthMm,       // MILLIMETRES
        width: STANDARD_SLAB_MM.widthMm,         // MILLIMETRES
        totalArea: STANDARD_SLAB_SQMM,           // SQUARE MILLIMETRES
        reservedArea: 0,                         // the app never writes this; it stays 0
        availableArea: STANDARD_SLAB_SQMM,       // SQUARE MILLIMETRES
        pacificQcId: r.qcId,                     // the polish_qc row this slab IS
        projectId: projects[p].id,
        createdAt: born,
      });
    }
  }
  try {
    await db.fabSlab.createMany({ data: slabs, skipDuplicates: true });
  } catch (e) { warn("fab_slab", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // fab_slab_job — one cutting job per slab, spread over the 90 days
  // ─────────────────────────────────────────────────────────────────────────
  // 60% completed, 20% in progress, 20% still waiting — so the cutting board
  // and the CEO "slabs cut between these dates" number both have rows.
  //
  // AGE DECIDES WHICH, not the row number. A job that has been IN_PROGRESS
  // since June reads as stale data on a board whose whole job is to show what
  // is on the machines now, and a slab still READY from two months ago would
  // have been cut long since. So the newest slabs are the ones still moving and
  // everything older is done.
  const byAge = [...slabs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const ageRank = new Map<string, number>(byAge.map((s, k) => [s.id, k]));

  const slabJobs = slabs.map((sl, i) => {
    const rank = ageRank.get(sl.id) ?? i;
    const status = rank < 6 ? "READY" : rank < 12 ? "IN_PROGRESS" : "COMPLETED";
    // Released a few hours after the slab was imported, cut the next morning —
    // so a job never predates its own slab.
    const created = new Date(sl.createdAt.getTime() + (2 + (i % 5)) * 3_600_000);
    const start = status === "READY" ? null : new Date(created.getTime() + (14 + (i % 9)) * 3_600_000);
    const end =
      status === "COMPLETED" && start
        ? new Date(start.getTime() + (95 + Math.floor(rnd() * 70)) * 60000)
        : null;
    // SQUARE FEET against the slab's own area — the slab is stored in square
    // millimetres, and reporting 62-87% of the wrong number is how a yield
    // figure ends up plausible and wrong.
    const slabSqft = round(sqftFromSqMm(sl.totalArea ?? STANDARD_SLAB_SQMM), 2);
    const used = status === "COMPLETED" ? round(slabSqft * (0.62 + rnd() * 0.25), 2) : null;
    const wastage = used ? round(100 - (used / slabSqft) * 100, 2) : null;
    return {
      id: id("job", i + 1),
      slabId: sl.id,
      machineId: pick(cuttingMachines, i).id,
      operatorId: userId(i),
      workerId: pick(workers, i).id,
      releasedById: userId(i + 1),
      status,
      startTime: start,
      endTime: end,
      usedAreaSqft: used,
      totalWastagePct: wastage,
      trueScrapPct: wastage ? round(wastage * 0.4, 2) : null,
      kerfMm: 3,
      createdAt: created,
    };
  });
  try {
    await db.fabSlabJob.createMany({ data: slabJobs, skipDuplicates: true });
  } catch (e) { warn("fab_slab_job", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // cutting_entry — the sampling/cutting desk's own log, ~40 rows
  // ─────────────────────────────────────────────────────────────────────────
  const PURPOSES = ["Sample", "Customer approval", "Shade panel", "Rework piece", "Display tile"];
  const cuttingEntries = Array.from({ length: 40 }, (_, i) => {
    const batch = pick(batches, i);
    const thick = pick(THICKNESS, i);
    return {
      id: id("cut", i + 1),
      slabNumber: 70100 + i,
      batchKey: batchKeyOf(batch),
      design: pick(designs, i),
      cutDate: at(88 - Math.floor(i * 2.15), 10 + (i % 8), (i * 17) % 60),
      operator: pick(WORKER_NAMES, i),
      lengthCm: 30 + (i % 4) * 10,
      widthCm: 20 + (i % 3) * 10,
      thicknessMm: THICKNESS_MM[thick],
      quantity: 1 + (i % 3),
      purpose: pick(PURPOSES, i),
      remarks: i % 7 === 0 ? "Cut from the tail end of the slab." : null,
      createdById: userId(i),
      createdAt: at(88 - Math.floor(i * 2.15), 11 + (i % 6), 5),
    };
  });
  try {
    await db.cuttingEntry.createMany({ data: cuttingEntries, skipDuplicates: true });
  } catch (e) { warn("cutting_entry", e); }

  // ─────────────────────────────────────────────────────────────────────────
  // polish_qc + polish_entry — 120 slabs each, paired.
  //
  // The two are joined the way the app joins them: polish_entry.polish_qc holds
  // the QC row's airtable_id, and both carry the same slab_number as a fallback.
  // created_time / created carry the date (never left NULL), so the date filters
  // that COALESCE onto imported_at still find them.
  // ─────────────────────────────────────────────────────────────────────────
  const qcRows = rows.map((r) => {
    const i = r.n;
    const { rw, repolish, issues, dispatched } = r;
    return {
      id: r.qcId,
      airtableId: r.qcAirtableId,
      slabNumber: r.slabNumber,
      batchNumber: r.batch,
      batchKey: r.batchKey,
      design: r.design,
      createdTime: r.when,
      importedAt: r.when,
      rwStatus: rw,
      repolishStatus: repolish,
      inspector: pick(INSPECTORS, i),
      goingToDispatch: dispatched ? "Yes" : "No",
      rwDoneBy: rw === RW_STATUS[1] ? pick(WORKER_NAMES, i + 2) : null,
      slabThickness: r.thickness,
      qualityIssue: [...new Set(issues)],
      // TWO FACTS, NOT ONE (schema.prisma says so at length). The GRADE is the
      // polishing line's verdict and stays A/A2/B/C; the MARK is what became of
      // the slab. markQcSlabCts leaves the grade alone once the finished-goods
      // mirror carries the mark — "A stays A. The mark carries the fact." — so
      // no demo row writes CTS into quality_grade.
      qualityGrade: r.grade,
      // CTS means FABRICATION CUT THIS SLAB, so it is exactly the set of slabs
      // that became a fab_slab above and nothing else. A CTS mark on a slab no
      // fab_slab points at is a state no code path can produce.
      slabMark: takenRows.has(i) ? "CTS" : i % 31 === 0 ? "SAMPLE" : "FULL_SLAB",
      topPolish: true,
      bottomPolish: i % 6 === 0,
      lamination: i % 12 === 0,
      sku: `${r.design.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}-${THICKNESS_MM[r.thickness]}`,
      bay: pick(BAYS, i),
      polishType: pick(POLISH_TYPE, Math.floor(i / 3)),
      dispatchStatus: dispatched ? "Dispatched" : null,
      mainBodyL: round(60 + rnd() * 25, 2),
      mainBodyA: round(-1 + rnd() * 2, 2),
      mainBodyB: round(1 + rnd() * 4, 2),
      shed4To5: i % 15 === 0,
      sentToChromia: false,
      printed: i % 2 === 0,
      remarks: i % 19 === 0 ? "Held for shade check against the master panel." : null,
      enteredById: userId(i),
    };
  });
  try {
    await db.polishQc.createMany({ data: qcRows, skipDuplicates: true });
  } catch (e) { warn("polish_qc", e); }

  // Nearly all of these slabs already have a QC verdict, so "Completed" has to
  // dominate — an entry still "In Progress" beside a finished QC row reads as a
  // data fault on the polishing report.
  const polishStatusFor = (i: number) => (i % 10 === 7 ? "In Progress" : i % 20 === 3 ? "On hold" : "Completed");
  const entryRows = rows.map((r) => {
    const i = r.n;
    const nominal = THICKNESS_MM[r.thickness];
    const mm = (k: number) => round(nominal - 0.6 + rnd() * 1.2 + k * 0.05, 2);
    // Polished a few hours before QC saw it.
    const polished = new Date(r.when.getTime() - (2 + (i % 5)) * 3600_000);
    return {
      id: id("pe", i + 1),
      airtableId: `recDEMOPE${String(i + 1).padStart(6, "0")}`,
      slabNumber: r.slabNumber,
      batchNumber: r.batch,
      batchKey: r.batchKey,
      calliberator: pick(CALLIBERATORS, i),
      design: r.design,
      created: polished,
      importedAt: polished,
      polishingStatus: polishStatusFor(i),
      slabThickness: r.thickness,
      polishSide: i % 6 === 0 ? "Both" : i % 3 === 0 ? "Bottom" : "Top",
      thickness1Mm: mm(0),
      thickness2Mm: mm(1),
      thickness3Mm: mm(2),
      thickness4Mm: mm(3),
      sku: `${r.design.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase()}-${nominal}`,
      remarks: i % 14 === 0 ? "Second pass on the head end." : null,
      polishQcIds: [r.qcAirtableId],
      enteredById: userId(i + 1),
    };
  });
  try {
    await db.polishEntry.createMany({ data: entryRows, skipDuplicates: true });
  } catch (e) { warn("polish_entry", e); }

  // ── what later modules can build on ───────────────────────────────────────
  ctx.fabMachines = machines.map((m) => ({ id: m.id, code: m.code, name: m.name, type: m.type }));
  ctx.fabWorkers = workers.map((w) => ({ id: w.id, name: w.name }));
  ctx.fabProjects = projects.map((p) => ({
    id: p.id, projectCode: p.projectCode, customerName: p.customerName, status: p.status,
  }));
  ctx.fabPos = pos.map((p) => ({ id: p.id, poNumber: p.poNumber, projectId: p.projectId }));
  ctx.fabSlabs = slabs.map((s) => ({
    id: s.id, slabCode: s.slabCode, projectId: s.projectId, colour: s.colour,
    /** The polish_qc row this slab is, and its slab number — a finished-goods
     *  or inventory module mirroring these slabs needs both. */
    pacificQcId: s.pacificQcId, slabNumber: Number(s.slabCode),
  }));
  /** The 120 polished slabs, for any module that wants to mirror them (finished
   *  goods, inventory, dispatch): slab_number is the join the app uses. */
  ctx.polishSlabs = rows.map((r) => ({
    slabNumber: r.slabNumber,
    batchNumber: r.batch,
    batchKey: r.batchKey,
    design: r.design,
    thickness: r.thickness,
    thicknessMm: r.thicknessMm,
    grade: r.grade,
    qcId: r.qcId,
    qcAirtableId: r.qcAirtableId,
    qcDate: r.when,
    dispatched: r.dispatched,
    /** FULL_SLAB / CTS / SAMPLE — a mirror that disagrees with polish_qc on
     *  this is what scripts/0070 exists to stop. */
    slabMark: takenRows.has(r.n) ? "CTS" : r.n % 31 === 0 ? "SAMPLE" : "FULL_SLAB",
  }));
  ctx.cuttingSlabNumbers = cuttingEntries.map((c) => c.slabNumber);

  console.log(
    `  [fab] ${machines.length} machines, ${workers.length} workers, ${projects.length} projects, ` +
    `${pos.length} POs, ${requirements.length} requirements, ${slabs.length} slabs, ` +
    `${slabJobs.length} slab jobs, ${cuttingEntries.length} cutting entries, ` +
    `${entryRows.length} polish entries, ${qcRows.length} polish QC`,
  );
}
