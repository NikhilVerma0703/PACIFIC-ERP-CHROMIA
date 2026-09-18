/**
 * DEMO SEED — finished-goods inventory (fg_*).
 *
 * Writes the finished-goods yard for the `pacificdemo` database: ~600 slabs
 * across the invented designs/batches in ctx, their audit trail, and the Sales
 * approval ticks that decide which of that stock a Sales login may see.
 *
 * EVERY VALUE IN THIS FILE IS INVENTED. No real design, customer or slab.
 *
 * `db` is the already-connected demo PrismaClient handed in by the runner. This
 * module imports NOTHING — not "@/lib/prisma" (that is the PRODUCTION
 * singleton), not lib/inventory/*. The two plant rules it has to agree with
 * (normalizeBatch for batch_key, displayBatch for the approval key) are copied
 * verbatim below rather than imported, and the copies are marked so.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Ctx = {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
  [k: string]: any;
};

const MODULE = "inventory";

const warn = (table: string, e: unknown) =>
  console.warn(`  [${MODULE}] skipped ${table}:`, (e as Error).message);

// ───────────────────────────── deterministic randomness ─────────────────────
// Seeded so two runs of the demo seed produce the same yard — a screenshot in a
// slide deck still matches the database after a reseed.
let _seed = 0x5eed1a3b;
const rnd = (): number => {
  _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
  return _seed / 0x100000000;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number): boolean => rnd() < p;
const weighted = <T>(rows: readonly (readonly [T, number])[]): T => {
  const total = rows.reduce((s, r) => s + r[1], 0);
  let r = rnd() * total;
  for (const row of rows) {
    r -= row[1];
    if (r <= 0) return row[0];
  }
  return rows[rows.length - 1][0];
};

// ───────────────────────────── plant rules, copied ──────────────────────────

/** VERBATIM COPY of src/lib/normalizeBatch.ts — this is what the app itself
 *  writes into fg_finished_slab.batch_key (see api/inventory/slab/edit), so the
 *  demo rows must be keyed the same way or batch joins find nothing. */
function normalizeBatch(s: unknown): string {
  if (!s) return "";
  const str = String(s).trim().toUpperCase().replace(/[\s,]+/g, "");
  const stripped = str.replace(/^[A-Z]+-?/, "").trim();
  const base = stripped || str;
  const m = base.match(/^(\d+)-?([A-Z]+)$/);
  return m ? `${m[1]}-${m[2]}` : base;
}

/** VERBATIM COPY of src/lib/batchDisplay.ts. The Sales approval key is
 *  (canonical design, displayBatch(batch_number)) — getUnapprovedSlabNumbers
 *  builds it that way, so a row written under any other spelling is an approval
 *  the gate never looks up and the stock stays invisible. */
function displayBatch(b: string | null | undefined): string {
  if (b == null || String(b).trim() === "") return "—";
  const t = String(b).trim();
  const s = t.replace(/^[A-Za-z\s.\-]+/, "").replace(/^0+(?=\d)/, "");
  return s || t;
}

// ───────────────────────────── vocabularies ─────────────────────────────────
// Canonical option lists as src/lib/tables.ts declares them, so every demo
// value lands on an existing dropdown entry instead of inventing a new one.
const POLISH_TYPES = [["Polish", 80], ["Suede", 10], ["Honed", 6], ["Leathered", 4]] as const;
const RW_STATUS = [["Direct Ok", 70], ["RW Done Ok", 18], ["RW Required and ongoing", 8], ["Can't be Reworked", 4]] as const;
const REPOLISH_STATUS = [["Direct Ok", 62], ["Polish Ok", 22], ["Repolish Done", 11], ["Repolish Required", 5]] as const;
const GRADES = [["A", 54], ["A2", 11], ["B", 25], ["C", 10]] as const;
const THICKNESS = [["2 cm", 62], ["3 cm", 28], ["1.2 cm", 10]] as const;
const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"] as const;
const SOURCES = [["QC_AUTOLINK", 90], ["BULK_UPLOAD", 7], ["MANUAL_ENTRY", 3]] as const;
const QUALITY_ISSUES = ["Rubber", "Pinhole", "Edge chip", "Colour patch", "Line mark", "Water mark", "Scratch"] as const;
const SLAB_NOTES = [
  "Corner chip noted at QC, within tolerance.",
  "Held back for the showroom display bay.",
  "Vein run reads darker than the rest of the batch.",
  "Re-bayed after the yard shuffle.",
  "Customer asked to see a photo before packing.",
] as const;

// Used only if ctx has not been populated — the module must not die on its own.
const FALLBACK_DESIGNS = [
  "Aurora Mist", "Verona Grey", "Lumen White", "Basalt Storm", "Cinder Vein", "Opal Drift",
  "Nordic Frost", "Umbra Sand", "Sierra Pearl", "Tundra Ash", "Cascade Snow", "Halcyon Cream",
  "Ember Quartz", "Slate Harbour", "Pearl Meridian", "Cobalt Shadow", "Dune Ivory", "Glacier Line",
  "Bronze Fern", "Onyx Tide", "Muscat Beige", "Riviera Smoke", "Solstice Grey", "Willow Salt",
];
const FALLBACK_BATCHES = Array.from({ length: 18 }, (_, i) => `PES.${String(101 + i).padStart(4, "0")}`);
const FALLBACK_CLIENTS = [
  "Lakeview Stoneworks", "Meridian Surfaces LLP", "Kestrel Interiors", "Northbridge Kitchens",
  "Avonlea Marble Co.", "Copperfield Fit-Outs", "Silverline Projects", "Harbourstone Trading",
];
const FALLBACK_STAFF = ["Demo QC", "Demo Inventory", "Demo Dispatch"];

const SLAB_START = 900001;
const TARGET_SLABS = 600;
const DAY = 86400000;

export async function seed(db: any, ctx: Ctx): Promise<void> {
  const designs = Array.isArray(ctx.designs) && ctx.designs.length ? ctx.designs : FALLBACK_DESIGNS;
  const batches = Array.isArray(ctx.batches) && ctx.batches.length ? ctx.batches : FALLBACK_BATCHES;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const daysAgo = typeof ctx.daysAgo === "function" ? ctx.daysAgo : (n: number) => new Date(now.getTime() - n * DAY);

  const clientNames: string[] =
    Array.isArray(ctx.clients) && ctx.clients.length
      ? ctx.clients.map((c) => c?.name).filter((n): n is string => typeof n === "string" && n.trim() !== "")
      : [];
  const customers = clientNames.length ? clientNames : FALLBACK_CLIENTS;

  const staff: string[] =
    Array.isArray(ctx.users) && ctx.users.length
      ? ctx.users.map((u) => u?.name).filter((n): n is string => typeof n === "string" && n.trim() !== "")
      : [];
  const people = staff.length ? staff : FALLBACK_STAFF;
  const qcPeople = people.length > 2 ? people.slice(0, Math.max(2, Math.ceil(people.length / 2))) : people;

  // PI numbers for held and dispatched stock. run.ts runs 50-commercial AFTER
  // this module, so ctx.piNumbers is empty here TODAY and the invented branch is
  // the one that runs; the read stays because it costs nothing and is what makes
  // reordering the two modules work rather than silently produce two unrelated
  // sets of PI numbers. Either way this module publishes what it used on
  // ctx.piNumbers at the end, so commercial can raise PIs that match the stock.
  const ctxPis: string[] = Array.isArray((ctx as any).piNumbers)
    ? (ctx as any).piNumbers.filter((p: unknown): p is string => typeof p === "string")
    : [];

  const at = (d: number, hours = 0) => new Date(daysAgo(d).getTime() + hours * 3600000);
  const after = (from: Date, minDays: number, maxDays: number) => {
    const t = from.getTime() + (minDays + rnd() * (maxDays - minDays)) * DAY;
    return new Date(Math.min(t, now.getTime() - 3600000));
  };

  // ───────────────────────── design × batch combinations ───────────────────
  // A batch is one production run, so it carries ONE design — except where the
  // plant switched design mid-run, which is why a few designs show up twice.
  // Slab numbers then run consecutively inside a batch, the way the polishing
  // line actually numbers them, and the "age" column gets a real shape.
  type Combo = { design: string; batch: string; batchKey: string; approvalBatch: string; count: number; baseDays: number };
  const combos: Combo[] = [];

  const primary = designs.map((d, i) => ({ design: d, batch: batches[i % batches.length] }));
  const extra = designs
    .filter((_, i) => i % 4 === 0)
    .map((d, j) => ({ design: d, batch: batches[(j * 4 + 7) % batches.length] }));
  const pairs = [...primary, ...extra].filter(
    (p, i, all) => all.findIndex((q) => q.design === p.design && q.batch === p.batch) === i
  );

  const per = Math.max(6, Math.floor(TARGET_SLABS / pairs.length));
  pairs.forEach((p, i) => {
    const spread = (i % 5) - 2; // −2..+2, so the batch sizes are not identical
    const baseDays = Math.max(2, 88 - Math.floor((i * 86) / Math.max(1, pairs.length - 1)));
    combos.push({
      design: p.design,
      batch: p.batch,
      batchKey: normalizeBatch(p.batch),
      approvalBatch: displayBatch(p.batch),
      count: Math.max(4, per + spread),
      baseDays,
    });
  });

  // ───────────────────────────── the slabs ─────────────────────────────────
  type Row = Record<string, any>;
  const slabRows: Row[] = [];
  let slabNumber = SLAB_START;

  for (const combo of combos) {
    const ageFactor = combo.baseDays / 88; // older batches have shipped more
    for (let k = 0; k < combo.count; k++) {
      const sn = slabNumber++;
      const firstSeenAt = at(Math.max(1, combo.baseDays - Math.floor(rnd() * 3)), 6 + Math.floor(rnd() * 11));

      // The MARK is what dispatch reads (lib/inventory/grading.slabBlocksDispatch):
      // anything that is not FULL_SLAB has been cut, so it must never read as
      // DISPATCHED here or the demo data contradicts the rule the demo shows off.
      const slabMark = weighted([["FULL_SLAB", 93], ["CTS", 5], ["SAMPLE", 2]] as const);
      const status =
        slabMark !== "FULL_SLAB"
          ? chance(0.35)
            ? "CTS"
            : "AVAILABLE"
          : (() => {
              const dispatched = 0.08 + 0.22 * ageFactor;
              const r = rnd();
              if (r < dispatched) return "DISPATCHED";
              if (r < dispatched + 0.06) return "RESERVED";
              if (r < dispatched + 0.09) return "PACKED";
              if (r < dispatched + 0.105) return "RETURNED";
              if (r < dispatched + 0.12) return "CHROMIA";
              return "AVAILABLE";
            })();

      const grade = weighted(GRADES);
      const issues =
        grade === "A"
          ? chance(0.05)
            ? [pick(QUALITY_ISSUES)]
            : []
          : grade === "A2"
          ? chance(0.25)
            ? [pick(QUALITY_ISSUES)]
            : []
          : grade === "B"
          ? chance(0.45)
            ? [pick(QUALITY_ISSUES)]
            : []
          : [pick(QUALITY_ISSUES), ...(chance(0.4) ? [pick(QUALITY_ISSUES)] : [])];

      const inspector = pick(qcPeople);
      // Bay is QC's; the frame is put on by dispatch, so only stock on its way
      // out carries one — and a dispatched slab has usually lost its bay.
      const bay = chance(0.86) ? pick(BAYS) : null;
      const frameOf = () => `F-${String(1 + Math.floor(rnd() * 40)).padStart(2, "0")}`;
      const frame =
        status === "PACKED" || status === "DISPATCHED"
          ? frameOf()
          : status === "RESERVED" && chance(0.3)
          ? frameOf()
          : null;

      const held = status === "RESERVED" || status === "PACKED";
      const gone = status === "DISPATCHED" || status === "RETURNED";
      // A DISPATCHED slab KEEPS the PI and the reserved_at it left the yard on.
      // changeSlabStatus("dispatch") writes reserved_for_pi + customer and
      // clears ONLY reservation_expires_at — and the dispatch route answers 400
      // without a PI, so "dispatched, customer known, no PI" is a row the app
      // cannot produce. The slab detail panel prints ["PI", reservedForPi]
      // (InventoryDashboard), so leaving it null showed an em dash on every
      // dispatched slab in the demo. `return` touches none of these, so a
      // RETURNED slab carries the same three values forward.
      const onPi = held || gone;
      const customer = onPi ? pick(customers) : null;
      const reservedAt = onPi ? after(firstSeenAt, 1, 20) : null;
      const pi = onPi
        ? ctxPis.length
          ? pick(ctxPis)
          : `PI-DEMO-${String(100 + Math.floor(rnd() * 400))}`
        : null;

      // A full slab is 137" x 79"; a handful of odd-size pieces keep the sqft
      // column from reading as one number repeated 600 times.
      const odd = chance(0.05);
      const lengthIn = odd ? [126, 129, 133, 141][Math.floor(rnd() * 4)] : 137;
      const widthIn = odd ? [71, 75, 77, 81][Math.floor(rnd() * 4)] : 79;

      slabRows.push({
        slabNumber: sn,
        design: combo.design,
        grade,
        slabMark,
        slabThickness: weighted(THICKNESS),
        qualityIssue: issues,
        polishType: weighted(POLISH_TYPES),
        rwStatus: weighted(RW_STATUS),
        repolishStatus: weighted(REPOLISH_STATUS),
        batchNumber: combo.batch,
        batchKey: combo.batchKey,
        barcode: `PQ${sn}`,
        qcInspector: inspector,
        lastQcAt: firstSeenAt,
        lengthIn,
        widthIn,
        bayNumber: status === "DISPATCHED" && chance(0.8) ? null : bay,
        frameNumber: frame,
        status,
        reservedForPi: pi,
        customer,
        reservedAt,
        // 7 = DEFAULT_RESERVATION_DAYS. Only a LIVE hold has an expiry; dispatch
        // nulls it (and `return` leaves it null), so gone stock carries none.
        reservationExpiresAt: held && reservedAt ? new Date(reservedAt.getTime() + 7 * DAY) : null,
        notes: chance(0.06) ? pick(SLAB_NOTES) : null,
        source: weighted(SOURCES),
        firstSeenAt,
        createdAt: firstSeenAt,
      });
    }
  }

  // fg_finished_slab.slab_mark is the one column the schema itself warns may not
  // be there (scripts/0070 unapplied — and `prisma db push` has dropped it
  // before). It is worth one retry without it rather than losing all 600 slabs,
  // which is the whole inventory demo; every other failure costs its chunk.
  let dropMark = false;
  const withoutMark = (rows: Row[]) => rows.map(({ slabMark, ...rest }) => rest);

  // Which slabs actually landed. createMany is one statement, so a chunk is all
  // or nothing — and fg_slab_event carries a foreign key to slab_number, so a
  // chunk that failed here must not take the event table down with it.
  const live = new Set<number>();
  const landed = (chunk: Row[]) => chunk.forEach((r) => live.add(r.slabNumber as number));

  for (let i = 0; i < slabRows.length; i += 150) {
    const chunk = slabRows.slice(i, i + 150);
    try {
      await db.finishedSlab.createMany({ data: dropMark ? withoutMark(chunk) : chunk, skipDuplicates: true });
      landed(chunk);
    } catch (e) {
      if (!dropMark && /slab_?mark/i.test((e as Error).message)) {
        try {
          await db.finishedSlab.createMany({ data: withoutMark(chunk), skipDuplicates: true });
          dropMark = true;
          landed(chunk);
          console.warn(`  [${MODULE}] fg_finished_slab.slab_mark is missing — slabs seeded without it`);
          continue;
        } catch { /* fall through to the warning below */ }
      }
      warn(`FinishedSlab rows ${i}-${i + chunk.length}`, e);
    }
  }
  console.log(`  [${MODULE}] FinishedSlab: ${live.size}/${slabRows.length} rows across ${combos.length} design/batch combinations`);

  // ───────────────────────── the audit trail (fg_slab_event) ───────────────
  // Model SlabEvent, table fg_slab_event — the model the brief calls FgSlabEvent.
  // Kinds as the app writes them: created | qc_update | location | status |
  // reserve | pack | dispatch | return.
  if (live.size) {
    const events: Row[] = [];
    const ev = (sn: number, kind: string, when: Date, o: Partial<Row> = {}) =>
      events.push({
        slabNumber: sn,
        kind,
        field: o.field ?? null,
        oldValue: o.oldValue ?? null,
        newValue: o.newValue ?? null,
        changedBy: o.changedBy ?? null,
        source: o.source ?? "QC form",
        at: when,
      });

    for (const row of slabRows) {
      const sn = row.slabNumber as number;
      if (!live.has(sn)) continue;
      const seen = row.firstSeenAt as Date;

      ev(sn, "created", seen, {
        newValue: `${row.design} / ${row.batchNumber}`,
        changedBy: row.qcInspector,
        source: "QC autolink",
      });

      if (row.bayNumber)
        ev(sn, "location", new Date(seen.getTime() + 1800000), {
          field: "bay",
          newValue: row.bayNumber,
          changedBy: row.qcInspector,
          source: "QC form (bay from this QC pass)",
        });

      if (chance(0.22))
        ev(sn, "qc_update", after(seen, 0.5, 14), {
          field: "grade",
          oldValue: "Not graded yet",
          newValue: String(row.grade),
          changedBy: row.qcInspector,
          source: "QC form",
        });

      const status = row.status as string;
      if (status === "RESERVED" || status === "PACKED" || status === "DISPATCHED" || status === "RETURNED") {
        const reserved = after(seen, 1, 25);
        ev(sn, "reserve", reserved, {
          field: "status",
          oldValue: "AVAILABLE",
          newValue: "RESERVED",
          changedBy: pick(people),
          source: `PI ${row.reservedForPi ?? "—"}`,
        });
        if (status !== "RESERVED") {
          const packed = after(reserved, 1, 6);
          ev(sn, "pack", packed, { field: "status", oldValue: "RESERVED", newValue: "PACKED", changedBy: pick(people), source: "Packing list" });
          if (status === "DISPATCHED" || status === "RETURNED") {
            const sent = after(packed, 1, 8);
            ev(sn, "dispatch", sent, {
              field: "status",
              oldValue: "PACKED",
              newValue: "DISPATCHED",
              changedBy: pick(people),
              source: `Dispatch — ${row.customer ?? "—"}`,
            });
            if (status === "RETURNED")
              ev(sn, "return", after(sent, 2, 15), { field: "status", oldValue: "DISPATCHED", newValue: "RETURNED", changedBy: pick(people), source: "Return note" });
          }
        }
      } else if (status === "CTS") {
        ev(sn, "status", after(seen, 1, 20), { field: "status", oldValue: "AVAILABLE", newValue: "CTS", changedBy: pick(people), source: "Fabrication cutting list" });
      } else if (status === "CHROMIA") {
        ev(sn, "status", after(seen, 1, 20), { field: "status", oldValue: "AVAILABLE", newValue: "CHROMIA", changedBy: pick(people), source: "Chromia intake" });
      }
    }

    let eventsWritten = 0;
    for (let i = 0; i < events.length; i += 300) {
      const chunk = events.slice(i, i + 300);
      try {
        await db.slabEvent.createMany({ data: chunk, skipDuplicates: true });
        eventsWritten += chunk.length;
      } catch (e) {
        warn(`SlabEvent rows ${i}-${i + chunk.length}`, e);
      }
    }
    console.log(`  [${MODULE}] SlabEvent: ${eventsWritten}/${events.length} rows`);
  }

  // ───────────────────── Sales approval (fg_sales_approved_batch) ──────────
  // One row per (design, displayBatch(batch)) pair, because that is the key
  // getUnapprovedSlabNumbers looks the pair up under — a row written under the
  // raw batch text would be an approval the gate never finds, and the stock
  // would stay invisible to Sales while the screen said it was approved.
  //
  // The three NEWEST combinations are left off on purpose, so the approval
  // screen has something pending to tick and the Sales view is visibly
  // withholding stock.
  const ordered = [...combos].sort((a, b) => a.baseDays - b.baseDays); // newest first
  // The pair separator, built with fromCharCode for the reason
  // src/lib/inventory/approvalKey.ts gives on its own KEY_SEP: a real control
  // character in the source is one editor, patch or copy-paste away from being
  // silently dropped, and while it sits there grep, git diff and code review all
  // treat this file as BINARY rather than as code. (It was three raw NUL bytes
  // when this module was written.) NUL appears in no design and no batch, so no
  // pair of real values can collide with another pair.
  const KEY_SEP = String.fromCharCode(0);
  const keyOf = (c: Combo) => `${c.design}${KEY_SEP}${c.approvalBatch}`;
  const pending = new Set(ordered.slice(0, 3).map(keyOf));
  // Only tick a pair that actually has stock — the approval screen lists the
  // pairs it finds in fg_finished_slab, so a tick for a batch whose insert
  // failed is a row nothing will ever show.
  const withStock = new Set(
    slabRows.filter((r) => live.has(r.slabNumber as number)).map((r) => `${r.design}${KEY_SEP}${r.batchNumber}`)
  );
  const approvedRows: Row[] = [];
  const seenKeys = new Set<string>();
  for (const c of combos) {
    const key = keyOf(c);
    if (pending.has(key) || seenKeys.has(key) || !withStock.has(`${c.design}${KEY_SEP}${c.batch}`)) continue;
    seenKeys.add(key);
    approvedRows.push({
      design: c.design,
      batch: c.approvalBatch,
      approvedBy: pick(people),
      at: after(at(c.baseDays), 1, 5),
    });
  }
  try {
    await db.salesApprovedBatch.createMany({ data: approvedRows, skipDuplicates: true });
    console.log(`  [${MODULE}] SalesApprovedBatch: ${approvedRows.length} approved, ${pending.size} left pending on purpose`);
  } catch (e) {
    warn("SalesApprovedBatch", e);
  }

  // ───────────────────────────── hand on to later modules ──────────────────
  const written = slabRows.filter((r) => live.has(r.slabNumber as number));
  ctx.slabNumbers = written.map((r) => r.slabNumber as number);
  ctx.availableSlabNumbers = written.filter((r) => r.status === "AVAILABLE").map((r) => r.slabNumber as number);
  ctx.dispatchedSlabNumbers = written.filter((r) => r.status === "DISPATCHED").map((r) => r.slabNumber as number);
  ctx.slabDesignBatch = written.map((r) => ({
    slabNumber: r.slabNumber as number,
    design: r.design as string,
    batch: r.batchNumber as string,
    thickness: r.slabThickness as string,
  }));
  ctx.designBatchPairs = combos.map((c) => ({ design: c.design, batch: c.batch, batchKey: c.batchKey }));

  // The PI numbers now sitting on held and dispatched stock (fg_finished_slab
  // .reserved_for_pi is free text — no foreign key — so nothing breaks if the
  // commercial module never raises them). Published so it CAN: a demo where the
  // PI on a dispatched slab also exists as a PI is worth the two lines. Only
  // filled in if commercial did not get there first, so its numbers win.
  const slabPis = [...new Set(written.map((r) => r.reservedForPi as string | null).filter((p): p is string => !!p))].sort();
  ctx.slabPiNumbers = slabPis;
  if (!Array.isArray((ctx as any).piNumbers) || !(ctx as any).piNumbers.length) ctx.piNumbers = slabPis;
}
