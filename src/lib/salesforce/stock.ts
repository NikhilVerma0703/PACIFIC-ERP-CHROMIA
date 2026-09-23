// THE STOCK PUSH — what the yard holds, turned into what Salesforce is told.
//
// This file does the I/O and nothing else decides here: every rule it applies
// comes from stock-rules.ts and limits.ts, which `node --test` runs against the
// fixtures in DISCOVERY.md. It reads Postgres, reads Salesforce, and (unless it
// is a dry run) writes Salesforce.
//
// DRY RUN IS THE DEFAULT POSTURE, not an afterthought. Every count below can be
// computed without writing a single record, and the administrator and the owner
// both asked to read the summary before anything went out. `dry: true` does the
// full read and the full diff and then returns — so what a real run would do is
// knowable in advance, from the same code path that would do it.
import { prisma } from "@/lib/prisma";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import {
  buildStockLines, productPayloads, summarise, slabRows, sampleRow, finishRow, unitRow,
  diffMirror, payloadHash, isSellableProduct, slabKeyStillResolves, seriesIndex, seriesFor,
  slabKeyCode, planTransition, retirementRow, foldDesignName, yardGroups, ERP_KEY_MAX,
  probeWave, remaindersDue, verifiedKeys, sendChunks, partitionByNewField,
  type YardRow,
  type ProductRow, type StockGroup, type StockRow, type MirrorEntry,
} from "./stock-rules";
import { soql, compositePatch, readConfig, limitsSeen, callsThisRun, resetCallCount, SfError, type SfConfig } from "./client";
import { orgNearlyOut, overOwnBudget, DAILY_CALL_BUDGET } from "./limits";
import { diffProducts, productMirrorKey, productPayloadHash } from "./stock-rules";
import { alertStandDown, alertRecovery, type AlertOutcome } from "./alert";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface SyncOptions {
  dry: boolean;
  /** ISO instant stamped on every product this run. */
  asOf: string;
  /**
   * ONE ERP_Stock__c ROW PER FINISH AND GRADE (Salesforce's REPLY-10, option b)
   * rather than one per design and thickness. Off, the slab rows are written
   * exactly as before the split. The route turns it on from SF_SLAB_SPLIT for a
   * live run, or from ?split=1 on a DRY run only — so the switch can be read in
   * advance against production and flipped once Salesforce has said go, instead
   * of the merge itself being the migration.
   */
  split?: boolean;
}

export interface SyncSummary {
  dry: boolean;
  asOf: string;
  /** Before any filter — the raw AVAILABLE total, logged beside the filtered
   *  one every run so the gap between them is visible rather than assumed. */
  rawAvailableSlabs: number;
  sellableSlabs: number;
  hiddenUnapproved: number;
  products: { total: number; sellable: number };
  matched: number;
  notAtThickness: number;
  noErpDesign: number;
  publishedLines: number;
  publishedSlabs: number;
  unmappedSpellings: number;
  /** The same designs counted ONCE, folded the way the matcher folds them.
   *  Pacific's Salesforce administrator read "83 designs with stock and no
   *  product" and correctly objected that DESERT SILK and Desert Silk are one
   *  design listed twice: the worklist is per SPELLING, because each spelling
   *  needs its own alias row, but the DESIGN count is the smaller, truer number
   *  and both belong in the summary. */
  unmappedDesigns: number;
  unmappedSlabs: number;
  unclassifiedThickness: number;
  /** Stock withheld on purpose because its canonical is not sellable — today
   *  that is "Trial" and nothing else. Reported rather than silently dropped:
   *  740 slabs disappearing from a total with no line explaining them is how a
   *  filter becomes a bug nobody can see. */
  notSellableSlabs: number;
  notSellableSpellings: number;
  thirtyMmWithoutProduct: number;
  /** ERP_Stock__c slab rows — one per design, thickness, finish and grade.
   *  publishedLines counts product codes; this counts what a rep searches. */
  slabRows: number;
  /** Whether this run wrote one row per finish and grade (SyncOptions.split). */
  split: boolean;
  /** Slab rows sent with Finish__c / Grade__c / Series__c blank — null when the
   *  split is off and the fields are not sent at all. Counted so the first run
   *  can be checked against what Salesforce reads, and so "the ERP sent
   *  nothing" is never confused with "the yard recorded nothing". */
  slabRowsWithoutFinish: number | null;
  slabRowsWithoutGrade: number | null;
  slabRowsWithoutSeries: number | null;
  /** Designs with stock and no series, by slabs — a worklist, like topUnmapped.
   *  Most are simply not on the colour chart; a design that IS on it under
   *  another spelling needs one alias row and fills on the next run. */
  seriesMissing: Array<{ design: string; slabs: number }>;
  /** How many designs have stock and no series — the whole count, where
   *  seriesMissing lists only the 25 heaviest. */
  seriesMissingDesigns: number;
  /** The slabs the slab rows carry between them. MUST EQUAL publishedSlabs: the
   *  split divides a line's stock between rows and may never add or lose any.
   *  The one runtime check that would show a wrong split. */
  slabRowsQty: number;
  /** Available whole-marked slabs left out because their GRADE says cut (CTS,
   *  SAMPLE) — dispatch refuses them, so Salesforce must not promise them. */
  cutGradeExcluded: number;
  /** Rows whose ERP_Key__c is over the org's 80 — refused on every run. Only a
   *  product code past 55 characters can produce one; the longest is 27. */
  keysOverLimit: number;
  /** The key-shape switch this run: old-shape rows retired now (replacement
   *  already confirmed), waiting on a replacement being sent this run, and kept
   *  under the ordinary sold-out rule (no replacement exists yet). */
  shapeMigration: {
    current: "split" | "legacy";
    /** Rows of the other key shape Salesforce still holds (per the mirror). */
    oldShapeRows: number;
    /** Of those, rows whose code has replacements this run — decided after the
     *  first write by planTransition: retired, carrying a remainder, or held. */
    switchingOver: number;
    /** How many of switchingOver would be retired if every new row this run
     *  were accepted. The dry-run figure. */
    retireIfAllAccepted: number;
    /** Old rows with no replacement this run, left to the ordinary diff: a
     *  product sold out at the switch (kept as a searchable zero), or a design
     *  merged away (retired, as it always was). */
    keptSoldOut: number;
    keptMergedAway: number;
    /** After the writes; absent on a dry run or a stand-down. `retired`
     *  counts only retirements Salesforce ACCEPTED. `remainderRows` and `held`
     *  are how many old rows planTransition left carrying a remainder or
     *  untouched — decisions, not writes: a remainder is re-sent only when its
     *  count changed or it is due a re-stamp, and a refused one is named in
     *  wrote.failures like any other row. */
    retired?: number;
    remainderRows?: number;
    held?: number;
    /** New rows NOT sent this run because the probe batch was refused whole —
     *  see the write section. Retried by the next run's probe. */
    probeHeldBack?: number;
  };
  topUnmapped: Array<{ design: string; available: number; reason: string }>;
  thirtyMmCodes: string[];
  stockRows: { desired: number; toPush: number; toRetire: number; unchanged: number; toRestamp: number };
  /** Rows going out with `Product_Missing__c = true` — stock a rep can SEE but
   *  cannot yet quote, because no Product2 matches the design at that
   *  thickness. Reported because it is one of the figures Pacific's
   *  administrator verifies by query after a run, and it is NOT the same as
   *  `thirtyMmWithoutProduct`: that counts 30 mm CODES with no product, while
   *  this counts STOCK ROWS at any thickness whose product lookup is null.
   *  Quoting one where the other was asked for is how two people compare
   *  numbers that were never the same measurement. */
  productMissingRows: number;
  /** The same accounting for Product2, which is diffed now rather than written
   *  wholesale: `unchanged` is the number of products that cost no modification
   *  this run. */
  productRows: { desired: number; toPush: number; unchanged: number };
  wrote: { products: number; stockRows: number; failures: string[] };
  /** The ORG's rolling 24-hour counter from Sforce-Limit-Info — everyone's
   *  calls, not ours. Named so it cannot be read as this run's cost again. */
  apiUsage: { used: number | null; total: number | null };
  /** What THIS integration sent: this run, and our own day so far. */
  ourCalls: { thisRun: number; today: number; budget: number };
  /** Set when a guard stopped the writes, with the reason. Null on a normal run. */
  stoodDown: string | null;
  /** What the stand-down alert did — sent, logged, or neither, and why. Null
   *  on a run that did not stand down. Stored in sf_sync_run so the NEXT run
   *  can apply the once-an-hour rule, and shown on the admin page so a silent
   *  alerting system cannot stay silent about itself. */
  alert?: AlertOutcome | null;
  durationMs: number;
}

/**
 * WHAT IS COUNTED. One grouped query rather than 19,538 rows, and three filters
 * that each have a reason:
 *
 *  · status AVAILABLE — "active stock", as the owner means it.
 *  · slab_mark FULL_SLAB — a CTS or SAMPLE marked slab is one dispatch would
 *    refuse, so promising it would be a lie the yard then has to explain.
 *  · and not a CUT GRADE either — the same rule, by the other signal. Dispatch
 *    refuses a slab whose grade says CTS or SAMPLE even when its mark says
 *    whole (slabBlocksDispatch ORs the two), and the ERP's own inventory
 *    search hides it (wholeSlabWhere). This sync read the mark alone, which
 *    was invisible while the slabs were only a number in a total; once grade
 *    became a column Salesforce shows, any such slab would have gone out as a
 *    row reading "Grade CTS", in stock. Decided by gradeBlocksDispatch itself
 *    (in yardGroups), so it refuses exactly what dispatch refuses — "cts",
 *    "CTS (Reject)", a tab-padded "CTS" — and cannot drift from it. A shade
 *    stricter than the inventory search's exact match, deliberately.
 *  · minus the sales-unapproved (design, batch) pairs — every non-admin path in
 *    the ERP hides them, and Salesforce's audience is salespeople. Publishing
 *    them would show reps exactly the stock the approval screen exists to
 *    withhold.
 *
 * getUnapprovedSlabNumbers(true) is STRICT: if the approval list cannot be read
 * the call throws and the run fails closed, rather than publishing stock the
 * sales screens hide.
 */
async function readYard(): Promise<{ groups: StockGroup[]; raw: number; hidden: number; cutGradeExcluded: number }> {
  // A lapsed five-day hold is available again; searchAvailable sweeps first for
  // the same reason, so the two never disagree about the same slab.
  await sweepExpiredReservations();

  // The unapproved list comes first because it is subtracted INSIDE the one
  // statement below — see the note there.
  //

  // slab_number IS double precision, NOT an integer: 95 live AVAILABLE slabs are
  // sub-numbered 1.1, 1.2, 2.1 … so the array parameter must be cast to match the
  // column. It was ::bigint[], and Postgres rejected the first fractional element
  // it reached ("improper binary format in array element 501") — which failed the
  // STRICT read below, so every sync run died before writing anything.
  //
  // FILTERING THE FRACTIONS OUT WOULD BE WORSE THAN THE CRASH. This list is what
  // gets SUBTRACTED from published stock; drop an unapproved slab from it and that
  // slab is published to the reps instead — the exact leak the approval gate exists
  // to prevent. The cast widens; the list stays whole.
  const unapproved = await getUnapprovedSlabNumbers(true);

  // ONE STATEMENT, the visible count and the hidden count together.
  //
  // It was two: count everything, then count the unapproved, then subtract by
  // group. That was safe while a group was (design, thickness). Grouped by
  // polish and grade as well, a QC re-pass landing BETWEEN the two statements
  // moves an unapproved slab from one group to another — and then its hidden
  // count is subtracted from the wrong group, or from none, and the slab is
  // published to the reps for a run. One snapshot cannot disagree with itself.
  //
  // POLISH AND GRADE ARE PER SLAB (QC writes both on every pass), so they are
  // grouped and split downstream. The query reads and decides nothing: the
  // subtraction and the cut-grade rule are yardGroups, which is tested, and
  // the cut-grade rule there is dispatch's own function.
  const rows: YardRow[] =
    await db.$queryRawUnsafe(
      `SELECT design, slab_thickness, polish_type, grade,
              COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE slab_number = ANY($1::double precision[]))::int AS hidden
         FROM fg_finished_slab
        WHERE status = 'AVAILABLE' AND slab_mark = 'FULL_SLAB'
        GROUP BY 1, 2, 3, 4`,
      unapproved,
    );
  return yardGroups(rows);
}

/**
 * The colour chart's series for each design — Series__c on every slab row.
 *
 * NOT CAUGHT. The sample reader below swallows a failed read and carries on;
 * that is wrong here. A failed read would send every slab row with Series__c
 * blank, which CHANGES every row's hash — so the run re-pushes the whole object
 * to blank the column, and the next run re-pushes it all again to fill it. The
 * reps' series filter would lie in between. A run that fails leaves Salesforce
 * exactly as it was; that is the better failure.
 */
async function seriesByDesign(): Promise<Map<string, string>> {
  const colours: Array<{ name: string; series: { name: string } | null }> =
    await db.productColour.findMany({ select: { name: true, series: { select: { name: true } } } });
  return seriesIndex(colours);
}

/** Designs with stock and no series, heaviest first, capped at 25 like the
 *  unmapped worklist — seriesMissingDesigns counts them all. */
function seriesWorklist(
  lines: ReadonlyArray<{ canonical: string; available: number }>,
  seriesOf: (canonical: string) => string | null,
): Array<{ design: string; slabs: number }> {
  const by = new Map<string, number>();
  for (const l of lines) {
    if (seriesOf(l.canonical) !== null) continue;
    by.set(l.canonical, (by.get(l.canonical) ?? 0) + l.available);
  }
  return [...by].map(([design, slabs]) => ({ design, slabs }))
    .sort((a, b) => b.slabs - a.slabs || (a.design < b.design ? -1 : a.design > b.design ? 1 : 0))
    .slice(0, 25);
}

/** ERP_Stock__c records for a composite upsert by ERP_Key__c. */
function stockRecords(rows: StockRow[], asOf: string): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    ERP_Key__c: r.key,
    Kind__c: r.kind,
    // NAME IS OMITTED when null — a zeroing row no longer knows what the line
    // was called, and writing the key there would replace the name a rep
    // searches by with "SLAB|QZ-ARVAWHITE-20|POLISHED|A".
    ...(r.name === null ? {} : { Name: r.name }),
    Available_Qty__c: r.available,
    Retired__c: r.retired,
    Synced_At__c: asOf,
    ...r.fields,
  }));
}

/** One line per refused row, named by its key. */
function noteFailures(
  into: string[],
  rows: StockRow[],
  res: ReadonlyArray<{ success: boolean; errors?: Array<{ message?: string }> }>,
): void {
  res.forEach((r, i) => {
    if (r.success) return;
    into.push(`ERP_Stock__c ${rows[i]?.key ?? "?"}: ${(r.errors ?? []).map((e) => e.message).join("; ")}`);
  });
}

/** The alias table, read fresh every run — designs get merged while the app is
 *  running, and a cached map keeps publishing under a name just retired. */
async function aliasMap(): Promise<Map<string, string>> {
  const rows: Array<{ variant: string; canonical: string }> =
    await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
  return new Map(rows.map((a) => [a.variant, a.canonical]));
}

async function canonicalNames(): Promise<Set<string>> {
  const rows: Array<{ canonical: string }> =
    await db.designAlias.findMany({ select: { canonical: true }, distinct: ["canonical"] }).catch(() => []);
  return new Set(rows.map((r) => r.canonical).filter(Boolean));
}

/** The sample shelf and the boxes and stands, as ERP_Stock__c rows. */
async function readSamplesAndUnits(): Promise<StockRow[]> {
  const out: StockRow[] = [];

  const shelves: Array<{ id: string; quantity: number; colourFinishId: string; sizeId: string }> =
    await db.samplingStock.findMany({ select: { id: true, quantity: true, colourFinishId: true, sizeId: true } }).catch(() => []);
  if (shelves.length) {
    const [finishes, sizes] = await Promise.all([
      // `series` IS A RELATION, NOT A COLUMN — ProductColour holds seriesId and a
      // ProductSeries relation. `series: true` therefore hands back the whole
      // related OBJECT, and Series__c is a text field in Salesforce: the first
      // live run posted `{id, name, position, ...}` into it and Salesforce
      // rejected 520 of 845 rows with "Cannot deserialize instance of string
      // from START_OBJECT value {". Select the one column we actually print.
      db.productColourFinish.findMany({ select: { id: true, finish: true, colour: { select: { name: true, series: { select: { name: true } } } } } }).catch(() => []),
      db.samplingSize.findMany({ select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true } }).catch(() => []),
    ]);
    const fBy = new Map(finishes.map((f: Record<string, unknown>) => [f.id as string, f]));
    const sBy = new Map(sizes.map((s: Record<string, unknown>) => [s.id as string, s]));
    for (const sh of shelves) {
      const f = fBy.get(sh.colourFinishId) as { finish?: string; colour?: { name?: string; series?: { name?: string } } } | undefined;
      const z = sBy.get(sh.sizeId) as { lengthIn?: unknown; widthIn?: unknown; thicknessMm?: unknown } | undefined;
      if (!f || !z) continue;
      const label = `${f.colour?.name ?? ""} (${f.finish ?? ""}) ${z.lengthIn} × ${z.widthIn} in · ${z.thicknessMm} mm`;
      // INCLUDING SHELVES AT ZERO: a shelf that emptied is "none left", which is
      // a different answer from "never cut" and must stay different.
      out.push(sampleRow(sh.id, label, Number(sh.quantity ?? 0), {
        Series__c: f.colour?.series?.name ?? null,
        Colour__c: f.colour?.name ?? null,
        Finish__c: f.finish ?? null,
        Size_Label__c: `${z.lengthIn} × ${z.widthIn} in · ${z.thicknessMm} mm`,
        ERP_Colour_Finish_Id__c: sh.colourFinishId,
        ERP_Size_Id__c: sh.sizeId,
        ERP_Stock_Id__c: sh.id,
      }));
    }
    // A colour+finish that has NEVER been cut: no shelf row at all.
    const stocked = new Set(shelves.map((s) => s.colourFinishId));
    for (const f of finishes as Array<{ id: string; finish?: string; colour?: { name?: string; series?: { name?: string } } }>) {
      if (stocked.has(f.id)) continue;
      out.push(finishRow(f.id, `${f.colour?.name ?? ""} (${f.finish ?? ""})`, {
        Series__c: f.colour?.series?.name ?? null,
        Colour__c: f.colour?.name ?? null,
        Finish__c: f.finish ?? null,
        ERP_Colour_Finish_Id__c: f.id,
      }));
    }
  }

  // Boxes and stands (scripts/0086). On hand for a serialised type is the
  // IN_STOCK serial count, computed — never a stored second number.
  const types: Array<{ id: string; name: string; kind: string; serialised: boolean; stock?: { quantity: number } | null; serials: Array<{ status: string }> }> =
    await db.samplingUnitType.findMany({
      where: { active: true },
      select: { id: true, name: true, kind: true, serialised: true, stock: { select: { quantity: true } }, serials: { select: { status: true } } },
    }).catch(() => []);
  for (const t of types) {
    const onHand = t.serialised
      ? t.serials.filter((s) => s.status === "IN_STOCK").length
      : Number(t.stock?.quantity ?? 0);
    out.push(unitRow(t.id, t.name, t.kind === "BOX" ? "BOX" : "STAND", onHand));
  }

  return out;
}

/** The mirror: what Salesforce was last told, so only changes cost a call. */
async function readMirror(): Promise<Map<string, MirrorEntry & { pushedAt: Date | null }>> {
  const rows: Array<{ sf_key: string; payload_hash: string; pushed_at: Date | null }> =
    await db.$queryRawUnsafe(`SELECT sf_key, payload_hash, pushed_at FROM sf_stock_mirror`).catch(() => []);
  return new Map(rows.map((r) => [r.sf_key, { key: r.sf_key, payloadHash: r.payload_hash, pushedAt: r.pushed_at }]));
}

/**
 * HOW OLD A CONFIRMATION MAY GET — 30 minutes, at the administrator's request
 * and for his reason rather than ours.
 *
 * Once only CHANGED rows are written, `Synced_At__c` stops meaning "the ERP
 * last confirmed this row" and starts meaning "this count last moved". His
 * Stale__c flag is built on the first meaning: a row goes stale when two
 * confirmations in a row are missed, which is the "the sync has stopped"
 * signal. Both of the options we offered him were bad — redefining Stale__c
 * would flag healthy steady stock, and stamping every row every run is 708 rows
 * 144 times a day to keep a timestamp fresh. His third option is better than
 * either: re-confirm every row every 30 minutes, which is every third run and
 * about 192 extra calls a day.
 *
 * TIME, NOT A RUN COUNT. "Every third run" drifts the moment a run is skipped,
 * fails or is retried; "older than 30 minutes" is the same rule stated so that
 * a missed run repairs itself.
 */
const RESTAMP_AFTER_MS = 30 * 60 * 1000;

/** One composite call's worth: the most the probe spends while every new row
 *  is being refused. */
const PROBE_ROWS = 200;

/**
 * One run of the stock phase.
 *
 * Reads everything, decides everything, and writes only when `dry` is false.
 * The summary it returns is the same object either way, so the dry run is a
 * faithful rehearsal rather than a different code path that happens to agree.
 */
export async function syncStock(opts: SyncOptions): Promise<SyncSummary> {
  const started = Date.now();
  resetCallCount();
  // OUR OWN SPEND FOR THE DAY, read from the run records. Module memory dies
  // with the lambda, so the only honest source is what previous runs wrote
  // down. A failure to read it yields 0 — the guard then protects nothing this
  // run rather than refusing to work, which is the right way for a brake to
  // fail on a job whose writes are absolute values.
  const spentToday = await callsSpentToday();
  const cfg = readConfig();
  if (!cfg) throw new Error("Salesforce is not configured (SF_LOGIN_URL / SF_CLIENT_ID / SF_CLIENT_SECRET).");

  const [{ groups, raw, hidden, cutGradeExcluded }, aliases, canon] = await Promise.all([
    readYard(), aliasMap(), canonicalNames(),
  ]);

  // ACTIVE QUARTZ SLAB ONLY, in the query AND in the rules. The org holds 283
  // products; 55 inactive ones share a ProductCode with an active one, and
  // writing to a twin breaks the unique constraint and fails the batch.
  const raws = await soql<{ Id: string; Name: string; ProductCode: string; ERP_SKU__c: string | null; IsActive: boolean; Family: string | null }>(
    cfg,
    "SELECT Id, Name, ProductCode, ERP_SKU__c, IsActive, Family FROM Product2 WHERE IsActive = true AND Family = 'Quartz Slab'",
  );
  const products: ProductRow[] = raws.map((p) => ({
    id: p.Id, name: p.Name, productCode: p.ProductCode, erpSku: p.ERP_SKU__c,
    isActive: Boolean(p.IsActive), family: p.Family,
  }));
  const sellable = products.filter(isSellableProduct);
  const productCodes = new Set(sellable.map((p) => (p.erpSku && p.erpSku.trim()) || p.productCode));

  const result = buildStockLines(groups, aliases, canon, productCodes);
  const payloads = productPayloads(sellable, result.lines, canon, productCodes, opts.asOf);
  const s = summarise(result, payloads, productCodes);

  // ── the searchable rows ────────────────────────────────────────────────────
  const split = opts.split === true;
  const productIdByCode = new Map(sellable.map((p) => [(p.erpSku && p.erpSku.trim()) || p.productCode, p.id]));
  const series = await seriesByDesign();
  // Every yard spelling the alias table maps onto a canonical, so a design the
  // colour chart spells differently ("Pebbles Ice" / "Pebble Ice") still finds
  // its series — through the ERP's own record that the two are one design.
  const variantsOf = new Map<string, string[]>();
  for (const [variant, canonical] of aliases) {
    const k = foldDesignName(canonical);
    const list = variantsOf.get(k) ?? [];
    list.push(variant);
    variantsOf.set(k, list);
  }
  const seriesOf = (canonical: string): string | null =>
    seriesFor(canonical, series, variantsOf.get(foldDesignName(canonical)) ?? []);
  const slabRowsOut: StockRow[] = result.lines.flatMap((l) =>
    slabRows(l, productIdByCode.get(l.code) ?? null, seriesOf(l.canonical), split));
  const desired: StockRow[] = [
    ...slabRowsOut,
    ...(await readSamplesAndUnits()),
  ];
  const wholeMirror = await readMirror();
  // TWO KEY SPACES IN ONE TABLE, and they must not see each other. diffMirror
  // walks every mirror entry and treats anything it does not recognise as a
  // stock line that has vanished — so a PRODUCT| key left in here would be
  // "retired" into ERP_Stock__c as a phantom row. Split first, diff separately.
  const mirror = new Map([...wholeMirror].filter(([k]) => !k.startsWith("PRODUCT|")));
  const productMirror = new Map([...wholeMirror].filter(([k]) => k.startsWith("PRODUCT|")));
  // ── the switch-over — see planTransition ──────────────────────────────────
  // Old-shape keys whose code has replacement rows this run are SET ASIDE from
  // the ordinary diff and decided after the first write, against what
  // Salesforce has accepted by then. Old-shape keys with no replacement at all
  // (KEEP) go through the diff like any other key — which is what leaves a
  // product sold out at the moment of the switch as a searchable zero.
  const currentShape = split ? "split" : "legacy";
  const otherShapeKeys = [...mirror.keys()].filter((k) => {
    const sk = slabKeyCode(k);
    return sk !== null && sk.shape !== currentShape;
  });
  const before = planTransition(otherShapeKeys, slabRowsOut, new Set(mirror.keys()));
  const keepSet = new Set(before.keep);
  const setAside = otherShapeKeys.filter((k) => !keepSet.has(k));
  const setAsideSet = new Set(setAside);
  const diffable = new Map([...mirror].filter(([k]) => !setAsideSet.has(k)));

  const lineCodes = new Set(result.lines.map((l) => l.code));
  const stillResolves = (key: string): boolean => slabKeyStillResolves(key, lineCodes, productCodes);
  const diff = diffMirror(desired, diffable, stillResolves);
  // What the switch-over would do if every new row this run were accepted — the
  // figure a dry run exists to show before anyone flips SF_SLAB_SPLIT.
  const ifAllAccepted = planTransition(setAside, slabRowsOut, new Set([...mirror.keys(), ...slabRowsOut.map((r) => r.key)]));
  // Rows the diff called unchanged, whose last confirmation is older than the
  // window. They carry no new VALUE — only a fresh Synced_At__c — so they are
  // appended to the push rather than counted as changes.
  const staleCutoff = new Date(Date.parse(opts.asOf) - RESTAMP_AFTER_MS);
  const pushKeys = new Set(diff.toPush.map((r) => r.key));
  const toRestamp = desired.filter((r) => {
    if (pushKeys.has(r.key)) return false;
    const seen = mirror.get(r.key);
    return !seen || !seen.pushedAt || seen.pushedAt < staleCutoff;
  });
  const prodDiff = diffProducts(payloads, productMirror);

  const summary: SyncSummary = {
    dry: opts.dry,
    asOf: opts.asOf,
    rawAvailableSlabs: raw,
    sellableSlabs: raw - hidden - cutGradeExcluded,
    cutGradeExcluded,
    hiddenUnapproved: hidden,
    products: { total: products.length, sellable: sellable.length },
    matched: s.matched,
    notAtThickness: s.notAtThickness,
    noErpDesign: s.noErpDesign,
    publishedLines: s.publishedLines,
    publishedSlabs: s.publishedSlabs,
    unmappedSpellings: s.unmappedSpellings,
    unmappedDesigns: s.unmappedDesigns,
    unmappedSlabs: s.unmappedSlabs,
    unclassifiedThickness: s.unclassifiedThickness,
    notSellableSlabs: s.notSellableSlabs,
    notSellableSpellings: s.notSellableSpellings,
    thirtyMmWithoutProduct: s.thirtyMmWithoutProduct,
    split,
    slabRows: slabRowsOut.length,
    slabRowsWithoutFinish: split ? s.slabRowsWithoutFinish : null,
    slabRowsWithoutGrade: split ? s.slabRowsWithoutGrade : null,
    slabRowsWithoutSeries: split ? slabRowsOut.filter((r) => r.fields.Series__c === null).length : null,
    seriesMissing: seriesWorklist(result.lines, seriesOf),
    seriesMissingDesigns: new Set(result.lines.filter((l) => seriesOf(l.canonical) === null).map((l) => l.canonical)).size,
    slabRowsQty: slabRowsOut.reduce((n, r) => n + r.available, 0),
    keysOverLimit: desired.filter((r) => r.key.length > ERP_KEY_MAX).length,
    shapeMigration: {
      current: currentShape,
      oldShapeRows: otherShapeKeys.length,
      switchingOver: setAside.length,
      retireIfAllAccepted: ifAllAccepted.retire.length,
      keptSoldOut: before.keep.filter((k) => stillResolves(k)).length,
      keptMergedAway: before.keep.filter((k) => !stillResolves(k)).length,
    },
    topUnmapped: result.unmapped.slice(0, 25).map((u) => ({ design: u.design, available: u.available, reason: u.reason })),
    thirtyMmCodes: result.lines.filter((l) => l.mm === 30 && !productCodes.has(l.code)).map((l) => l.code).sort(),
    stockRows: { desired: desired.length, toPush: diff.toPush.length, toRetire: diff.toRetire.length, unchanged: diff.unchanged, toRestamp: toRestamp.length },
    productMissingRows: desired.filter((r) => r.fields?.Product_Missing__c === true).length,
    productRows: { desired: payloads.length, toPush: prodDiff.toPush.length, unchanged: prodDiff.unchanged },
    wrote: { products: 0, stockRows: 0, failures: [] },
    apiUsage: limitsSeen(),
    ourCalls: { thisRun: callsThisRun(), today: spentToday + callsThisRun(), budget: DAILY_CALL_BUDGET },
    stoodDown: null,
    alert: null,
    durationMs: 0,
  };

  if (opts.dry) {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // ── the two guards, asked before anything is written ──────────────────────
  // Both were promised to the administrator and neither existed. They are asked
  // HERE, after every read and before the first write, so a run that stands
  // down still returns the full picture of what it WOULD have sent.
  const limits = limitsSeen();
  if (orgNearlyOut(limits)) {
    summary.stoodDown = `The org is below 10% of its daily API allowance (${limits.used} of ${limits.total} used), so nothing was written. Stock is unchanged in Salesforce and the next run will send it.`;
  } else if (overOwnBudget(spentToday, callsThisRun())) {
    summary.stoodDown = `This integration has used ${spentToday + callsThisRun()} calls today against its own ceiling of ${DAILY_CALL_BUDGET}, so nothing was written.`;
  }
  if (summary.stoodDown) {
    // TELL SOMEBODY. Until this line the stand-down was a sentence in a JSON
    // response nobody was reading: the sync would quietly decline to write for
    // as long as the org stayed short of API calls, and the first anyone would
    // know is a rep noticing stale stock. Pacific's administrator asked for
    // both channels (REPLY-9) — a Telegram message to ops and an
    // Integration_Log__c row that pages him.
    //
    // BEFORE recordRun, so what the alert did lands in the same row. The next
    // run reads `alert.telegramAt` back out of it to apply the hourly rule, so
    // the ordering here is what makes the rate limit work at all.
    summary.alert = await alertStandDown(summary.stoodDown, {
      ourCalls: summary.ourCalls,
      apiUsage: summary.apiUsage,
      stockRows: summary.stockRows,
      productRows: summary.productRows,
    });
    await recordRun(opts, summary, started);
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // ── writes, only past here ────────────────────────────────────────────────
  // ONLY THE PRODUCTS THAT CHANGED. This used to PATCH all 110 every run, on
  // the reasoning that 110 fits in one call so a diff saved nothing. It saves
  // nothing in calls and everything in Last Modified: 15,840 modifications a
  // day at the ten-minute cadence, which is the org's only cheap record of when
  // a PERSON last touched a product. Pacific's administrator asked for this.
  if (prodDiff.toPush.length) {
    const prodResults = await compositePatch(cfg, "Product2", prodDiff.toPush as unknown as Array<Record<string, unknown>>);
    summary.wrote.products = prodResults.filter((r) => r.success).length;
    for (const r of prodResults.filter((x) => !x.success)) {
      summary.wrote.failures.push(`Product2: ${(r.errors ?? []).map((e) => e.message).join("; ")}`);
    }
    // Only what Salesforce accepted, so a rejected product is retried next run
    // rather than remembered as done — the same rule the stock rows follow.
    await recordProductMirror(prodDiff.toPush.filter((_, i) => prodResults[i]?.success));
  }

  // toRestamp last: a row that genuinely changed is already in toPush, and a
  // key must not appear twice in one composite call. No set-aside old-shape key
  // is in here — they were taken out of the diff and are decided below.
  const rowsToWrite = [...diff.toPush, ...diff.toRetire, ...toRestamp];

  // THE PROBE. Until Salesforce has accepted a single row of the current key
  // shape — the run the switch is flipped, and every run after it while the
  // new rows are refused — only the first PROBE_ROWS new rows go out. If every
  // one of them is refused the rest are held back until the next run's probe.
  // Without this, a systematic refusal (Grade__c not granted to the integration
  // user) re-sends every split row on every run: ceil(N/200) calls every ten
  // minutes, which spends the daily budget, and then the budget guard stands
  // the WHOLE sync down, Product2 and samples included. With it, the same
  // mistake costs one call a run, and the old rows keep carrying the stock
  // (planTransition's remainder), so Salesforce loses nothing meanwhile.
  const { firstWave, heldBack, probe } = probeWave(rowsToWrite, new Set(mirror.keys()), currentShape, PROBE_ROWS);

  const stockFailures: string[] = [];
  // Refusals of the OLD rows' own writes (a retirement, a remainder) are the
  // ones that leave a design's total wrong until they succeed, so they are kept
  // apart and named FIRST — a cap on the list must never cut them off behind a
  // probe's worth of refused new rows.
  const oldRowFailures: string[] = [];
  const acceptedKeys = new Set<string>();
  // A 400 is Salesforce refusing THIS request's payload — a field it will not
  // accept, most likely Grade__c before the integration user can see it. Every
  // row in the chunk is refused with the reason and the run carries on. Any
  // other failure (auth, 5xx, the network) stops the run as it always has, but
  // only after every chunk before it has been recorded.
  const absorb = (e: unknown): string | null =>
    e instanceof SfError && e.status === 400 ? e.message : null;
  const writeStock = async (rows: StockRow[], retired: StockRow[], failures: string[] = stockFailures): Promise<void> => {
    if (!rows.length) return;
    const { plain, withGrade } = partitionByNewField(rows);
    for (const part of [plain, withGrade]) {
      await sendChunks(
        part,
        200,
        (chunk) => compositePatch(cfg, "ERP_Stock__c", stockRecords(chunk, opts.asOf), "ERP_Key__c"),
        async (chunk, res) => {
          summary.wrote.stockRows += res.filter((r) => r.success).length;
          noteFailures(failures, chunk, res);
          chunk.forEach((r, i) => { if (res[i]?.success) acceptedKeys.add(r.key); });
          // The mirror records only what Salesforce accepted, so a failed row is
          // retried next run rather than assumed done — and a refused RETIREMENT
          // stays in the mirror and is retried too (recordMirror deletes a retired
          // key only when its row was accepted). Chunk by chunk, so a run that
          // dies later has not lost the record of what it already committed.
          await recordMirror(chunk.filter((_, i) => res[i]?.success), retired);
        },
        absorb,
      );
    }
  };

  try {
    if (rowsToWrite.length || setAside.length) {
      await writeStock(firstWave, diff.toRetire);
      if (heldBack.length) {
        if (probe.some((k) => acceptedKeys.has(k))) await writeStock(heldBack, []);
        else summary.shapeMigration.probeHeldBack = heldBack.length;
      }

      // THE OLD ROWS, now that Salesforce has answered. `present` is everything
      // it holds: what the mirror held before this run, plus what it accepted in
      // it. Each set-aside old row is retired if all its replacements are
      // present, carries the slabs of the ones that are not, or is held.
      const present = new Set([...mirror.keys(), ...acceptedKeys]);
      const after = planTransition(setAside, slabRowsOut, present, verifiedKeys(slabRowsOut, mirror, acceptedKeys));
      const retirements = after.retire.map(retirementRow);
      const remainders = remaindersDue(after.remainder, mirror, staleCutoff);
      await writeStock([...retirements, ...remainders], retirements, oldRowFailures);
      summary.shapeMigration.retired = retirements.filter((r) => acceptedKeys.has(r.key)).length;
      summary.shapeMigration.remainderRows = after.remainder.length;
      summary.shapeMigration.held = after.hold.length;
    }
  } catch (e) {
    // A RUN THAT STOPS STILL SPENT ITS CALLS. It used to leave no row in
    // sf_sync_run at all, so callsSpentToday — which is read from those rows —
    // never counted them, and the daily brake undercounted every failing run.
    // Recorded here with what it wrote and why it stopped; the route still
    // raises the alert.
    summary.wrote.failures.push(...oldRowFailures, ...stockFailures.slice(0, 50),
      `ERP_Stock__c: the run stopped — ${(e as Error).message}`);
    summary.apiUsage = limitsSeen();
    summary.ourCalls = { thisRun: callsThisRun(), today: spentToday + callsThisRun(), budget: DAILY_CALL_BUDGET };
    await recordRun(opts, summary, started);
    throw e;
  }
  // Named by KEY, so the first live run after the switch can be audited row by
  // row — "12 refused" says something went wrong, "SLAB|QZ-…|POLISHED|A:
  // Grade__c not writable" says what. Old-row refusals first, then the first
  // FAILURES_SHOWN of the rest with a count: a whole object refused would
  // otherwise put hundreds of identical lines into sf_sync_run.
  const FAILURES_SHOWN = 50;
  summary.wrote.failures.push(...oldRowFailures, ...stockFailures.slice(0, FAILURES_SHOWN));
  if (stockFailures.length > FAILURES_SHOWN) {
    summary.wrote.failures.push(`ERP_Stock__c: …and ${stockFailures.length - FAILURES_SHOWN} more refused rows`);
  }

  // THE OTHER END OF THE EVENT. If the previous run stood down and this one
  // wrote, the outage is over and that is worth saying — on both channels, and
  // as a Success row rather than an edit of the Retry row, because our
  // integration user has Create on Integration_Log__c and deliberately not
  // Edit (REPLY-11 §2). A no-op on every run that follows a normal one, which
  // is almost all of them.
  //
  // BEFORE the call counters are read, so the one API call it may spend is
  // counted in this run's total rather than silently omitted from the budget.
  const recovery = await alertRecovery(summary.wrote);
  if (recovery.logId || recovery.note) summary.alert = recovery;

  summary.apiUsage = limitsSeen();
  summary.ourCalls = { thisRun: callsThisRun(), today: spentToday + callsThisRun(), budget: DAILY_CALL_BUDGET };
  await recordRun(opts, summary, started);
  summary.durationMs = Date.now() - started;
  return summary;
}

/**
 * WHAT WE SPENT IN THE LAST 24 HOURS, from the run records.
 *
 * sf_sync_run existed from the day 0087 was applied and nothing had ever
 * written a row to it, so the lease, the run history and the daily total were
 * all design rather than behaviour. The ceiling the administrator asked us to
 * enforce cannot be enforced without this.
 */
async function callsSpentToday(): Promise<number> {
  const rows: Array<{ n: number | null }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM((summary->'ourCalls'->>'thisRun')::int), 0)::int AS n
       FROM sf_sync_run WHERE started_at > now() - interval '24 hours'`,
  ).catch(() => []);
  return Number(rows[0]?.n ?? 0);
}

/** One row per run — dry runs included, because a dry run costs real calls. */
async function recordRun(opts: SyncOptions, summary: SyncSummary, started: number): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO sf_sync_run (id, started_at, finished_at, phase, dry, ok, summary, error)
          VALUES ($1, $2, now(), 'stock', $3, $4, $5::jsonb, $6)`,
    `${started}-${Math.trunc(summary.publishedSlabs)}-${summary.stockRows.desired}`,
    new Date(started),
    opts.dry,
    summary.wrote.failures.length === 0,
    // The switch-over's own figures are kept too: the first live run after
    // SF_SLAB_SPLIT is flipped is the one Salesforce will re-read and ask about,
    // and a cron's HTTP response is gone the moment it is sent.
    JSON.stringify({
      ourCalls: summary.ourCalls, wrote: summary.wrote, stoodDown: summary.stoodDown, alert: summary.alert ?? null,
      split: summary.split, slabRows: summary.slabRows,
      slabRowsWithoutFinish: summary.slabRowsWithoutFinish, slabRowsWithoutGrade: summary.slabRowsWithoutGrade,
      slabRowsWithoutSeries: summary.slabRowsWithoutSeries, shapeMigration: summary.shapeMigration,
      cutGradeExcluded: summary.cutGradeExcluded, keysOverLimit: summary.keysOverLimit,
      slabRowsQty: summary.slabRowsQty, publishedSlabs: summary.publishedSlabs,
      sellableSlabs: summary.sellableSlabs, hiddenUnapproved: summary.hiddenUnapproved,
    }),
    summary.stoodDown,
  ).catch(() => {});
}

/** Remember each product's hash under its PRODUCT| key, in the same mirror
 *  table. Failure to record is swallowed for the reason the stock mirror
 *  swallows it: a mirror we could not write means the next run re-sends a row
 *  that was already correct, which costs one call and breaks nothing, while
 *  throwing here would fail a run whose writes had already landed. */
async function recordProductMirror(pushed: ReadonlyArray<{ Id: string }>): Promise<void> {
  for (const p of pushed) {
    await db.$executeRawUnsafe(
      `INSERT INTO sf_stock_mirror (sf_key, payload_hash, pushed_at)
            VALUES ($1, $2, now())
       ON CONFLICT (sf_key) DO UPDATE SET payload_hash = EXCLUDED.payload_hash, pushed_at = now()`,
      productMirrorKey(p.Id),
      productPayloadHash(p as never),
    ).catch(() => {});
  }
}

/** Remember what was pushed; forget what was retired. */
async function recordMirror(pushed: StockRow[], retired: StockRow[]): Promise<void> {
  const retiredKeys = new Set(retired.map((r) => r.key));
  for (const row of pushed) {
    if (retiredKeys.has(row.key)) {
      await db.$executeRawUnsafe(`DELETE FROM sf_stock_mirror WHERE sf_key = $1`, row.key).catch(() => {});
      continue;
    }
    await db.$executeRawUnsafe(
      `INSERT INTO sf_stock_mirror (sf_key, payload_hash, pushed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (sf_key) DO UPDATE SET payload_hash = EXCLUDED.payload_hash, pushed_at = now()`,
      row.key, payloadHash(row),
    ).catch(() => {});
  }
}

export type { SfConfig };
