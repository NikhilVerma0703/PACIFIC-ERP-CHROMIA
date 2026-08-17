import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStaleProcessing, RECLAIM_NOTE, staleReclaim, STALE_PROCESSING_MS,
} from "../src/lib/finance/pipelineRules.ts";

// The gap these rules close: processQueued claims a bill by moving it
// 'queued' -> 'processing' (an atomic compare-and-set) and records anything
// processBill throws. Neither covers the invocation simply ending — maxDuration
// reached, container recycled — which leaves the row in 'processing' with no
// query anywhere selecting it. The batch then reports finished:false forever
// and the bill is not in any status the review queue lists, so a real expense
// that was uploaded and accepted becomes invisible.

test("a fresh claim is not stale", () => {
  const now = new Date("2026-08-17T10:00:00Z");
  const justNow = new Date(now.getTime() - 2_000);
  assert.equal(isStaleProcessing(justNow, now), false);
});

test("the cutoff sits well beyond any run the platform allows", () => {
  // maxDuration on the poll route is 60s. The window must be comfortably past
  // that, or a slow-but-alive OCR round trip gets reclaimed underneath itself
  // and the same bill is read twice.
  assert.ok(STALE_PROCESSING_MS > 60_000 * 2,
    `window ${STALE_PROCESSING_MS}ms is too close to the 60s function cap`);

  const now = new Date("2026-08-17T10:00:00Z");
  const atCap = new Date(now.getTime() - 60_000);
  assert.equal(isStaleProcessing(atCap, now), false,
    "a bill still inside the function's own time budget is alive, not orphaned");
});

test("a claim older than the window is orphaned", () => {
  const now = new Date("2026-08-17T10:00:00Z");
  const old = new Date(now.getTime() - STALE_PROCESSING_MS - 1);
  assert.equal(isStaleProcessing(old, now), true);
  // Exactly on the boundary is not yet stale — strictly greater.
  const boundary = new Date(now.getTime() - STALE_PROCESSING_MS);
  assert.equal(isStaleProcessing(boundary, now), false);
});

test("the first interruption sends the bill back to be read again", () => {
  const v = staleReclaim(null);
  assert.equal(v.status, "queued");
  assert.ok(v.error.startsWith(RECLAIM_NOTE));
  // Not 'error': the usual cause is one slow OCR round trip, and the retry
  // normally works. Parking it as a failure would make a clerk chase a bill
  // that would have read itself.
  assert.notEqual(v.status, "error");
});

test("the second interruption stops the retry and asks for a human", () => {
  // Without this a bill that reliably times out is reclaimed and re-read
  // forever, paying for a hosted OCR call each time and never finishing.
  const first = staleReclaim(null);
  const second = staleReclaim(first.error);
  assert.equal(second.status, "manual_entry");
  assert.match(second.error, /by hand/i);
});

test("the second-time marker survives a reworded message", () => {
  // Detection is by prefix, so the two sentences can be rewritten without
  // silently turning every second interruption back into a first — which would
  // restore the infinite retry loop.
  assert.ok(staleReclaim(`${RECLAIM_NOTE} — anything at all after this`).status === "manual_entry");
});

test("an unrelated error note is not mistaken for a previous interruption", () => {
  // Bills carry other notes in the same column: a rejection reason, a failure
  // message, the browser-OCR wait note. None of them means "already retried",
  // and treating one as such would send a first-time bill straight to manual
  // entry instead of simply reading it again.
  for (const note of [
    "Waiting for browser OCR (OCR_PROVIDER=tesseract). Keep the bills tab open.",
    "Error: Claude OCR failed (HTTP 529).",
    "rejected in the ERP",
    "",
  ]) {
    assert.equal(staleReclaim(note).status, "queued", `misread note: ${note}`);
  }
});
