---
name: mis-target-policy-standardisation
description: "CEO wants MIS hourly targets standardized — blank Std deflates \"Target for the day\"; only power/breakdown should excuse, process delays should not; audited manual override wanted."
metadata: 
  node_type: memory
  type: project
  originSessionId: 74c27030-f48c-4296-8b07-072a3508cd02
  modified: 2026-08-23T10:56:14.059Z
---

As of 2026-08-23, the CEO flagged that "Target for the day" in the CEO report is gamed low: it sums operator-typed `slabsPerHourStd` over hours that declared a slab range (dailyReport.ts:100), so an hour with output but blank Std counts its Made while adding 0 to target. Std is only client-required when "Actual" is non-zero (relaxed 2026-07-15, commit ec081ce); the server never validates it; delay hours legally save with blank Std and even with 60 delay minutes and no reason. No standard-rate master exists for Kreos/Distributor; robo has only per-run targetCycleTime.

Agreed direction (proposal delivered 2026-08-23, not yet implemented): match the shift scoreboard's existing rule (shiftScoreMath.ts ~line 283 — only breakdown + power-out excuse; process and cleaning are the shift's own pace). Plan: resolver chain for per-hour std (override → master → robo per-run → typed → day-mean → 12/24 constants), hour target = std × (60 − excused min)/60, gate = row-exists, append-only `mis_target_override` modeled on [[MisDelayReclass pattern]] (misId, prevStd, newStd, reason ≥4 chars, changedBy/At), "Set target" UI, server validations (delay needs reason; output needs std; 1–60 band), cutover-date disclosure per the 2026-07-09/d13939c precedent, later a `mis_std_rate` master (design × productionType × thickness) seeded from typed-Std medians as PROPOSED pending CEO sign-off.

Decisions pending from CEO: actual standard rates, cleaning baseline (180 min/day free?), unlogged-hours policy (exclude-but-name vs charge), achievement % semantics, who may set a 0 target, cutover date. Note the /mis downtime page (downtime.ts) currently excuses ALL delay types in "Achievable" — inconsistent with the scoreboard; plan aligns it.
