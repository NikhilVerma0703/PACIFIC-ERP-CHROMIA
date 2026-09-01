// Undo the harm scripts/0064 and 0065 did, and finish the job they half-did.
//
// The adversarial review of those two repairs found four things. Every one is
// re-derived here rather than taken on trust, and the script prints what it
// would do unless it is run with --apply.
//
//  1. SALES VISIBILITY. Approval is keyed on (canonical design, displayBatch
//     (batch)) — fg_sales_approved_batch. 0065 changed 404 slabs' batches and
//     touched nothing else, so 192 of them (181 AVAILABLE, 11 DISPATCHED)
//     landed on a pair Sales has never approved: hidden from the register and
//     the export, and refused by dispatch and location, which fail closed. The
//     slab-intake form has always carried the approval across when it moves a
//     slab (approveDesignBatch in app/slab-intake/actions.ts); the repair did
//     not. The pair is derived HERE with the same approvalKey() both of those
//     use — that file exists because a second implementation once wrote an
//     approval the gate never looked up, and this must not be the second.
//
//  2. THE JUNK KEYS. For 34 slabs the only difference between finished goods
//     and QC was a prefix — '158' against 'A/158' — and 0065 copied QC's
//     spelling over the cleaner one. normalizeBatch turns every typed form into
//     '/158', which never equals a stored 'A/158', so those slabs became
//     unreachable by the batch filter entirely. Reverted, not approved:
//     finished goods held the right value and 0065 should have left it.
//
//  3. SLAB 156615. 0064 read it as graded under the wrong batch and moved it to
//     1427. It was not: the QC row's design is 'Honey dew', which is 1426's,
//     while the physical slab is Calacatta Grey at press and jot, and the row
//     sits inside inspector moorthy's unbroken 1426 run between 156414 at
//     03:44:18 and 156416 at 03:45:19. The number meant was 156415 — but
//     156415 ALREADY HAS a QC row, so retargeting would create a duplicate.
//     The move is therefore reverted to where it was, which restores the slab's
//     approval and puts 1427 back to the four slabs the plant actually
//     finished. The mis-keyed row itself is left for a person and named below.
//
//  4. The third polish-entry typo 0064 missed: 156325 -> 153625, the same 6/3
//     transposition it fixed twice, landing on the last 1406 slab with no
//     polish entry. press says 156325 is Calacatta Gold in 1425 while the row
//     claims Super White in 1406, and it predates batch 1425 by a fortnight.
//
// Run:  npx tsx scripts/0066-repair-0064-0065-fallout.mts [--apply]
import { readFileSync } from "node:fs";

const env = readFileSync("C:/Users/user/Desktop/ERP/.env", "utf8");
for (const k of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
  const m = env.match(new RegExp("^" + k + '="?([^"\\r\\n]+)"?', "m"));
  if (m) process.env[k] = m[1];
}

const APPLY = process.argv.includes("--apply");
const { PrismaClient } = await import("@prisma/client");
const { approvalKey } = await import("../src/lib/inventory/approvalKey.ts");
const prisma = new PrismaClient();
const q = (s: string, ...a: unknown[]) => prisma.$queryRawUnsafe(s, ...a) as Promise<any[]>;
const run = async (s: string, ...a: unknown[]) => (APPLY ? Number(await prisma.$executeRawUnsafe(s, ...a)) : -1);
const say = (s: string) => console.log(s);

say(APPLY ? "APPLYING\n" : "DRY RUN — nothing is written. Re-run with --apply.\n");

/* 3 — slab 156615 back where it was ------------------------------------- */
const cur = await q("SELECT batch_number b FROM polish_qc WHERE slab_number = 156615");
if (cur[0]?.b === "D1427") {
  const a = await run("UPDATE polish_qc SET batch_number = 'D1426', batch_key = '1426' WHERE slab_number = 156615 AND batch_key = '1427'");
  const b = await run("UPDATE fg_finished_slab SET batch_number = 'D1426', batch_key = '1426' WHERE slab_number = 156615 AND batch_key = '1427'");
  say("156615: reverted to D1426 (qc " + a + ", fg " + b + "). Its QC row is a mis-key of 156415, which already has its own QC row — left for a person to settle.");
} else {
  say("156615: batch is " + (cur[0]?.b ?? "(no QC row)") + " — nothing to revert");
}

/* 2 — the junk-prefixed keys back to the cleaner value ------------------- */
const junk = await q(
  "SELECT slab_number::bigint sn, old_value ov, new_value nv FROM fg_slab_event " +
  "WHERE changed_by = 'data repair (scripts/0065)' AND kind = 'batch_corrected' " +
  "AND new_value !~ '^[0-9]+$' ORDER BY slab_number");
let junkDone = 0;
/** Slabs the revert above puts back on their original, already-approved pair.
 *  They must be excluded from the approval carry below or the dry run proposes
 *  approving the very junk key it is removing — and on apply the two fixes
 *  would race on ordering rather than being independent. */
const revertedSlabs = new Set<number>(junk.map((r: any) => Number(r.sn)));
for (const r of junk) {
  const raw = String(r.ov ?? "");
  const key = raw.replace(/^[A-Za-z]+-?/, "") || raw;
  const n = await run(
    "UPDATE fg_finished_slab SET batch_number = $1, batch_key = $2 WHERE slab_number = $3 AND batch_number = $4",
    raw, key, Number(r.sn), r.nv);
  junkDone += APPLY ? n : 1;
}
say("junk keys: " + junk.length + " slabs reverted to the finished-goods spelling (e.g. 'A/158' back to '158'), the one the batch filter can actually match" + (APPLY ? " — " + junkDone + " rows written" : ""));

/* 1 — carry the approval across for everything 0065 still has moved ------ */
const aliasRows = await q('SELECT variant, canonical FROM "DesignAlias"').catch(() => [] as any[]);
const amap = new Map<string, string>(aliasRows.map((a: any) => [a.variant, a.canonical]));
const approved = new Set(
  (await q("SELECT design, batch FROM fg_sales_approved_batch")).map((r: any) => r.design + "\u0000" + r.batch));
const moved = await q(
  "SELECT DISTINCT ON (e.slab_number) e.slab_number::bigint sn, e.old_value ov, " +
  "f.design, f.batch_number bn, f.status::text st " +
  "FROM fg_slab_event e JOIN fg_finished_slab f ON f.slab_number = e.slab_number " +
  "WHERE e.changed_by = 'data repair (scripts/0065)' AND e.kind = 'batch_corrected' " +
  "ORDER BY e.slab_number, e.at DESC");

const need = new Map<string, { design: string; batch: string; slabs: number[]; statuses: string[] }>();
for (const r of moved) {
  if (revertedSlabs.has(Number(r.sn))) continue;   // handled by the revert above
  const canon = amap.get(r.design ?? "") ?? (r.design ?? "(no design)");
  const before = approvalKey(canon, r.ov);
  const after = approvalKey(canon, r.bn);
  if (!approved.has(before.design + "\u0000" + before.batch)) continue;   // was never sellable
  if (approved.has(after.design + "\u0000" + after.batch)) continue;      // already fine
  const k = after.design + "\u0000" + after.batch;
  if (!need.has(k)) need.set(k, { design: after.design, batch: after.batch, slabs: [], statuses: [] });
  need.get(k)!.slabs.push(Number(r.sn));
  need.get(k)!.statuses.push(r.st);
}
const slabCount = [...need.values()].reduce((a, p) => a + p.slabs.length, 0);
say("approval to carry: " + need.size + " (design, batch) pairs covering " + slabCount + " slabs");
for (const p of [...need.values()].sort((a, b) => b.slabs.length - a.slabs.length).slice(0, 8)) {
  say("   " + p.design + " / " + p.batch + "  — " + p.slabs.length + " slabs");
}
for (const p of need.values()) {
  await run(
    "INSERT INTO fg_sales_approved_batch (design, batch, approved_by) VALUES ($1, $2, $3) " +
    "ON CONFLICT (design, batch) DO NOTHING",
    p.design, p.batch,
    "carried by scripts/0066 — this stock was approved under the batch it held before scripts/0065 moved it");
}

/* 4 — the third polish-entry typo --------------------------------------- */
const third = await q("SELECT id FROM polish_entry WHERE id = 'cmsnqdmqf0008l704ph5aa2hs' AND slab_number = 156325");
const clash = await q("SELECT count(*)::int n FROM polish_entry WHERE slab_number = 153625");
if (third.length && clash[0].n === 0) {
  const n = await run("UPDATE polish_entry SET slab_number = 153625 WHERE id = 'cmsnqdmqf0008l704ph5aa2hs' AND slab_number = 156325");
  say("polish entry 156325 -> 153625" + (APPLY ? " (" + n + " row)" : "") + " — the third of the same typo; 0064 fixed two and missed this one");
} else {
  say("polish entry 156325: " + (third.length ? "target 153625 is occupied — skipped, needs a person" : "already corrected"));
}

if (APPLY) {
  await prisma.$executeRawUnsafe(
    "INSERT INTO action_log (id, created_at, actor, batch_key, kind, model, summary, payload, undone) VALUES " +
    "('repair-0064-0065-fallout', now(), 'data repair (scripts/0066)', NULL, 'repair_fallout', " +
    "'FinishedSlab/PolishQc/PolishEntry/SalesApproval', $1, '{}'::jsonb, false) ON CONFLICT (id) DO NOTHING",
    "Undid the harm of scripts/0064 and 0065: slab 156615 returned to 1426, " + junk.length +
    " junk-prefixed batch keys reverted, sales approval carried across " + need.size +
    " design/batch pairs covering " + slabCount + " slabs, and the third polish-entry typo corrected.");
}

await prisma.$disconnect();
say(APPLY ? "\nDONE" : "\nDRY RUN COMPLETE — re-run with --apply to write.");
