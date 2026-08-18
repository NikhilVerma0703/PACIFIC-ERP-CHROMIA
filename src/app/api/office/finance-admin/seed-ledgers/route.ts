import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/lib/rbac";
import { CLASSIFY, TALLY } from "@/lib/finance/config";
import { loadFromMasterXml, summarise, type Ledger } from "@/lib/finance/ledgers";
import {
  buildSeedRows, parseLedgersJson, parseUsage, sniffPayload,
  type SeedLedgerInput, type SeedLedgerRow, type SeedRules,
} from "@/lib/finance/ledgerSeed";

// Seeding the chart of accounts. ADMIN ONLY, and separate from
// /api/office/finance/* on purpose: that namespace is the clerk-facing engine
// contract, and writing 2,500 rows into the ledger master is an act of a
// different kind. Middleware already restricts the whole /api/office/finance
// prefix (this path matches it) to Finance/Accounts/admin; isAdmin() below
// narrows it the rest of the way.
//
// WITHOUT THIS ROUTE HAVING BEEN RUN, NOTHING WORKS. `fin_ledger` is the source
// of both the claimant dropdown (isPerson) and the classifier's entire
// vocabulary (isExpense), so an empty table means an empty person list and a
// classifier that suggests nothing - looking, from the clerk's side, exactly
// like a broken screen. The GET below exists so the admin card can say so.
//
// The decisions live in lib/finance/ledgerSeed.ts, which is pure and tested.
// This file is only I/O: read the body, parse it, write the rows.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 2,500 upserts in chunks plus a usage pass. Seconds on a warm Neon connection,
// but a cold pooler handshake plus a 30 MB parse deserves room.
export const maxDuration = 60;

const RULES: SeedRules = {
  peopleGroup: TALLY.peopleGroup,
  allowedNatures: CLASSIFY.allowedNatures,
  excludedRootGroups: CLASSIFY.excludedRootGroups,
};

/** Rows per INSERT. 400 x 6 parameters is comfortably under Postgres's 65,535
 *  bind-parameter ceiling, and turns PESPL's 2,538 ledgers into 7 round trips
 *  instead of 2,538. Upserting one at a time over a Neon connection is the
 *  difference between four seconds and four minutes. */
const CHUNK = 400;

/** Refuse to prune against a payload this small. A pruning import driven by a
 *  20-line test file would silently delete the live master, and the operation
 *  has no undo short of re-importing from Tally. */
const MIN_ROWS_TO_PRUNE = 100;

// ---------------------------------------------------------------------------
// GET - what is currently loaded
// ---------------------------------------------------------------------------

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const [total, people, expense, withGstin, usage, newest, samplePeople] =
    await Promise.all([
      prisma.financeLedger.count(),
      prisma.financeLedger.count({ where: { isPerson: true } }),
      prisma.financeLedger.count({ where: { isExpense: true } }),
      prisma.financeLedger.count({ where: { gstin: { not: null } } }),
      prisma.financeLedgerUsage.count({ where: { count: { gt: 0 } } }),
      prisma.financeLedger.findFirst({
        orderBy: { syncedAt: "desc" },
        select: { syncedAt: true },
      }),
      prisma.financeLedger.findMany({
        where: { isPerson: true },
        select: { name: true },
        orderBy: { name: "asc" },
        take: 3,
      }),
    ]);

  return NextResponse.json({
    ok: true,
    total,
    people,
    expense,
    withGstin,
    usage,
    syncedAt: newest?.syncedAt?.toISOString() ?? null,
    peopleGroup: TALLY.peopleGroup,
    samplePeople: samplePeople.map((r) => r.name),
  });
}

// ---------------------------------------------------------------------------
// POST - import a master
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  let text: string;
  let prune = false;
  let extraUsage: Record<string, number> = {};

  try {
    const read = await readPayload(req);
    text = read.text;
    prune = read.prune;
    extraUsage = read.usage;
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "The upload was empty." }, { status: 400 });
  }

  // ---- parse -------------------------------------------------------------
  let ledgers: SeedLedgerInput[];
  let usage: Record<string, number>;
  let source: "master_xml" | "ledgers_json";
  /** Kept typed as `Ledger[]` on the XML path so summarise() can report the
   *  seed-vocabulary coverage, which is the cold-start number that matters. */
  let full: Ledger[] | null = null;

  const kind = sniffPayload(text);
  try {
    if (kind === "xml") {
      source = "master_xml";
      // The 30 MB regex sweep. loadFromMasterXml is deliberately not an XML
      // parser - Tally's export is not reliably well-formed - and it is the same
      // function the Python used, so the ledger list is identical.
      full = loadFromMasterXml(text);
      ledgers = full;
      usage = {};
    } else if (kind === "json") {
      source = "ledgers_json";
      const parsed = parseLedgersJson(text);
      ledgers = parsed.ledgers;
      usage = parsed.usage;
    } else {
      return NextResponse.json({
        error:
          "Unrecognised file. Upload MASTER.xml (Gateway of Tally -> Alt+E -> " +
          "Masters -> All Masters -> XML) or a ledgers.json.",
      }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }

  const { rows, usage: inlineUsage, summary } = buildSeedRows(ledgers, RULES);
  if (!rows.length) {
    return NextResponse.json(
      { error: summary.notes[0] ?? "No ledgers were found in that file." },
      { status: 400 },
    );
  }

  // Usage may arrive three ways; later sources win. Inline `usage` on a ledger
  // row is the most specific, so it goes last.
  const usageRows = { ...extraUsage, ...usage, ...inlineUsage };

  // ---- write -------------------------------------------------------------
  const names = rows.map((r) => r.name);
  let stale = 0;
  let pruned = 0;
  const notes = [...summary.notes];

  try {
    stale = await prisma.financeLedger.count({ where: { name: { notIn: names } } });

    // ONE transaction. A half-written master is worse than no master: the
    // classifier would run against a partial vocabulary and quietly suggest the
    // wrong head, which nobody notices, whereas a failed import is a red box.
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.$executeRaw`
          INSERT INTO fin_ledger (name, parent, gstin, is_person, is_expense, synced_at)
          VALUES ${values(rows.slice(i, i + CHUNK), now)}
          ON CONFLICT (name) DO UPDATE SET
            parent     = EXCLUDED.parent,
            gstin      = EXCLUDED.gstin,
            is_person  = EXCLUDED.is_person,
            is_expense = EXCLUDED.is_expense,
            synced_at  = EXCLUDED.synced_at
        `;
      }

      const usageEntries = Object.entries(usageRows);
      for (let i = 0; i < usageEntries.length; i += CHUNK) {
        const slice = usageEntries.slice(i, i + CHUNK);
        await tx.$executeRaw`
          INSERT INTO fin_ledger_usage (ledger, count)
          VALUES ${Prisma.join(slice.map(([l, c]) => Prisma.sql`(${l}, ${c})`))}
          ON CONFLICT (ledger) DO UPDATE SET count = EXCLUDED.count
        `;
      }

      if (prune && stale) {
        if (rows.length < MIN_ROWS_TO_PRUNE) {
          notes.push(
            `Prune skipped: this file has only ${rows.length} ledgers, and removing ` +
            `${stale} rows on that basis is more likely a mistake than an intent. ` +
            "Import a full All Masters export to prune.",
          );
        } else {
          const del = await tx.financeLedger.deleteMany({
            where: { name: { notIn: names } },
          });
          pruned = del.count;
        }
      }
    }, { timeout: 120_000, maxWait: 20_000 });
  } catch (err) {
    return NextResponse.json(
      { error: `The ledger master could not be written: ${message(err)}` },
      { status: 500 },
    );
  }

  if (stale && !pruned) {
    notes.push(
      `${stale} ledger(s) already in the master were not in this file. They were ` +
      "left alone - tick \"remove ledgers missing from this file\" to delete them.",
    );
  }
  if (!Object.keys(usageRows).length) {
    notes.push(
      "No usage counts in this file, so the classifier's tie-breaker stays " +
      "neutral. Import Tally's Journal Register to populate it.",
    );
  }

  // summarise() is the ledgers.ts view of the same list - how many ledgers
  // picked up seed vocabulary, which is the cold-start signal worth reporting.
  const aliasSummary = full ? summarise(full) : null;

  return NextResponse.json({
    ok: true,
    source,
    parsed: summary.parsed,
    written: rows.length,
    people: summary.people,
    expense: summary.expense,
    withGstin: summary.withGstin,
    registeredInPeopleGroup: summary.registeredInPeopleGroup,
    duplicates: summary.duplicates,
    byNature: summary.byNature,
    usage: Object.keys(usageRows).length,
    stale,
    pruned,
    withAliases: aliasSummary?.withAliases ?? null,
    peopleGroup: TALLY.peopleGroup,
    notes,
  });
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

/** 30 MB of XML, gzipped by the browser, lands around 1.5 MB. Uncompressed it
 *  would never survive a serverless request-body limit, so the admin card
 *  compresses with CompressionStream and sets this header. Raw bodies still
 *  work for a small ledgers.json or a curl from the office machine. */
const GZIP_HEADER = "x-finance-encoding";

/** Hard ceiling on the DECOMPRESSED payload. A gzip bomb is otherwise a
 *  one-request way to exhaust the function's memory. PESPL's MASTER.xml is
 *  ~30 MB; 96 gives generous headroom without being unbounded. */
const MAX_DECOMPRESSED = 96 * 1024 * 1024;

async function readPayload(req: NextRequest): Promise<{
  text: string; prune: boolean; usage: Record<string, number>;
}> {
  const ct = req.headers.get("content-type") ?? "";
  const gzipped = (req.headers.get(GZIP_HEADER) ?? "").toLowerCase() === "gzip";

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) {
      throw new Error('Attach the master as a "file" field.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      text: decode(bytes, gzipped),
      prune: truthy(fd.get("prune")),
      usage: parseUsage(jsonOrNull(fd.get("usage"))),
    };
  }

  // Raw body. `prune` rides on the query string because the body is the file.
  const bytes = new Uint8Array(await req.arrayBuffer());
  return {
    text: decode(bytes, gzipped),
    prune: truthy(req.nextUrl.searchParams.get("prune")),
    usage: {},
  };
}

function decode(bytes: Uint8Array, gzipped: boolean): string {
  if (!bytes.byteLength) return "";
  if (!gzipped) return new TextDecoder("utf-8").decode(bytes);
  let out: Buffer;
  try {
    out = gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED });
  } catch (err) {
    throw new Error(`The compressed upload could not be read: ${message(err)}`);
  }
  return new TextDecoder("utf-8").decode(out);
}

/** One VALUES tuple per row, as a parameterised fragment. Prisma.sql keeps every
 *  value bound rather than interpolated - a ledger named `'); DROP ...` is data,
 *  and Tally ledger names really do contain quotes and ampersands. */
function values(rows: readonly SeedLedgerRow[], now: Date): Prisma.Sql {
  return Prisma.join(
    rows.map((r) => Prisma.sql`(
      ${r.name}, ${r.parent}, ${r.gstin}, ${r.isPerson}, ${r.isExpense}, ${now}
    )`),
  );
}

function truthy(v: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
}

function jsonOrNull(v: unknown): unknown {
  if (typeof v !== "string" || !v.trim()) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
