import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFromFlags, isReadyForPackaging, pendingStages } from "../src/lib/fab/routing.ts";

// Adversarial: try to break the routing rules I introduced.
test("ADVERSARIAL statusFromFlags: no undo sequence can lose a completed stage", () => {
  // Walk every order the three stages can complete in, then undo each one in
  // turn, and check the status never claims a stage whose flag is false.
  const stages = ["polishingCompleted", "sinkCompleted", "fabricationCompleted"] as const;
  const rank = { CUT: 0, POLISHED: 1, SINK_CUT: 2, FABRICATED: 3 } as const;
  const owner = { POLISHED: "polishingCompleted", SINK_CUT: "sinkCompleted", FABRICATED: "fabricationCompleted" } as const;

  for (let mask = 0; mask < 8; mask++) {
    const f = Object.fromEntries(stages.map((s, i) => [s, !!(mask & (1 << i))])) as any;
    const st = statusFromFlags(f);
    // The reported status must be backed by a flag that is actually set.
    if (st !== "CUT") assert.equal(f[owner[st]], true, `${st} claimed with its flag false: ${JSON.stringify(f)}`);
    // And it must be the HIGHEST such stage — never understate progress.
    for (const [s, o] of Object.entries(owner)) {
      if (f[o]) assert.ok(rank[st] >= rank[s as keyof typeof rank],
        `${st} understates ${s} which is set: ${JSON.stringify(f)}`);
    }
  }
});

test("ADVERSARIAL isReadyForPackaging: exhaustive over all 64 flag combinations", () => {
  const keys = ["polishRequired","polishingCompleted","hasSink","sinkCompleted","fabricationRequired","fabricationCompleted"] as const;
  for (let m = 0; m < 64; m++) {
    const p = Object.fromEntries(keys.map((k, i) => [k, !!(m & (1 << i))])) as any;
    const ready = isReadyForPackaging(p);
    const pend = pendingStages(p);
    // The two must agree in every single case, or a piece is packable on one
    // screen and blocked on another.
    assert.equal(ready, pend.length === 0, `disagree at ${JSON.stringify(p)}`);
    // A piece can never be ready while a REQUIRED stage is incomplete.
    if (ready) {
      assert.ok(!(p.polishRequired && !p.polishingCompleted));
      assert.ok(!(p.hasSink && !p.sinkCompleted));
      assert.ok(!(p.fabricationRequired && !p.fabricationCompleted));
    }
  }
});
