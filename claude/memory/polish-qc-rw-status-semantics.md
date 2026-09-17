---
name: polish-qc-rw-status-semantics
description: "In Pacific ERP polish_qc, rw_status \"Can't be Reworked\" is a repairability flag, not scrap — most such slabs still sell as B grade."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9da69148-6570-4257-b960-766faf7d2335
  modified: 2026-08-10T05:36:39.209Z
---

In the Pacific ERP `polish_qc` table, `rw_status = "Can't be Reworked"` means the defect is
permanent (in the slab body, not the surface, so grinding/repolishing cannot remove it). It does
**not** mean the slab was scrapped or written off.

Measured over Apr–Jul 2026 (1,683 such slabs): 46.4% ended up grade B (sold at a downgrade),
36.7% grade C (the actual write-off), 10.8% still ungraded, 4.5% A2, 1.1% CTS, 0.5% A. Just over
half were still sold.

The relationship is one-way: 97% of grade-C rejects carry this flag, but carrying the flag is far
from an automatic rejection.

**Why:** Reading this field as "scrap" overstates losses by roughly 2.7× — an error I shipped in a
quality report before catching it. The real write-off metric is `quality_grade = 'C (Reject)'`.

**How to apply:** For scrap/loss figures use `quality_grade = 'C (Reject)'`. Treat the
"Can't be Reworked" count as a margin-erosion indicator (downgrade risk), not a scrap count.
Corroborating signal: this cohort's top defects are Porosity, Vertical Line, Chipout and Crack
(body/structural), whereas Contamination — the top defect overall — mostly polishes out.

Related: [[polish-qc-date-fields]]
