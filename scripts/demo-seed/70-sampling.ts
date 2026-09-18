// scripts/demo-seed/70-sampling.ts
//
// DEMO DATA ONLY — this module writes to the `pacificdemo` database, never to
// production. `db` is handed in already connected; nothing here imports
// @/lib/prisma.
//
// What it seeds:
//   * NOTHING of the colour catalogue when 20-catalogue has run: that module
//     owns product_series / product_colour / product_colour_finish /
//     sampling_size and publishes them on ctx, and sampling only counts against
//     them. A fallback catalogue is seeded ONLY when this module runs alone,
//     because sampling_stock cannot exist without one;
//   * the shelf: ~30 sampling_stock rows and the intake ledger behind them;
//   * boxes and stands: 4 sampling_unit_type, counted stock for the two box
//     types, serials for the two stand types, and the unit ledger;
//   * ~8 sampling_dispatch packages with their lines;
//   * Chromia: base materials, designs, locations, machines, batches, ~40
//     slabs, their process cycles, the PRINTING stage record of each cycle and
//     the printing detail hanging off it.
//
// ONE try/catch PER TABLE, on purpose: a column this schema has moved on from
// should cost one table, not the whole demo database.

type Ctx = {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
  [key: string]: unknown;
};

export async function seed(db: any, ctx: Ctx): Promise<void> {
  // ---------------------------------------------------------------- helpers
  const daysAgo: (n: number) => Date =
    typeof ctx?.daysAgo === "function"
      ? ctx.daysAgo
      : (n: number) => new Date(Date.now() - n * 86_400_000);

  function pick<T>(arr: T[], i: number): T {
    return arr[((i % arr.length) + arr.length) % arr.length];
  }

  const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  // Invented colour names. ctx.designs wins when it is populated; the fallback
  // exists so this module still produces a shelf when it runs alone. None of
  // these are Pacific's real chart names.
  const FALLBACK_DESIGNS = [
    "Glacier Veil",
    "Almond Drift",
    "Verona Grey",
    "Cobalt Frost",
    "Sienna Cloud",
    "Pearl Dune",
    "Onyx Tide",
    "Linen Quartz",
    "Saffron Mist",
    "Harbour Grey",
    "Moonstone Weave",
    "Copper Vein",
    "Mint Basalt",
    "Ivory Reef",
    "Slate Harbour",
    "Amber Sands",
    "Lunar Ash",
    "Rosewood Grain",
    "Chalk Meadow",
    "Indigo Storm",
    "Bronze Lattice",
    "Willow Stone",
    "Cinder Snow",
    "Opal Ridge",
  ];

  const ctxDesigns: string[] = Array.isArray(ctx?.designs)
    ? ctx.designs.filter((d) => typeof d === "string" && d.trim().length > 0)
    : [];
  const designNames: string[] =
    ctxDesigns.length >= 8 ? ctxDesigns.slice(0, 24) : FALLBACK_DESIGNS;

  const FALLBACK_CLIENTS = [
    "Northwind Surfaces Ltd",
    "Meridian Stone Studio",
    "Harbourline Interiors",
    "Vantage Kitchens LLC",
    "Bluecrest Contracting",
    "Elmgate Design House",
    "Saltbay Fitouts",
    "Cortland Stoneworks",
  ];

  const ctxClients: string[] = Array.isArray(ctx?.clients)
    ? ctx.clients
        .map((c) => c?.name)
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    : [];
  const clientNames: string[] =
    ctxClients.length > 0 ? ctxClients : FALLBACK_CLIENTS;

  const userIds: string[] =
    Array.isArray(ctx?.users) && ctx.users.length > 0
      ? ctx.users.map((u) => u.id).filter(Boolean)
      : [];
  const userId = (i: number): string | null =>
    userIds.length > 0 ? pick(userIds, i) : null;

  const batchNos: string[] =
    Array.isArray(ctx?.batches) && ctx.batches.length >= 4
      ? ctx.batches.slice(0, 6)
      : ["PDM.0101", "PDM.0102", "PDM.0103", "PDM.0104", "PDM.0105", "PDM.0106"];

  // WHAT THE CATALOGUE MODULE ALREADY PUT THERE. 20-catalogue owns
  // product_series / product_colour / product_colour_finish / sampling_size and
  // publishes what it wrote:
  //     ctx.colourFinishes { id, colourId, colourName, finish }[]
  //     ctx.samplingSizes  { id, lengthIn, widthIn, thicknessMm, label }[]
  // Sampling only COUNTS against those rows, so when they are there this module
  // writes none of them.
  const ctxColourFinishes: any[] = Array.isArray((ctx as any).colourFinishes)
    ? ((ctx as any).colourFinishes as any[])
    : [];
  const ctxSamplingSizes: any[] = Array.isArray((ctx as any).samplingSizes)
    ? ((ctx as any).samplingSizes as any[])
    : [];
  const catalogueFromCtx =
    ctxColourFinishes.length > 0 && ctxSamplingSizes.length > 0;

  // =========================================================================
  // 1. CATALOGUE — series -> colour -> finish.
  //    sampling_stock counts against product_colour_finish, so this has to
  //    exist before the shelf does. It is NOT this module's table, though:
  //    20-catalogue owns it and runs first. When its rows are on ctx they are
  //    used as they are and nothing is written here — seeding a second time
  //    would leave four series with no colours under them, a second opinion
  //    about which colours carry which finish, and two sample sizes the
  //    catalogue's own ctx does not know about, so the demo chart would be the
  //    union of two modules rather than one chart.
  //
  //    The fallback below only runs when this module runs ALONE. It still
  //    createMany(skipDuplicates) then READS BACK, because guessing an id
  //    another module chose would hand every sampling row a dangling key.
  // =========================================================================

  type CatalogueFinish = {
    id: string;
    colourId: string | null;
    colour: string;
    finish: string;
  };

  const seriesNames = ["Solstice", "Driftline", "Basalt Works", "Meridian"];
  const colourNames = designNames.slice(0, 24);
  let colourFinishes: CatalogueFinish[] = [];

  if (catalogueFromCtx) {
    colourFinishes = ctxColourFinishes
      .filter((cf: any) => cf && typeof cf.id === "string")
      .map((cf: any) => ({
        id: cf.id as string,
        colourId: typeof cf.colourId === "string" ? cf.colourId : null,
        colour: String(cf.colourName ?? cf.colour ?? ""),
        finish: String(cf.finish ?? ""),
      }));
  } else {
    try {
      await db.productSeries.createMany({
        data: seriesNames.map((name, i) => ({
          id: `demo-series-${i + 1}`,
          name,
          position: i + 1,
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "product_series", (e as Error).message);
    }

    let seriesByName = new Map<string, string>();
    try {
      const rows = await db.productSeries.findMany({
        where: { name: { in: seriesNames } },
        select: { id: true, name: true },
      });
      seriesByName = new Map(rows.map((r: any) => [r.name, r.id]));
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "product_series read-back",
        (e as Error).message,
      );
    }

    if (seriesByName.size > 0) {
      try {
        await db.productColour.createMany({
          data: colourNames.map((name, i) => ({
            id: `demo-colour-${i + 1}`,
            seriesId: seriesByName.get(pick(seriesNames, i))!,
            name,
            position: Math.floor(i / seriesNames.length) + 1,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn("  [sampling] skipped:", "product_colour", (e as Error).message);
      }
    }

    let colourByName = new Map<string, string>();
    try {
      const rows = await db.productColour.findMany({
        where: { name: { in: colourNames } },
        select: { id: true, name: true },
      });
      colourByName = new Map(rows.map((r: any) => [r.name, r.id]));
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "product_colour read-back",
        (e as Error).message,
      );
    }

    // Every colour is Polished; six carry a second finish, which is roughly the
    // shape of the real chart (most colours one finish, a few two). The four
    // spellings are src/lib/catalogue/colours.ts FINISHES.
    const SECOND_FINISH: Record<number, string> = {
      2: "Leathered",
      5: "Suede",
      8: "Matte",
      13: "Leathered",
      17: "Suede",
      21: "Matte",
    };

    if (colourByName.size > 0) {
      const finishData: any[] = [];
      colourNames.forEach((name, i) => {
        const colourId = colourByName.get(name);
        if (!colourId) return;
        finishData.push({
          id: `demo-cf-${i + 1}-p`,
          colourId,
          finish: "Polished",
        });
        if (SECOND_FINISH[i]) {
          finishData.push({
            id: `demo-cf-${i + 1}-x`,
            colourId,
            finish: SECOND_FINISH[i],
          });
        }
      });
      try {
        await db.productColourFinish.createMany({
          data: finishData,
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn(
          "  [sampling] skipped:",
          "product_colour_finish",
          (e as Error).message,
        );
      }

      try {
        const colourIdToName = new Map<string, string>(
          [...colourByName.entries()].map(([n, id]) => [id, n] as [string, string]),
        );
        const rows = await db.productColourFinish.findMany({
          where: { colourId: { in: [...colourByName.values()] } },
          select: { id: true, colourId: true, finish: true },
        });
        colourFinishes = rows.map((r: any) => ({
          id: r.id,
          colourId: r.colourId,
          colour: colourIdToName.get(r.colourId) ?? "",
          finish: r.finish,
        }));
      } catch (e) {
        console.warn(
          "  [sampling] skipped:",
          "product_colour_finish read-back",
          (e as Error).message,
        );
      }
    }
  }

  // Stable order, so the same demo run always produces the same shelf whichever
  // side the rows came from.
  colourFinishes.sort((a, b) =>
    a.colour === b.colour
      ? a.finish.localeCompare(b.finish)
      : colourNames.indexOf(a.colour) - colourNames.indexOf(b.colour),
  );

  // =========================================================================
  // 2. SAMPLE SIZES. lengthIn/widthIn are INCHES, longer edge first;
  //    thicknessMm is whole millimetres (20 = 2 cm). The catalogue's sizes
  //    again, when it published them.
  // =========================================================================

  const sizeSpecs = [
    { lengthIn: 4, widthIn: 4, thicknessMm: 20 },
    { lengthIn: 4, widthIn: 4, thicknessMm: 30 },
    { lengthIn: 6, widthIn: 4, thicknessMm: 20 },
    { lengthIn: 6, widthIn: 6, thicknessMm: 20 },
    { lengthIn: 8, widthIn: 6, thicknessMm: 30 },
    { lengthIn: 12, widthIn: 12, thicknessMm: 20 },
  ];

  const sizes: {
    id: string;
    lengthIn: number;
    widthIn: number;
    thicknessMm: number;
    label: string;
  }[] = [];

  if (catalogueFromCtx) {
    for (const s of ctxSamplingSizes) {
      if (!s || typeof s.id !== "string") continue;
      const lengthIn = Number(s.lengthIn);
      const widthIn = Number(s.widthIn);
      const thicknessMm = Number(s.thicknessMm);
      sizes.push({
        id: s.id,
        lengthIn,
        widthIn,
        thicknessMm,
        label:
          typeof s.label === "string" && s.label.length > 0
            ? s.label
            : `${lengthIn}x${widthIn} @ ${thicknessMm}mm`,
      });
    }
  } else {
    try {
      await db.samplingSize.createMany({
        data: sizeSpecs.map((s, i) => ({
          id: `demo-size-${i + 1}`,
          lengthIn: s.lengthIn,
          widthIn: s.widthIn,
          thicknessMm: s.thicknessMm,
          createdById: userId(i),
          createdAt: daysAgo(88 - i),
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "sampling_size", (e as Error).message);
    }

    try {
      const rows = await db.samplingSize.findMany({
        select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true },
      });
      for (const spec of sizeSpecs) {
        const hit = rows.find(
          (r: any) =>
            Number(r.lengthIn) === spec.lengthIn &&
            Number(r.widthIn) === spec.widthIn &&
            Number(r.thicknessMm) === spec.thicknessMm,
        );
        if (hit) {
          sizes.push({
            id: hit.id,
            lengthIn: spec.lengthIn,
            widthIn: spec.widthIn,
            thicknessMm: spec.thicknessMm,
            label: `${spec.lengthIn}x${spec.widthIn} @ ${spec.thicknessMm}mm`,
          });
        }
      }
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "sampling_size read-back",
        (e as Error).message,
      );
    }
  }

  // =========================================================================
  // 3. THE SHELF — ~30 sampling_stock rows, one per colour+finish, and the
  //    intake ledger that explains how they got there.
  // =========================================================================

  const QTYS = [
    24, 8, 40, 3, 16, 31, 0, 12, 52, 7, 19, 26, 2, 35, 11, 44, 6, 21, 9, 38,
    14, 1, 28, 17, 33, 5, 23, 46, 10, 29,
  ];

  const shelf: { colourFinishId: string; sizeId: string; quantity: number }[] = [];
  if (colourFinishes.length > 0 && sizes.length > 0) {
    colourFinishes.slice(0, 30).forEach((cf, i) => {
      shelf.push({
        colourFinishId: cf.id,
        sizeId: pick(sizes, i).id,
        quantity: pick(QTYS, i),
      });
    });
  }

  if (shelf.length > 0) {
    try {
      await db.samplingStock.createMany({
        data: shelf.map((s, i) => ({
          id: `demo-stock-${i + 1}`,
          colourFinishId: s.colourFinishId,
          sizeId: s.sizeId,
          quantity: s.quantity,
          createdAt: daysAgo(85 - i * 2),
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "sampling_stock", (e as Error).message);
    }

    // Intake: append-only, spread across the 90 days so the intake list and the
    // "offcut vs cut-to-sample" chart both have a shape.
    try {
      const sources = [
        "SAMPLE_CUTTING",
        "FAB_OFFCUT",
        "SAMPLE_CUTTING",
        "FAB_OFFCUT",
        "SAMPLE_CUTTING",
        "RETURNED",
      ];
      const intakeData = shelf.slice(0, 24).map((s, i) => {
        const source = pick(sources, i);
        const ref =
          source === "FAB_OFFCUT"
            ? `SLB-${154700 + i * 3}`
            : source === "RETURNED"
              ? `SR-${2400 + i}`
              : `CUT-${1180 + i}`;
        return {
          id: `demo-intake-${i + 1}`,
          colourFinishId: s.colourFinishId,
          sizeId: s.sizeId,
          quantity: 4 + ((i * 3) % 18),
          source,
          sourceRef: ref,
          note:
            source === "RETURNED"
              ? "Package cancelled after packing; pieces back on the shelf."
              : null,
          createdById: userId(i),
          createdAt: daysAgo(84 - i * 3),
        };
      });
      await db.samplingIntake.createMany({ data: intakeData, skipDuplicates: true });
    } catch (e) {
      console.warn("  [sampling] skipped:", "sampling_intake", (e as Error).message);
    }
  } else {
    console.warn(
      "  [sampling] skipped:",
      "sampling_stock",
      "no colour+finish or size rows to hang stock on",
    );
  }

  // =========================================================================
  // 4. BOXES AND STANDS.
  //    A box is COUNTED (sampling_unit_stock carries a quantity); a stand is
  //    SERIALISED and has no stock row at all — its on-hand is count(*) of
  //    IN_STOCK serials, and a stored count beside those rows would be a
  //    second source of truth. The ledger deltas for each counted type sum to
  //    that type's quantity, which is what the admin page asserts.
  // =========================================================================

  const unitTypes = [
    {
      id: "demo-ut-kitbox",
      kind: "BOX",
      name: "Sample Kit Box - 12 Piece",
      sfStandType: "Sample Kit Box",
      serialised: false,
      capacityPieces: 12,
      minQty: 5,
      position: 1,
      quantity: 18,
    },
    {
      id: "demo-ut-mailer",
      kind: "BOX",
      name: "Mailer Box - 4 Piece",
      sfStandType: "Sample Kit Box",
      serialised: false,
      capacityPieces: 4,
      minQty: 10,
      position: 2,
      quantity: 32,
    },
    {
      id: "demo-ut-floor",
      kind: "STAND",
      name: "Floor Stand - 24 Slot",
      sfStandType: "Floor Stand",
      serialised: true,
      capacityPieces: 24,
      minQty: 1,
      position: 3,
      quantity: null,
    },
    {
      id: "demo-ut-counter",
      kind: "STAND",
      name: "Counter Display - 9 Slot",
      sfStandType: "Counter Display",
      serialised: true,
      capacityPieces: 9,
      minQty: 2,
      position: 4,
      quantity: null,
    },
  ];

  try {
    await db.samplingUnitType.createMany({
      data: unitTypes.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        sfStandType: t.sfStandType,
        serialised: t.serialised,
        capacityPieces: t.capacityPieces,
        minQty: t.minQty,
        active: true,
        position: t.position,
        createdAt: daysAgo(80),
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [sampling] skipped:", "sampling_unit_type", (e as Error).message);
  }

  try {
    await db.samplingUnitStock.createMany({
      data: unitTypes
        .filter((t) => !t.serialised)
        .map((t, i) => ({
          id: `demo-us-${i + 1}`,
          unitTypeId: t.id,
          quantity: t.quantity ?? 0,
        })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [sampling] skipped:", "sampling_unit_stock", (e as Error).message);
  }

  const serials = [
    {
      id: "demo-serial-1",
      unitTypeId: "demo-ut-floor",
      serialNo: "DFS-0001",
      status: "INSTALLED",
      customerName: pick(clientNames, 0),
      dispatchId: "demo-disp-1",
      installedAt: daysAgo(61),
      locationNote: "Showroom front wall, left of the counter.",
    },
    {
      id: "demo-serial-2",
      unitTypeId: "demo-ut-floor",
      serialNo: "DFS-0002",
      status: "INSTALLED",
      customerName: pick(clientNames, 1),
      installedAt: daysAgo(44),
      locationNote: "Design studio, first floor.",
    },
    {
      id: "demo-serial-3",
      unitTypeId: "demo-ut-floor",
      serialNo: "DFS-0003",
      status: "IN_STOCK",
      customerName: null,
      installedAt: null,
      locationNote: "Sampling room, rack B.",
    },
    {
      id: "demo-serial-4",
      unitTypeId: "demo-ut-floor",
      serialNo: "DFS-0004",
      status: "RELEASED",
      customerName: pick(clientNames, 2),
      dispatchId: "demo-disp-8",
      installedAt: null,
      locationNote: "Packed with SD-0008, not yet gone.",
    },
    {
      id: "demo-serial-5",
      unitTypeId: "demo-ut-floor",
      serialNo: "DFS-0005",
      status: "RETIRED",
      customerName: null,
      installedAt: null,
      locationNote: "Frame bent in transit; scrapped 2 months ago.",
    },
    {
      id: "demo-serial-6",
      unitTypeId: "demo-ut-counter",
      serialNo: "DCD-0001",
      status: "IN_STOCK",
      customerName: null,
      installedAt: null,
      locationNote: "Sampling room, rack A.",
    },
    {
      id: "demo-serial-7",
      unitTypeId: "demo-ut-counter",
      serialNo: "DCD-0002",
      status: "DISPATCHED",
      customerName: pick(clientNames, 3),
      dispatchId: "demo-disp-5",
      installedAt: null,
      locationNote: "In transit to the customer's showroom.",
    },
    {
      id: "demo-serial-8",
      unitTypeId: "demo-ut-counter",
      serialNo: "DCD-0003",
      status: "RETURNED",
      customerName: pick(clientNames, 4),
      installedAt: null,
      locationNote: "Came back when the showroom closed.",
    },
  ];

  try {
    await db.samplingUnitSerial.createMany({
      data: serials.map((s, i) => ({
        id: s.id,
        unitTypeId: s.unitTypeId,
        serialNo: s.serialNo,
        status: s.status,
        customerName: s.customerName,
        dispatchId: (s as { dispatchId?: string }).dispatchId ?? null,
        installedAt: s.installedAt,
        locationNote: s.locationNote,
        createdById: userId(i),
        createdAt: daysAgo(78 - i * 4),
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [sampling] skipped:", "sampling_unit_serial", (e as Error).message);
  }

  try {
    const ledger: any[] = [
      // Counted types: the deltas add up to the stock quantity above. A RELEASE
      // row is dated the day its package was released — the ledger and the
      // dispatch board are the same event seen from two screens, and SD-0008
      // released four days ago cannot have left the shelf six days ago.
      { unitTypeId: "demo-ut-kitbox", delta: 24, reason: "INTAKE", reference: "PO-DEMO-118", day: 76 },
      { unitTypeId: "demo-ut-kitbox", delta: -3, reason: "RELEASE", reference: "SD-0002", dispatchId: "demo-disp-2", day: 55 },
      { unitTypeId: "demo-ut-kitbox", delta: -2, reason: "RELEASE", reference: "SD-0004", dispatchId: "demo-disp-4", day: 33 },
      { unitTypeId: "demo-ut-kitbox", delta: -1, reason: "RELEASE", reference: "SD-0007", dispatchId: "demo-disp-7", day: 10 },
      { unitTypeId: "demo-ut-mailer", delta: 40, reason: "INTAKE", reference: "PO-DEMO-121", day: 74 },
      { unitTypeId: "demo-ut-mailer", delta: -6, reason: "RELEASE", reference: "SD-0003", dispatchId: "demo-disp-3", day: 47 },
      { unitTypeId: "demo-ut-mailer", delta: -2, reason: "RELEASE", reference: "SD-0006", dispatchId: "demo-disp-6", day: 17 },
      // Serialised types: one row per stand as it moved.
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-1", delta: 1, reason: "INTAKE", reference: "DFS-0001", day: 78 },
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-1", delta: -1, reason: "RELEASE", reference: "SD-0001", dispatchId: "demo-disp-1", day: 64 },
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-2", delta: 1, reason: "INTAKE", reference: "DFS-0002", day: 74 },
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-2", delta: -1, reason: "RELEASE", reference: "INSTALL-DFS-0002", day: 45 },
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-4", delta: -1, reason: "RELEASE", reference: "SD-0008", dispatchId: "demo-disp-8", day: 4 },
      { unitTypeId: "demo-ut-floor", serialId: "demo-serial-5", delta: -1, reason: "RETIRE", reference: "DFS-0005", note: "Frame bent in transit.", day: 58 },
      { unitTypeId: "demo-ut-counter", serialId: "demo-serial-7", delta: -1, reason: "RELEASE", reference: "SD-0005", dispatchId: "demo-disp-5", day: 26 },
      { unitTypeId: "demo-ut-counter", serialId: "demo-serial-8", delta: 1, reason: "RETURN", reference: "DCD-0003", note: "Showroom closed.", day: 12 },
      { unitTypeId: "demo-ut-mailer", delta: 0, reason: "ADJUST", reference: "COUNT-Q3", note: "Quarterly count agreed with the shelf.", day: 5 },
    ];
    await db.samplingUnitLedger.createMany({
      data: ledger.map((l, i) => ({
        id: `demo-ul-${i + 1}`,
        unitTypeId: l.unitTypeId,
        serialId: l.serialId ?? null,
        delta: l.delta,
        reason: l.reason,
        reference: l.reference ?? null,
        dispatchId: l.dispatchId ?? null,
        note: l.note ?? null,
        createdById: userId(i),
        createdAt: daysAgo(l.day),
      })),
      skipDuplicates: true,
    });
  } catch (e) {
    console.warn("  [sampling] skipped:", "sampling_unit_ledger", (e as Error).message);
  }

  // =========================================================================
  // 5. DISPATCHES — 8 packages, three states, and their lines.
  // =========================================================================

  const dispatchSpecs = [
    { status: "DELIVERED", destination: "DOMESTIC", released: 64, unitTypeId: "demo-ut-floor", unitSerialId: "demo-serial-1" },
    { status: "DELIVERED", destination: "INTERNATIONAL", released: 55, unitTypeId: "demo-ut-kitbox", unitSerialId: null },
    { status: "DELIVERED", destination: "DOMESTIC", released: 47, unitTypeId: "demo-ut-mailer", unitSerialId: null },
    { status: "DISPATCHED", destination: "DOMESTIC", released: 33, unitTypeId: "demo-ut-kitbox", unitSerialId: null },
    { status: "DISPATCHED", destination: "INTERNATIONAL", released: 26, unitTypeId: "demo-ut-counter", unitSerialId: "demo-serial-7" },
    { status: "DISPATCHED", destination: "DOMESTIC", released: 17, unitTypeId: "demo-ut-mailer", unitSerialId: null },
    { status: "RELEASED", destination: "DOMESTIC", released: 10, unitTypeId: "demo-ut-kitbox", unitSerialId: null },
    { status: "RELEASED", destination: "INTERNATIONAL", released: 4, unitTypeId: "demo-ut-floor", unitSerialId: "demo-serial-4" },
  ];

  const dispatchIds: string[] = [];
  try {
    const data = dispatchSpecs.map((d, i) => {
      const releasedAt = daysAgo(d.released);
      const dispatchedAt =
        d.status === "RELEASED" ? null : hoursAfter(releasedAt, 20 + i * 3);
      const deliveredAt =
        d.status === "DELIVERED" && dispatchedAt
          ? hoursAfter(dispatchedAt, d.destination === "INTERNATIONAL" ? 210 : 52)
          : null;
      const id = `demo-disp-${i + 1}`;
      dispatchIds.push(id);
      return {
        id,
        customerName: pick(clientNames, i),
        destination: d.destination,
        reference: `SD-${String(i + 1).padStart(4, "0")}`,
        status: d.status,
        releasedAt,
        releasedById: userId(i),
        dispatchedAt,
        dispatchedById: dispatchedAt ? userId(i + 1) : null,
        deliveredAt,
        deliveredById: deliveredAt ? userId(i + 2) : null,
        notes:
          d.destination === "INTERNATIONAL"
            ? "Courier, air freight. Pieces wrapped individually."
            : null,
        unitTypeId: d.unitTypeId,
        unitSerialId: d.unitSerialId,
        createdAt: releasedAt,
      };
    });
    await db.samplingDispatch.createMany({ data, skipDuplicates: true });
  } catch (e) {
    console.warn("  [sampling] skipped:", "sampling_dispatch", (e as Error).message);
  }

  if (dispatchIds.length > 0 && colourFinishes.length > 0 && sizes.length > 0) {
    try {
      const lines: any[] = [];
      dispatchIds.forEach((dispatchId, d) => {
        const lineCount = 2 + (d % 3); // 2 - 4 items per package
        const used = new Set<string>();
        for (let n = 0; n < lineCount; n++) {
          const cf = pick(colourFinishes, d * 3 + n * 2);
          const size = pick(sizes, d + n);
          const key = `${cf.id}:${size.id}`;
          if (used.has(key)) continue;
          used.add(key);
          lines.push({
            id: `demo-dl-${d + 1}-${n + 1}`,
            dispatchId,
            colourFinishId: cf.id,
            sizeId: size.id,
            quantity: 1 + ((d + n) % 4),
            createdAt: daysAgo(dispatchSpecs[d].released),
          });
        }
      });
      await db.samplingDispatchLine.createMany({ data: lines, skipDuplicates: true });
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "sampling_dispatch_line",
        (e as Error).message,
      );
    }
  }

  // =========================================================================
  // 6. CHROMIA — the digital-print line. Masters first, then 40 slabs, their
  //    cycles, the PRINTING stage record of each cycle and its detail row.
  // =========================================================================

  if (!db.chromiaSlab) {
    console.warn("  [sampling] skipped:", "chromia_*", "models are not in this client");
  } else {
    const baseMaterials = [
      {
        id: "demo-cbm-20",
        code: "DBM-Q20",
        name: "Quartz Blank 20 mm",
        description: "Standard 20 mm print blank.",
        defaultThicknessMm: 20,
        minUsableThicknessMm: 16,
      },
      {
        id: "demo-cbm-30",
        code: "DBM-Q30",
        name: "Quartz Blank 30 mm",
        description: "Heavy 30 mm blank for counter tops.",
        defaultThicknessMm: 30,
        minUsableThicknessMm: 25,
      },
    ];

    try {
      await db.chromiaBaseMaterial.createMany({
        data: baseMaterials.map((b) => ({ ...b, isActive: true, createdAt: daysAgo(90) })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_base_material",
        (e as Error).message,
      );
    }

    let baseMaterialIds: string[] = [];
    try {
      const rows = await db.chromiaBaseMaterial.findMany({
        where: { code: { in: baseMaterials.map((b) => b.code) } },
        select: { id: true },
      });
      baseMaterialIds = rows.map((r: any) => r.id);
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_base_material read-back",
        (e as Error).message,
      );
    }

    const designSpecs = designNames.slice(0, 12).map((name, i) => ({
      id: `demo-cdes-${i + 1}`,
      code: `DCH-${String(i + 1).padStart(3, "0")}`,
      name,
      fileName: `${slug(name)}-v${(i % 3) + 1}.tif`,
      version: `v${(i % 3) + 1}`,
    }));

    try {
      await db.chromiaDesign.createMany({
        data: designSpecs.map((d) => ({ ...d, isActive: true, createdAt: daysAgo(89) })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "chromia_design", (e as Error).message);
    }

    let designs: { id: string; code: string; name: string; fileName: string }[] = [];
    try {
      const rows = await db.chromiaDesign.findMany({
        where: { code: { in: designSpecs.map((d) => d.code) } },
        select: { id: true, code: true, name: true, fileName: true },
      });
      designs = rows.sort((a: any, b: any) => a.code.localeCompare(b.code));
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_design read-back",
        (e as Error).message,
      );
    }

    const locationSpecs = [
      { id: "demo-cloc-print", code: "D-PRINT-01", name: "Print Bay 1", type: "MACHINE_BAY", capacity: 6 },
      { id: "demo-cloc-cool", code: "D-COOL-01", name: "Cooling Zone", type: "COOLING_ZONE", capacity: 20 },
      { id: "demo-cloc-qc", code: "D-QC-01", name: "QC Area", type: "QC_AREA", capacity: 10 },
      { id: "demo-cloc-rack", code: "D-RACK-A", name: "Stock Rack A", type: "STOCK_RACK", capacity: 60 },
    ];

    try {
      await db.chromiaLocation.createMany({
        data: locationSpecs.map((l) => ({ ...l, isActive: true, createdAt: daysAgo(90) })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "chromia_location", (e as Error).message);
    }

    let locationByCode = new Map<string, string>();
    try {
      const rows = await db.chromiaLocation.findMany({
        where: { code: { in: locationSpecs.map((l) => l.code) } },
        select: { id: true, code: true },
      });
      locationByCode = new Map(rows.map((r: any) => [r.code, r.id]));
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_location read-back",
        (e as Error).message,
      );
    }

    const machineSpecs = [
      { id: "demo-cmac-prn", code: "D-PRN-01", name: "Digital Printer 1", type: "PRINTER", stage: "PRINTING", locCode: "D-PRINT-01" },
      { id: "demo-cmac-prm", code: "D-PRM-01", name: "Primer Line", type: "PRIMER_LINE", stage: "BASE_PRIMER", locCode: "D-PRINT-01" },
      { id: "demo-cmac-pol", code: "D-POL-01", name: "Polishing Line", type: "POLISHING_LINE", stage: "POLISHING", locCode: "D-QC-01" },
    ];

    try {
      await db.chromiaMachine.createMany({
        data: machineSpecs.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          type: m.type,
          stage: m.stage,
          locationId: locationByCode.get(m.locCode) ?? null,
          isActive: true,
          createdAt: daysAgo(90),
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      console.warn("  [sampling] skipped:", "chromia_machine", (e as Error).message);
    }

    let printerId: string | null = null;
    try {
      const row = await db.chromiaMachine.findFirst({
        where: { code: "D-PRN-01" },
        select: { id: true },
      });
      printerId = row?.id ?? null;
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_machine read-back",
        (e as Error).message,
      );
    }

    // ---- batches -----------------------------------------------------------
    const batchSpecs = batchNos.slice(0, 4).map((no, i) => ({
      id: `demo-cbat-${i + 1}`,
      batchNo: `CB.${no}`,
      receivedDate: daysAgo(88 - i * 18),
      totalSlabs: 10,
      baseMaterialId: baseMaterialIds.length
        ? pick(baseMaterialIds, i)
        : baseMaterials[i % 2].id,
    }));

    if (baseMaterialIds.length > 0) {
      try {
        await db.chromiaBatch.createMany({
          data: batchSpecs.map((b, i) => ({
            ...b,
            notes: i === 0 ? "Demo batch, first of the quarter." : null,
            createdById: userId(i),
            createdAt: b.receivedDate,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn("  [sampling] skipped:", "chromia_batch", (e as Error).message);
      }
    }

    let batches: { id: string; baseMaterialId: string; receivedDate: Date }[] = [];
    try {
      const rows = await db.chromiaBatch.findMany({
        where: { batchNo: { in: batchSpecs.map((b) => b.batchNo) } },
        select: { id: true, baseMaterialId: true, receivedDate: true },
      });
      batches = rows;
    } catch (e) {
      console.warn(
        "  [sampling] skipped:",
        "chromia_batch read-back",
        (e as Error).message,
      );
    }

    // ---- slabs -------------------------------------------------------------
    const SLAB_COUNT = 40;
    type SlabPlan = {
      id: string;
      slabNo: string;
      batchId: string;
      baseMaterialId: string;
      designId: string | null;
      receivedDate: Date;
      status: string;
      currentStage: string | null;
      grade: string | null;
      disposition: string | null;
      printResult: string;
      recalibrated: boolean;
      thickness: number;
    };

    const slabPlans: SlabPlan[] = [];
    if (batches.length > 0) {
      // TEN SLABS PER BATCH, IN BLOCKS — not round-robin. Slab i is dated
      // daysAgo(88 - 2i) and the batches are dated 88 / 70 / 52 / 34 days back,
      // so dealing the slabs out one per batch would put the second slab of the
      // quarter (86 days ago) in a batch that arrived 34 days ago. Blocks keep
      // every slab at or after the arrival of the batch it belongs to, and make
      // the batch's totalSlabs = 10 true rather than decorative.
      const perBatch = Math.ceil(SLAB_COUNT / batches.length);
      for (let i = 0; i < SLAB_COUNT; i++) {
        const batch = batches[Math.min(Math.floor(i / perBatch), batches.length - 1)];
        const design = designs.length ? pick(designs, i) : null;
        const recalibrated = i % 10 === 7 && i < SLAB_COUNT - 8; // out and back
        const thickness = i % 3 === 0 ? 30 : 20;

        // A tail of slabs is still moving; the rest are graded and away.
        const inFlight = i >= SLAB_COUNT - 8;
        const printResult =
          i % 13 === 5 ? "HALF_PRINT" : i % 17 === 9 ? "BYPASSED" : "FULLY_PRINTED";
        const grade = inFlight ? null : i % 7 === 3 ? "B" : i % 11 === 6 ? "C" : "A";
        const disposition = inFlight
          ? null
          : grade === "C"
            ? "WASTE"
            : grade === "B"
              ? "STOCK"
              : i % 5 === 2
                ? "SAMPLE_CUTTING"
                : "DISPATCH";

        slabPlans.push({
          id: `demo-cslab-${i + 1}`,
          slabNo: `DCS-${26_001 + i}`,
          batchId: batch.id,
          baseMaterialId: batch.baseMaterialId,
          designId: design ? design.id : null,
          receivedDate: daysAgo(88 - i * 2),
          status: inFlight
            ? i % 2 === 0
              ? "IN_PROCESS"
              : "UNDER_INSPECTION"
            : disposition === "WASTE"
              ? "WASTE"
              : disposition === "STOCK"
                ? "IN_STOCK"
                : disposition === "SAMPLE_CUTTING"
                  ? "SAMPLE_CUT"
                  : "DISPATCHED",
          currentStage: inFlight ? (i % 2 === 0 ? "PRINTING" : "QUALITY_CHECK") : null,
          grade,
          disposition,
          printResult,
          recalibrated,
          thickness,
        });
      }

      try {
        await db.chromiaSlab.createMany({
          data: slabPlans.map((s, i) => ({
            id: s.id,
            slabNo: s.slabNo,
            batchId: s.batchId,
            baseMaterialId: s.baseMaterialId,
            plannedDesignId: s.designId,
            originalThicknessMm: s.thickness,
            currentThicknessMm: s.recalibrated ? s.thickness - 2 : s.thickness,
            lengthMm: 3200,
            widthMm: 1600,
            status: s.status,
            currentStage: s.currentStage,
            currentCycleNumber: s.recalibrated ? 2 : 1,
            currentLocationId:
              locationByCode.get(
                s.currentStage === "PRINTING"
                  ? "D-PRINT-01"
                  : s.currentStage === "QUALITY_CHECK"
                    ? "D-QC-01"
                    : "D-RACK-A",
              ) ?? null,
            currentGrade: s.grade,
            currentDisposition: s.disposition,
            recalibrationCount: s.recalibrated ? 1 : 0,
            isRecalibrationOut: false,
            receivedDate: s.receivedDate,
            conditionOnArrival: i % 9 === 4 ? "Minor edge chip noted on arrival." : "Good",
            createdById: userId(i),
            createdAt: s.receivedDate,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn("  [sampling] skipped:", "chromia_slab", (e as Error).message);
      }
    } else {
      console.warn(
        "  [sampling] skipped:",
        "chromia_slab",
        "no chromia batch rows to hang slabs on",
      );
    }

    // ---- cycles, printing stage records, printing details -------------------
    type CyclePlan = {
      id: string;
      slab: SlabPlan;
      cycleNumber: number;
      status: string;
      inTime: Date;
      outTime: Date | null;
      printResult: string;
      grade: string | null;
      disposition: string | null;
    };

    const cyclePlans: CyclePlan[] = [];
    slabPlans.forEach((s, i) => {
      const inTime = hoursAfter(s.receivedDate, 18);
      const done = s.grade !== null;
      cyclePlans.push({
        id: `demo-ccyc-${i + 1}-1`,
        slab: s,
        cycleNumber: 1,
        status: s.recalibrated ? "ABORTED" : done ? "COMPLETED" : "ACTIVE",
        inTime,
        outTime: done || s.recalibrated ? hoursAfter(inTime, 9 + (i % 6)) : null,
        printResult: s.recalibrated ? "HALF_PRINT" : s.printResult,
        grade: s.recalibrated ? null : s.grade,
        disposition: s.recalibrated ? "RECALIBRATION" : s.disposition,
      });
      if (s.recalibrated) {
        const in2 = hoursAfter(inTime, 24 * 9);
        cyclePlans.push({
          id: `demo-ccyc-${i + 1}-2`,
          slab: s,
          cycleNumber: 2,
          status: "COMPLETED",
          inTime: in2,
          outTime: hoursAfter(in2, 11),
          printResult: "FULLY_PRINTED",
          grade: s.grade ?? "A",
          disposition: s.disposition ?? "DISPATCH",
        });
      }
    });

    if (cyclePlans.length > 0) {
      try {
        await db.chromiaProcessCycle.createMany({
          data: cyclePlans.map((c, i) => ({
            id: c.id,
            cycleNumber: c.cycleNumber,
            status: c.status,
            startedAt: c.inTime,
            completedAt: c.outTime,
            slabId: c.slab.id,
            designId: c.slab.designId,
            inTime: c.inTime,
            outTime: c.outTime,
            processingMinutes: c.outTime
              ? Math.round((c.outTime.getTime() - c.inTime.getTime()) / 60_000)
              : null,
            fullyPrintedDate:
              c.printResult === "FULLY_PRINTED" ? hoursAfter(c.inTime, 4) : null,
            printResult: c.printResult,
            finalGrade: c.grade,
            disposition: c.disposition,
            notes:
              c.cycleNumber === 2 ? "Second pass after recalibration." : null,
            createdById: userId(i),
            createdAt: c.inTime,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn(
          "  [sampling] skipped:",
          "chromia_process_cycle",
          (e as Error).message,
        );
      }

      try {
        await db.chromiaStageRecord.createMany({
          data: cyclePlans.map((c, i) => {
            const startedAt = hoursAfter(c.inTime, 2);
            const endedAt = c.outTime ? hoursAfter(startedAt, 1 + (i % 3)) : null;
            return {
              id: `demo-csr-${i + 1}`,
              stage: "PRINTING",
              sequence: 4,
              status: endedAt ? "COMPLETED" : "IN_PROGRESS",
              startedAt,
              endedAt,
              durationMinutes: endedAt
                ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)
                : null,
              isOverdue: i % 12 === 5,
              cycleId: c.id,
              slabId: c.slab.id,
              operatorId: userId(i),
              machineId: printerId,
              locationId: locationByCode.get("D-PRINT-01") ?? null,
              notes: c.printResult === "HALF_PRINT" ? "Head 3 dropped mid-pass." : null,
              createdAt: startedAt,
            };
          }),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn(
          "  [sampling] skipped:",
          "chromia_stage_record",
          (e as Error).message,
        );
      }

      try {
        await db.chromiaPrintingDetail.createMany({
          data: cyclePlans.map((c, i) => {
            const design = designs.length ? pick(designs, i) : null;
            return {
              id: `demo-cpd-${i + 1}`,
              stageRecordId: `demo-csr-${i + 1}`,
              designId: c.slab.designId ?? design?.id ?? null,
              fileName: design ? design.fileName : null,
              printResult: c.printResult,
              fullyPrintedAt:
                c.printResult === "FULLY_PRINTED" ? hoursAfter(c.inTime, 4) : null,
              bypassedAt:
                c.printResult === "BYPASSED" ? hoursAfter(c.inTime, 3) : null,
              passCount: c.printResult === "BYPASSED" ? 0 : 2 + (i % 2),
              inkSet: i % 2 === 0 ? "CMYK + White" : "CMYK",
              colourProfile: `DEMO-ICC-${(i % 4) + 1}`,
              colourDeviation: i % 6 === 2 ? "dE 1.8 vs proof" : null,
              remarks:
                c.printResult === "HALF_PRINT"
                  ? "Half print; slab held for recalibration."
                  : null,
              createdAt: hoursAfter(c.inTime, 4),
            };
          }),
          skipDuplicates: true,
        });
      } catch (e) {
        console.warn(
          "  [sampling] skipped:",
          "chromia_printing_detail",
          (e as Error).message,
        );
      }
    }

    // What later modules can join against.
    (ctx as any).chromiaDesigns = designs.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
    }));
    (ctx as any).chromiaSlabs = slabPlans.map((s) => ({
      id: s.id,
      slabNo: s.slabNo,
    }));
  }

  // =========================================================================
  // 7. ctx additions
  // =========================================================================
  // colourFinishes and samplingSizes BELONG TO 20-catalogue, which publishes
  // colourFinishes as { id, colourId, colourName, finish }. Overwriting that
  // with this module's internal { id, colour, finish } shape would silently
  // break the next module to read colourName. So they are only filled here when
  // nothing else filled them — this module running alone — and in the
  // catalogue's shape, not in its own.
  if (!catalogueFromCtx) {
    if (colourFinishes.length > 0) {
      (ctx as any).colourFinishes = colourFinishes.map((cf) => ({
        id: cf.id,
        colourId: cf.colourId,
        colourName: cf.colour,
        finish: cf.finish,
      }));
    }
    if (sizes.length > 0) (ctx as any).samplingSizes = sizes;
  }
  (ctx as any).samplingUnitTypes = unitTypes.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    serialised: t.serialised,
  }));
  if (dispatchIds.length > 0) (ctx as any).samplingDispatchIds = dispatchIds;
}
