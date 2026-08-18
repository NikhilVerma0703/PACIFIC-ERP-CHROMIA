import "server-only";

// The database half of the batch export - api.py's _lines_for, _vendor_lines_for
// and _build, on Prisma instead of SQLite.
//
// exportBatch.ts is pure and stays that way: it takes lines and returns XML plus
// a report of what the XML will do. This file is what turns a list of bill ids
// into those lines, decides which ids are not allowed to become lines, and
// writes down what was sent.
//
// ELIGIBILITY IS ENFORCED HERE, NOT IN THE UI.
// /export and /export/preview take a caller-supplied list of ids. Without this
// check a bill that is still an unconfirmed machine guess - or one carrying a
// live duplicate warning - could be named in the request and reach Tally as a
// real payment. Only a human-confirmed ('approved') bill with no open duplicate
// is eligible, and anything refused is REPORTED rather than dropped: the
// preview is the last cheap moment to notice that something a clerk ticked is
// not going.

import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { TALLY } from "./config";
import {
  batchFilename, buildBatch, buildBatchExcel, voucherNumber,
  type BatchLine, type BuildBatchResult, type VendorLine, type VendorTaxLine,
} from "./exportBatch";
import { isoDate } from "./pipelineRules";
import { knownLedgerNames, newLedgerRow, upsertLedgers } from "./refs";
import { loadExportedBillIds, logEvent } from "./store";

/** ISO date string -> Date at local midnight, or null. `new Date("2026-07-30")`
 *  parses as UTC midnight, which in IST is 05:30 the same day - fine - but in a
 *  negative-offset deployment region it is the PREVIOUS day, and the voucher
 *  would post to the wrong month at a month boundary. Parsed by parts instead. */
function localDate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export interface BlockedBill {
  billId: number;
  reasons: string[];
}

/**
 * Reimbursement lines for the requested bills, and the ones that must not go.
 *
 * `enforceEligibility: false` exists for one caller only - regenerating the
 * review spreadsheet for an export that already happened, whose bills are
 * 'posted' and 'already exported' by definition.
 */
export async function linesFor(
  billIds: readonly number[],
  enforceEligibility = true,
): Promise<{ lines: BatchLine[]; blocked: BlockedBill[] }> {
  if (!billIds.length) return { lines: [], blocked: [] };
  const ids = [...billIds];

  const [rows, dupeRows, exportedIds] = await Promise.all([
    prisma.financeBill.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: {
        id: true, status: true, person: true,
        extractions: {
          orderBy: { id: "desc" },
          take: 1,
          select: {
            person: true, ledger: true, netAmount: true, invoiceDate: true,
            narration: true, vendorName: true,
          },
        },
      },
    }),
    prisma.financeDuplicate.findMany({
      where: { billId: { in: ids }, overridden: false },
      select: { billId: true },
    }),
    loadExportedBillIds(ids),
  ]);

  const openDupes = new Set(dupeRows.map((d) => d.billId));
  const lines: BatchLine[] = [];
  const blocked: BlockedBill[] = [];

  for (const r of rows) {
    const ex = r.extractions[0];
    const reasons: string[] = [];
    // "already exported" must win over the status check: after an export the
    // bill IS 'posted', and that is the message a human needs to see.
    if (exportedIds.has(r.id)) {
      reasons.push("already exported to Tally in an earlier batch");
    } else if (r.status !== "approved") {
      reasons.push(`status is '${r.status}', not approved - a person must confirm it first`);
    }
    if (openDupes.has(r.id)) {
      reasons.push("unresolved duplicate warning - override or reject it first");
    }
    if (reasons.length && enforceEligibility) {
      blocked.push({ billId: r.id, reasons });
      continue;
    }
    lines.push({
      billId: r.id,
      person: (ex?.person || r.person || "").trim(),
      ledger: (ex?.ledger || "").trim(),
      amount: ex?.netAmount ?? 0,
      // Falls back to today only when the bill carried no readable date and the
      // reviewer left it blank. A voucher must have a date; a wrong month is
      // worse than today, so today is the honest default.
      voucherDate: localDate(isoDate(ex?.invoiceDate)) ?? new Date(),
      narration: ex?.narration || "",
      vendor: ex?.vendorName || "",
    });
  }

  // An id that names no bill at all is reported rather than ignored - a clerk
  // whose selection silently shrank has no way to find out why.
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) blocked.push({ billId: id, reasons: ["no such bill"] });
  }

  return { lines, blocked };
}

/** The stored tax lines, read defensively: `tax_lines_json` is a Json column, so
 *  a hand-edited row must degrade to "no tax lines" (which buildBatch then
 *  reports as an unbalanced/incomplete invoice) rather than throw inside an
 *  export. */
function readTaxLines(raw: unknown): VendorTaxLine[] {
  if (!Array.isArray(raw)) return [];
  const out: VendorTaxLine[] = [];
  for (const t of raw) {
    const row = t as { ledger?: unknown; amount?: unknown };
    const ledger = typeof row?.ledger === "string" ? row.ledger : "";
    const amount = Number(row?.amount);
    if (!ledger || !Number.isFinite(amount)) continue;
    out.push({ ledger, amount });
  }
  return out;
}

/**
 * Confirmed vendor invoices among the requested bills - Agent 2.
 *
 * Only bills a human has put through /confirm-vendor appear here, and only
 * while still approved. Eligibility (already exported, unresolved duplicate) is
 * enforced inside buildBatch alongside the reimbursements, so both kinds are
 * judged by one set of rules and reported in one `skipped` list.
 *
 * fin_vendor_entry has no unique key on bill_id, so a re-confirmation appends.
 * The newest row wins, which is what "the reviewer changed their mind" means.
 */
export async function vendorLinesFor(billIds: readonly number[]): Promise<VendorLine[]> {
  if (!billIds.length) return [];
  const ids = [...billIds];

  const [entries, approved] = await Promise.all([
    prisma.financeVendorEntry.findMany({
      where: { billId: { in: ids } },
      orderBy: { id: "desc" },
    }),
    prisma.financeBill.findMany({
      where: { id: { in: ids }, status: "approved" },
      select: { id: true },
    }),
  ]);

  const approvedIds = new Set(approved.map((b) => b.id));
  const seen = new Set<number>();
  const out: VendorLine[] = [];
  for (const e of entries) {
    if (seen.has(e.billId) || !approvedIds.has(e.billId)) continue;
    seen.add(e.billId);
    out.push({
      billId: e.billId,
      vendorLedger: e.vendorLedger,
      expenseLedger: e.expenseLedger,
      taxable: e.taxable,
      invoiceNo: e.invoiceNo ?? "",
      taxLines: readTaxLines(e.taxLinesJson),
      tdsLedger: e.tdsLedger ?? "",
      tdsAmount: e.tdsAmount ?? 0,
      voucherDate: localDate(isoDate(e.invoiceDate)) ?? new Date(),
      narration: e.narration ?? "",
    });
  }
  return out.sort((a, b) => a.billId - b.billId);
}

/**
 * Build the XML for a set of bill ids. Changes nothing.
 *
 * A bill confirmed as a vendor invoice has a fin_vendor_entry row and is NOT a
 * reimbursement, so it is pulled out of the reimbursement lines rather than
 * built twice: linesFor() reads the extraction, which every bill has, but
 * fin_vendor_entry is what a human decided this one actually is, so it wins.
 */
export async function buildForBills(billIds: readonly number[]): Promise<BuildBatchResult> {
  const [{ lines, blocked }, vendorLines, known, exportedIds] = await Promise.all([
    linesFor(billIds),
    vendorLinesFor(billIds),
    knownLedgerNames(),
    // buildBatch re-checks this set for every line it is handed, so only the
    // requested ids need to be in it. It duplicates linesFor's own check on
    // purpose: the vendor lines never pass through linesFor, and this is the
    // guard that stops a purchase invoice being exported twice.
    loadExportedBillIds(billIds),
  ]);

  const vendorIds = new Set(vendorLines.map((v) => v.billId));
  const reimbursements = lines.filter((l) => !vendorIds.has(l.billId));

  const result = buildBatch(reimbursements, TALLY.company, known, {
    voucherType: TALLY.batchVoucherType,
    cashLedger: TALLY.cashLedger,
    newExpenseParent: TALLY.newLedgerParent,
    newPersonParent: TALLY.newPersonParent,
    companyGstin: TALLY.companyGstin,
    gstRegistration: TALLY.gstRegistration,
    gstState: TALLY.gstState,
    createVoucherType: TALLY.createVoucherType,
    voucherTypeParent: TALLY.voucherTypeParent,
    voucherNoPrefix: TALLY.voucherNoPrefix,
    alreadyExported: exportedIds,
    vendorLines,
    newVendorParent: TALLY.newPersonParent,
  });

  // Ineligible bills are REPORTED, never silently dropped, and they lead the
  // list: "a person must confirm it first" is more actionable than anything
  // buildBatch can say about a line it never received.
  result.skipped = [...blocked, ...result.skipped];
  return result;
}

/** The review spreadsheet as base64. NOT importable - Tally's Excel import
 *  cannot create masters, so it would fail confusingly on any batch with a new
 *  ledger. It exists to be read by a human before the XML is imported. */
export function xlsxBase64(
  lines: BatchLine[],
  newLedgers: Array<{ name: string; parent: string }>,
): string {
  const wb = buildBatchExcel(lines, newLedgers);
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

export interface RecordedExport {
  ref: string;
  vouchers: number;
  total: number;
}

/**
 * Write the export down and lock its bills.
 *
 * Recording is not bookkeeping for its own sake. The batch posts under Tally's
 * standard Journal, which Tally will happily import twice - proven on PESPL's
 * live data, where five imports of one test file produced ten vouchers without
 * a complaint. So fin_export IS the duplicate guard: a bill in it is excluded
 * from every later batch with the reason shown.
 *
 * One transaction. A half-written export - the XML row saved but the bills
 * still 'approved' - would be swept into tomorrow's batch and paid twice.
 */
export async function recordExport(
  result: BuildBatchResult,
  user: string,
): Promise<RecordedExport> {
  const ref = batchFilename();
  const xlsx = xlsxBase64(result.lines, result.newLedgers);
  const vendorIds = new Set(result.vendorLines.map((v) => v.billId));
  const allIds = [...result.lines.map((l) => l.billId), ...vendorIds];

  await prisma.$transaction(async (tx) => {
    await tx.financeExport.create({
      data: {
        ref,
        xml: result.xml,
        xlsxBase64: xlsx,
        vouchers: result.vouchers,
        total: result.total,
        newLedgers: result.newLedgers,
        status: "generated",
        createdBy: user,
      },
    });
    await tx.financeExportBill.createMany({
      data: [
        ...result.lines.map((l) => ({
          ref,
          billId: l.billId,
          voucherNo: (l.voucherNo || "").trim()
            || voucherNumber(l.billId, l.voucherDate, TALLY.voucherNoPrefix),
        })),
        // A purchase voucher is numbered with the supplier's own invoice number.
        ...result.vendorLines.map((v) => ({
          ref,
          billId: v.billId,
          voucherNo: (v.voucherNo || "").trim() || v.invoiceNo,
        })),
      ],
      skipDuplicates: true,
    });
    await tx.financeBill.updateMany({
      where: { id: { in: allIds } },
      data: { status: "posted" },
    });
  });

  // ---- the masters this file creates, written into OUR master too ----------
  //
  // buildBatch emits a <LEDGER> block for every name that was not in
  // fin_ledger, so importing the file creates them in Tally. Until now they
  // were recorded only as JSON on the export row, which meant a ledger born at
  // export was invisible to every picker, and to the classifier, until somebody
  // re-imported MASTER.xml. The next bill needing the same head got typed
  // again, slightly differently, and then there were two.
  //
  // AFTER the transaction, and swallowing its own failure, deliberately. The
  // transaction above is the duplicate guard - a bill in fin_export is excluded
  // from every later batch - and rolling that back over a failed convenience
  // write would offer bills for export that are already in a file somebody is
  // about to import. A statement that errors inside a Postgres transaction
  // aborts the whole transaction whether or not the error is caught, so this
  // cannot simply be moved inside and wrapped.
  //
  // The parent is what distinguishes the two kinds: buildBatch files a new
  // expense head under newExpenseParent and a new person or vendor under
  // newPersonParent (buildForBills above passes both).
  if (result.newLedgers.length) {
    try {
      await upsertLedgers(result.newLedgers.map((l) => newLedgerRow({
        name: l.name,
        parent: l.parent,
        kind: l.parent === TALLY.newLedgerParent ? "expense" : "ledger",
      })));
    } catch (err) {
      console.error("[finance] ledger write-back failed for export", ref, err);
      await logEvent(
        "error",
        `Export ${ref} was written, but ${result.newLedgers.length} new ledger(s) ` +
        "could not be added to the ledger master. They will still be created in " +
        "Tally by the import; re-import MASTER.xml to see them in the pickers.",
      );
    }
  }

  return { ref, vouchers: result.vouchers, total: result.total };
}
