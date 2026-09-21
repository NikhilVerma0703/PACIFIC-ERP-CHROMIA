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
  buildStockLines, productPayloads, summarise, slabRow, sampleRow, finishRow, unitRow,
  diffMirror, payloadHash, isSellableProduct,
  type ProductRow, type StockGroup, type StockRow, type MirrorEntry,
} from "./stock-rules";
import { soql, compositePatch, readConfig, limitsSeen, callsThisRun, resetCallCount, type SfConfig } from "./client";
import { orgNearlyOut, overOwnBudget, DAILY_CALL_BUDGET } from "./limits";
import { diffProducts, productMirrorKey, productPayloadHash } from "./stock-rules";
import { alertStandDown, alertRecovery, type AlertOutcome } from "./alert";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface SyncOptions {
  dry: boolean;
  /** ISO instant stamped on every product this run. */
  asOf: string;
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
 *  · minus the sales-unapproved (design, batch) pairs — every non-admin path in
 *    the ERP hides them, and Salesforce's audience is salespeople. Publishing
 *    them would show reps exactly the stock the approval screen exists to
 *    withhold.
 *
 * getUnapprovedSlabNumbers(true) is STRICT: if the approval list cannot be read
 * the call throws and the run fails closed, rather than publishing stock the
 * sales screens hide.
 */
async function readYard(): Promise<{ groups: StockGroup[]; raw: number; hidden: number }> {
  // A lapsed five-day hold is available again; searchAvailable sweeps first for
  // the same reason, so the two never disagree about the same slab.
  await sweepExpiredReservations();

  const rows: Array<{ design: string | null; slab_thickness: string | null; n: number }> =
    await db.$queryRawUnsafe(
      `SELECT design, slab_thickness, COUNT(*)::int AS n
         FROM fg_finished_slab
        WHERE status = 'AVAILABLE' AND slab_mark = 'FULL_SLAB'
        GROUP BY 1, 2`,
    );
  const raw = rows.reduce((n, r) => n + Number(r.n || 0), 0);

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
  let hidden = 0;
  let hiddenGroups: Array<{ design: string | null; slab_thickness: string | null; n: number }> = [];
  if (unapproved.length) {
    hiddenGroups = await db.$queryRawUnsafe(
      `SELECT design, slab_thickness, COUNT(*)::int AS n
         FROM fg_finished_slab
        WHERE status = 'AVAILABLE' AND slab_mark = 'FULL_SLAB'
          AND slab_number = ANY($1::double precision[])
        GROUP BY 1, 2`,
      unapproved,
    );
    hidden = hiddenGroups.reduce((n, r) => n + Number(r.n || 0), 0);
  }
  const hiddenBy = new Map(hiddenGroups.map((r) => [`${r.design ?? ""}|${r.slab_thickness ?? ""}`, Number(r.n || 0)]));

  const groups: StockGroup[] = rows.map((r) => ({
    design: r.design ?? "",
    slabThickness: r.slab_thickness ?? "",
    available: Math.max(0, Number(r.n || 0) - (hiddenBy.get(`${r.design ?? ""}|${r.slab_thickness ?? ""}`) ?? 0)),
  })).filter((g) => g.available > 0);

  return { groups, raw, hidden };
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

  const [{ groups, raw, hidden }, aliases, canon] = await Promise.all([
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
  const productIdByCode = new Map(sellable.map((p) => [(p.erpSku && p.erpSku.trim()) || p.productCode, p.id]));
  const desired: StockRow[] = [
    ...result.lines.map((l) => slabRow(l, productIdByCode.get(l.code) ?? null)),
    ...(await readSamplesAndUnits()),
  ];
  const wholeMirror = await readMirror();
  // TWO KEY SPACES IN ONE TABLE, and they must not see each other. diffMirror
  // walks every mirror entry and treats anything it does not recognise as a
  // stock line that has vanished — so a PRODUCT| key left in here would be
  // "retired" into ERP_Stock__c as a phantom row. Split first, diff separately.
  const mirror = new Map([...wholeMirror].filter(([k]) => !k.startsWith("PRODUCT|")));
  const productMirror = new Map([...wholeMirror].filter(([k]) => k.startsWith("PRODUCT|")));
  const stillResolves = (key: string): boolean => {
    if (!key.startsWith("SLAB|")) return true;
    const code = key.slice(5);
    return result.lines.some((l) => l.code === code) || productCodes.has(code);
  };
  const diff = diffMirror(desired, mirror, stillResolves);
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
    sellableSlabs: raw - hidden,
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
  // key must not appear twice in one composite call.
  const rowsToWrite = [...diff.toPush, ...diff.toRetire, ...toRestamp];
  if (rowsToWrite.length) {
    const records = rowsToWrite.map((r) => ({
      ERP_Key__c: r.key,
      Kind__c: r.kind,
      // NAME IS OMITTED when null — a zeroing row no longer knows what the line
      // was called, and writing the key there would replace the name a rep
      // searches by with "SLAB|QZ-ARVAWHITE-20".
      ...(r.name === null ? {} : { Name: r.name }),
      Available_Qty__c: r.available,
      Retired__c: r.retired,
      Synced_At__c: opts.asOf,
      ...r.fields,
    }));
    const res = await compositePatch(cfg, "ERP_Stock__c", records, "ERP_Key__c");
    summary.wrote.stockRows = res.filter((r) => r.success).length;
    for (const r of res.filter((x) => !x.success)) {
      summary.wrote.failures.push(`ERP_Stock__c: ${(r.errors ?? []).map((e) => e.message).join("; ")}`);
    }
    // The mirror records only what Salesforce accepted, so a failed row is
    // retried next run rather than assumed done.
    await recordMirror(rowsToWrite.filter((_, i) => res[i]?.success), diff.toRetire);
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
    JSON.stringify({ ourCalls: summary.ourCalls, wrote: summary.wrote, stoodDown: summary.stoodDown, alert: summary.alert ?? null }),
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
