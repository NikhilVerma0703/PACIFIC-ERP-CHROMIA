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
import { soql, compositePatch, readConfig, limitsSeen, type SfConfig } from "./client";

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
  unmappedSlabs: number;
  unclassifiedThickness: number;
  thirtyMmWithoutProduct: number;
  topUnmapped: Array<{ design: string; available: number; reason: string }>;
  thirtyMmCodes: string[];
  stockRows: { desired: number; toPush: number; toRetire: number; unchanged: number };
  wrote: { products: number; stockRows: number; failures: string[] };
  apiUsage: { used: number | null; total: number | null };
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

  const unapproved = await getUnapprovedSlabNumbers(true);
  let hidden = 0;
  let hiddenGroups: Array<{ design: string | null; slab_thickness: string | null; n: number }> = [];
  if (unapproved.length) {
    hiddenGroups = await db.$queryRawUnsafe(
      `SELECT design, slab_thickness, COUNT(*)::int AS n
         FROM fg_finished_slab
        WHERE status = 'AVAILABLE' AND slab_mark = 'FULL_SLAB'
          AND slab_number = ANY($1::bigint[])
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
      db.productColourFinish.findMany({ select: { id: true, finish: true, colour: { select: { name: true, series: true } } } }).catch(() => []),
      db.samplingSize.findMany({ select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true } }).catch(() => []),
    ]);
    const fBy = new Map(finishes.map((f: Record<string, unknown>) => [f.id as string, f]));
    const sBy = new Map(sizes.map((s: Record<string, unknown>) => [s.id as string, s]));
    for (const sh of shelves) {
      const f = fBy.get(sh.colourFinishId) as { finish?: string; colour?: { name?: string; series?: string } } | undefined;
      const z = sBy.get(sh.sizeId) as { lengthIn?: unknown; widthIn?: unknown; thicknessMm?: unknown } | undefined;
      if (!f || !z) continue;
      const label = `${f.colour?.name ?? ""} (${f.finish ?? ""}) ${z.lengthIn} × ${z.widthIn} in · ${z.thicknessMm} mm`;
      // INCLUDING SHELVES AT ZERO: a shelf that emptied is "none left", which is
      // a different answer from "never cut" and must stay different.
      out.push(sampleRow(sh.id, label, Number(sh.quantity ?? 0), {
        Series__c: f.colour?.series ?? null,
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
    for (const f of finishes as Array<{ id: string; finish?: string; colour?: { name?: string; series?: string } }>) {
      if (stocked.has(f.id)) continue;
      out.push(finishRow(f.id, `${f.colour?.name ?? ""} (${f.finish ?? ""})`, {
        Series__c: f.colour?.series ?? null,
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
async function readMirror(): Promise<Map<string, MirrorEntry>> {
  const rows: Array<{ sf_key: string; payload_hash: string }> =
    await db.$queryRawUnsafe(`SELECT sf_key, payload_hash FROM sf_stock_mirror`).catch(() => []);
  return new Map(rows.map((r) => [r.sf_key, { key: r.sf_key, payloadHash: r.payload_hash }]));
}

/**
 * One run of the stock phase.
 *
 * Reads everything, decides everything, and writes only when `dry` is false.
 * The summary it returns is the same object either way, so the dry run is a
 * faithful rehearsal rather than a different code path that happens to agree.
 */
export async function syncStock(opts: SyncOptions): Promise<SyncSummary> {
  const started = Date.now();
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
  const mirror = await readMirror();
  const stillResolves = (key: string): boolean => {
    if (!key.startsWith("SLAB|")) return true;
    const code = key.slice(5);
    return result.lines.some((l) => l.code === code) || productCodes.has(code);
  };
  const diff = diffMirror(desired, mirror, stillResolves);

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
    unmappedSlabs: s.unmappedSlabs,
    unclassifiedThickness: s.unclassifiedThickness,
    thirtyMmWithoutProduct: s.thirtyMmWithoutProduct,
    topUnmapped: result.unmapped.slice(0, 25).map((u) => ({ design: u.design, available: u.available, reason: u.reason })),
    thirtyMmCodes: result.lines.filter((l) => l.mm === 30 && !productCodes.has(l.code)).map((l) => l.code).sort(),
    stockRows: { desired: desired.length, toPush: diff.toPush.length, toRetire: diff.toRetire.length, unchanged: diff.unchanged },
    wrote: { products: 0, stockRows: 0, failures: [] },
    apiUsage: limitsSeen(),
    durationMs: 0,
  };

  if (opts.dry) {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // ── writes, only past here ────────────────────────────────────────────────
  const prodResults = await compositePatch(cfg, "Product2", payloads as unknown as Array<Record<string, unknown>>);
  summary.wrote.products = prodResults.filter((r) => r.success).length;
  for (const r of prodResults.filter((x) => !x.success)) {
    summary.wrote.failures.push(`Product2: ${(r.errors ?? []).map((e) => e.message).join("; ")}`);
  }

  const rowsToWrite = [...diff.toPush, ...diff.toRetire];
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

  summary.apiUsage = limitsSeen();
  summary.durationMs = Date.now() - started;
  return summary;
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
