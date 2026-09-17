---
name: incentive-month-tracker
description: "Where the shift incentive is settled each month (page, snapshot script, printable notice) and the three decisions still open before anyone is paid."
metadata: 
  node_type: memory
  type: project
  originSessionId: 10143026-5554-4a83-93c5-54e7462fd1b1
  modified: 2026-09-02T10:27:46.234Z
---

The monthly shift incentive is settled from `/scoreboard/incentive?month=YYYY-MM` (admin-only, same gate as the scoreboard). It re-scores nothing: it calls `scoreRange()` and groups by shift letter (`src/lib/incentiveMath.ts`), with the pool ladder in `src/lib/incentiveLadder.ts` (checked row-for-row against `scripts/make-incentive-notice-pdf.py` by a test). The record is `npx tsx scripts/incentive-month.mts YYYY-MM` -> `docs/incentive/<month>.json`, and the two-page settlement is `python scripts/make-incentive-month-pdf.py YYYY-MM` -> `docs/INCENTIVE-<month>.pdf`. Committed 2026-09-02 (15f1595).

Rules in force (decided 2026-09-02): B = half a slab, reject = 0; an hour whose `slabs_per_hour_std` is 10 or less counts each good slab twice (`stdMultiplier`, threshold on the STANDARD, blank = 1). Ladder is a STEP table starting at 7,000 counted slabs.

**Why:** August 2026 sat at ~6,200 counted with ~1,100 slabs still ungraded; projected ~7,600 -> the Rs 3 lakh row. Without the slow-product rule the month never clears 7,000. Every figure moves as QC grades, so the page, not a document, is the source.

**How to apply:** Before any payout, get the owner's answer on three open points: (1) the ladder is read as steps, not a slope (7,656 pays the 7,000 row - a Rs 2 lakh difference if interpolated); (2) the Rs 41 lakh bill is assumed split equally across the three shifts (this reproduces the notice's worked example, but managers/R&D may not be on rotation); (3) quality method - the scoreboard averages each instance's scaled score, the notice scored the month's whole grade share once (August differs by <= 0.21 points of share). The 112 headcount is still marked provisional. Related: [[mis-target-policy-standardisation]] (the downtime page's target model is untouched; `capacityFigures` only bounds the downtime claim so achievable is never below actual).
