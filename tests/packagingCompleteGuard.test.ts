import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDroppedFromQueues } from "../src/lib/fab/rejectPiece.ts";
import { isReadyForPackaging } from "../src/lib/fab/routing.ts";

// PACKING IS THE LAST GATE, SO IT HAS TO BE A GATE.
//
// The packaging queue GET filtered carefully — dropped statuses out, cut
// confirmed, isReadyForPackaging — and the complete route then claimed whatever
// piece ids the tablet posted with nothing but "not already PACKAGED". The
// tablet never prunes its `selected` set when the queue refreshes, so a piece a
// supervisor rejected after the packer loaded the screen was still submitted:
// it became PACKAGED, got a package row, completed its PACKAGING operation,
// counted in CEO packaging throughput, and if it was a sample piece put
// rejected stone on the sampling shelf via creditSampleStock.
//
// These are structural — they read the route rather than call it, because what
// is being protected is not a wrong value but a missing filter, and the two
// files that must agree (the queue's idea of "not in a queue" and the claim's
// idea of "not claimable") sit in different places and drift silently.

const ROUTE_URL = new URL("../src/app/api/fab/queues/packaging/complete/route.ts", import.meta.url);
const route = readFileSync(ROUTE_URL, "utf8");

/** The FabPieceStatus values, read from the schema so a status added later is
 *  covered by the invariant below without anyone remembering this file. */
function pieceStatuses(): string[] {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const block = /enum\s+FabPieceStatus\s*\{([^}]*)\}/.exec(schema);
  assert.ok(block, "FabPieceStatus enum not found in prisma/schema.prisma");
  return block[1].split("\n").map((l) => l.trim()).filter((l) => /^[A-Z_]+$/.test(l));
}

/** The statuses the claim refuses, taken from the route's own updateMany. */
function claimExcludes(): string[] {
  const m = /status:\s*\{\s*notIn:\s*\[([^\]]*)\]/.exec(route);
  assert.ok(m, "the claim no longer excludes a LIST of statuses — a bare `not: \"PACKAGED\"` lets rejected and uncut pieces be packed");
  return [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
}

test("the claim refuses every status the queues refuse to show", () => {
  const excluded = new Set(claimExcludes());
  // PACKAGED is the concurrency guard and is not a "dropped" status, so it is
  // asserted separately from the isDroppedFromQueues invariant.
  assert.ok(excluded.has("PACKAGED"), "two concurrent submits must not both claim the same piece");
  for (const status of pieceStatuses()) {
    if (!isDroppedFromQueues(status)) continue;
    assert.ok(
      excluded.has(status),
      `${status} is hidden from every station queue but the packaging claim would still take it — ` +
      `that is how a rejected piece became PACKAGED and, as a sample, reached the shelf`,
    );
  }
});

test("REJECTED and PENDING are the two that actually bit", () => {
  // Named explicitly as well as derived, so that weakening isDroppedFromQueues
  // cannot quietly weaken the test above with it.
  const excluded = new Set(claimExcludes());
  assert.ok(excluded.has("REJECTED"), "a rejected piece must never be packable");
  assert.ok(excluded.has("PENDING"), "an uncut piece must never be packable");
});

test("the routing rule is re-checked inside the transaction, not just at the queue", () => {
  // Status alone does not mean finished: a piece still owing polish, a sink cut
  // or fabrication sits at CUT/POLISHED, which the status filter accepts. The
  // claim must therefore re-run the SAME predicate the queue filters on.
  assert.ok(
    /from\s+"@\/lib\/fab\/routing"/.test(route) && route.includes("isReadyForPackaging"),
    "the complete route must re-verify isReadyForPackaging on the rows it claimed",
  );
  const tx = route.slice(route.indexOf("prisma.$transaction"));
  assert.ok(
    tx.indexOf("isReadyForPackaging") > tx.indexOf("updateMany"),
    "the re-check must run AFTER the claim and INSIDE the transaction, so a failed check rolls the package back",
  );
});

test("the predicate being re-checked is the one that blocks unfinished pieces", () => {
  // A behavioural anchor for the structural checks above: if this ever passes
  // for a piece that still owes a stage, the re-check is worthless.
  const half = {
    polishRequired: true, polishingCompleted: false,
    hasSink: true, sinkCompleted: true,
    fabricationRequired: false, fabricationCompleted: false,
  };
  assert.equal(isReadyForPackaging(half), false);
  assert.equal(isReadyForPackaging({ ...half, polishingCompleted: true }), true);
});
