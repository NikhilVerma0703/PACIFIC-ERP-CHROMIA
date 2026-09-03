import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A guard, not a unit test — the same kind as sourceEncoding.test.ts, and for
// the same reason: the failure it catches is invisible to tsc and to every
// other test, and only a human looking at the rendered page would notice.
//
// THE INCIDENT. The owner asked (2026-09-03) for the incentive screen's money
// to come down until three scheme decisions are settled. SHOW_PAYOUT_AMOUNTS
// was added, ONE card was put behind it, and its comment asserted "Nothing else
// on the page reads it." That was false. The visible "three shifts" table drew
// the IDENTICAL share-of-pool percentages in its last two columns — identical
// by construction, because incentiveMonth's moneyFor() copies `share: r.share`
// straight through — and the pool's own rupee total was still printed in the
// "Pool today" KPI, the unlocked banner, the ladder labels and the projection.
// Share x pool is a multiplication, and both figures sat on one screen. The
// number the owner took down was still legible to anyone shown the page.
//
// So the rule this pins is not "one card is hidden". It is: WHILE THE FLAG IS
// OFF, NO RUPEE FIGURE AND NO SHARE-OF-POOL PERCENTAGE MAY REACH THE SCREEN.
// A page-level flag is only as good as the audit of everything that draws the
// same numbers, and that audit is what rotted. This re-runs it on every commit.
//
// What it does NOT object to: slab counts, the 7,000 floor, grade shares,
// quality scores, the ladder's slab rungs, QC pace. They are the month's work.

const PAGE = "src/app/scoreboard/incentive/page.tsx";
const src = readFileSync(PAGE, "utf8");
const lines = src.split(/\r?\n/);

/** Lines inside a multi-line `{FLAG && ( … )}` or `{FLAG && <> … </>}` block for
 *  EITHER flag, plus the lines that name a flag themselves. A single-line guard
 *  is covered by the second half.
 *
 *  BOTH FLAGS COUNT AS A GUARD HERE, and the test below draws the line between
 *  them instead. SHOW_LADDER_AMOUNTS (on) may carry the ladder's published rung
 *  amounts; SHOW_PAYOUT_AMOUNTS (off) carries this month's pool, a shift's share
 *  of it and a person's slice. A rupee figure behind NEITHER is the leak this
 *  file exists to catch. */
function guardedLines(): Set<number> {
  const guarded = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/SHOW_PAYOUT_AMOUNTS|SHOW_LADDER_AMOUNTS/.test(line)) continue;
    guarded.add(i);
    // Only an unterminated opener starts a block: `&& (` or `&& <>` at the end.
    if (!/&&\s*(\(|<>)\s*$/.test(line)) continue;
    let closed = false;
    for (let j = i + 1; j < lines.length; j++) {
      guarded.add(j);
      const t = lines[j].trim();
      if (t === ")}" || t === "</>}") { closed = true; break; }
    }
    // An opener with no terminator means this scanner has lost the shape of the
    // file. Fail loudly rather than quietly marking the rest of it guarded.
    assert.ok(closed, `${PAGE}:${i + 1} opens a SHOW_PAYOUT_AMOUNTS block that this test cannot find the end of — check the guard by hand`);
  }
  return guarded;
}

/** Comments say what the flag hides; they are allowed to name the figures. */
function codeOnly(): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let t = lines[i];
    if (inBlockComment) {
      if (/\*\/|\*\/\}/.test(t)) { inBlockComment = false; t = t.replace(/^[\s\S]*?\*\/\}?/, ""); }
      else continue;
    }
    t = t.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "");     // whole comment on one line
    if (/\{?\/\*/.test(t)) { inBlockComment = true; t = t.replace(/\{?\/\*[\s\S]*$/, ""); }
    t = t.replace(/\/\/.*$/, "");
    if (t.trim()) out.push({ n: i + 1, text: t });
  }
  return out;
}

const GUARDED = guardedLines();
const CODE = codeOnly();

test("the flag is off — the owner has not lifted the instruction", () => {
  // If this fails because the owner HAS settled the three decisions, that is
  // the good ending: flip the flag, and delete this one test. Every other
  // assertion below still holds, because they only bite while it is false.
  assert.match(src, /const SHOW_PAYOUT_AMOUNTS = false;/);
});

test("no rupee figure is drawn outside the flag", () => {
  // lakh() and inr() are the page's only two rupee formatters, so every rupee
  // on screen goes through one of them.
  const escaped = CODE.filter(({ n, text }) =>
    /\b(lakh|inr)\(/.test(text) &&
    !/^const (lakh|inr) =/.test(text.trim()) &&   // the formatters themselves
    !GUARDED.has(n - 1));
  assert.deepEqual(escaped.map((e) => `${PAGE}:${e.n}`), [],
    "a rupee figure reaches the screen with SHOW_PAYOUT_AMOUNTS off — see the flag's comment; this is exactly how the first attempt leaked");
});

test("no share-of-pool percentage is drawn outside the flag", () => {
  // `w` and `a` are the per-shift rows of m.shares.{weighted,aggregate}: a
  // shift's slice of the pool, which is the figure the owner named. Grade share
  // and quality (l.rawShare, l.qualityWeighted) are scores, not slices, and are
  // deliberately not matched here.
  const escaped = CODE.filter(({ n, text }) => /\b[wa]\.share\b/.test(text) && !GUARDED.has(n - 1));
  assert.deepEqual(escaped.map((e) => `${PAGE}:${e.n}`), [],
    "a share of the pool reaches the screen with SHOW_PAYOUT_AMOUNTS off");
});

test("the literal 100% cells go with the share columns they total", () => {
  // The Plant row's two trailing 100% cells are what prove the columns above
  // them are slices of a whole — and if they outlive those columns the row runs
  // two cells wider than its header.
  const escaped = CODE.filter(({ n, text }) => /">100%</.test(text) && !GUARDED.has(n - 1));
  assert.deepEqual(escaped.map((e) => `${PAGE}:${e.n}`), [],
    "the Plant row still totals a column that is no longer drawn");
});

test("the flag's own comment does not repeat the false claim", () => {
  // The first comment said the hidden card was the only reader of these
  // figures. A stale justification is how the next person re-introduces the
  // bug, so the sentence itself is pinned.
  assert.ok(!/Nothing else on the page reads it/.test(src),
    "the flag comment claims nothing else on the page draws these numbers — the three-shift table and the pool KPIs did exactly that");
});

// ── THE LINE BETWEEN THE TWO FLAGS ──────────────────────────────────────────
// SHOW_LADDER_AMOUNTS was added after the first flag was widened too far and
// the owner asked for the ladder's amounts back ("Where are the incentive
// amounts in this bar"). It exists to show the PUBLISHED SCHEME — what each
// rung pays — and nothing else. The risk it introduces is that it becomes a
// back door for the very figures the other flag hides, one well-meant edit at a
// time, so the boundary is pinned here rather than left to a comment.
test("the ladder flag is on, and the payout flag is still off", () => {
  assert.match(src, /const SHOW_LADDER_AMOUNTS = true;/);
  assert.match(src, /const SHOW_PAYOUT_AMOUNTS = false;/);
});

test("the ladder flag guards ONLY the scheme's own rungs", () => {
  // This month's pool, a shift's share of it and a person's bands are promises
  // about THIS month and belong to SHOW_PAYOUT_AMOUNTS. `t.pool` is the ladder
  // constant's own rung and is the one rupee figure this flag may carry.
  const THIS_MONTHS_MONEY = /\b(poolNow|poolReal|poolAll|money\.|\.bands\b|[wa]\.share\b)/;
  const ladderGuarded: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/SHOW_LADDER_AMOUNTS/.test(lines[i])) continue;
    if (/^\s*(\*|\/\/)/.test(lines[i])) continue;          // the flag's own prose
    if (/const SHOW_LADDER_AMOUNTS/.test(lines[i])) continue;
    if (THIS_MONTHS_MONEY.test(lines[i])) ladderGuarded.push(`${PAGE}:${i + 1}`);
  }
  assert.deepEqual(ladderGuarded, [],
    "SHOW_LADDER_AMOUNTS is being used to draw one of THIS month's money figures — that belongs behind SHOW_PAYOUT_AMOUNTS; see both flags' comments");
});

test("a reader still cannot derive a shift's slice from the page", () => {
  // The defect the widening fixed: share x pool, two figures on one screen. The
  // ladder amounts alone do not reconstitute it, because a shift's SHARE is
  // still hidden — so this asserts the half that must stay hidden is hidden. If
  // someone un-gates the share columns while the ladder shows amounts, the
  // multiplication is back on the screen and this fails.
  const shareEscaped = CODE.filter(({ n, text }) =>
    /\b[wa]\.share\b/.test(text) && !GUARDED.has(n - 1));
  assert.deepEqual(shareEscaped.map((e) => `${PAGE}:${e.n}`), []);
  // and belt: the per-shift share must not be behind the LADDER flag either,
  // which the previous test enforces from the other direction.
  assert.ok(/SHOW_PAYOUT_AMOUNTS/.test(src), "the payout flag has been deleted entirely");
});
