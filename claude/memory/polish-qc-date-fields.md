---
name: polish-qc-date-fields
description: "Dating polish_qc rows needs COALESCE(created_time, imported_at) — the Airtable→ERP cutover in June 2026 split the clocks."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9da69148-6570-4257-b960-766faf7d2335
  modified: 2026-08-10T05:36:50.639Z
---

Pacific ERP `polish_qc` rows are dated by two different clocks because of the Airtable→ERP
migration:

- Rows bulk-imported 2026-06-02 (32,896) and 2026-06-08 (1,053) carry the original Airtable
  `created_time`, spanning 2025-07 to 2026-06.
- Every row from 2026-06-12 onward is ERP-native: `created_time` is NULL and `imported_at` is the
  actual QC entry timestamp. ~9,679 rows as of 2026-08-10.

**Why:** Filtering on `created_time` alone silently drops all post-cutover data — it makes July 2026
look empty when it actually has ~4,975 inspections.

**How to apply:** Date-filter with `COALESCE(created_time, imported_at)`. Note that June 2026 is a
split month (both clocks) so it is not cleanly comparable to its neighbours, and **2026-06-09 to
06-11 have no rows under either clock** — unconfirmed whether records were lost in the cutover or
production paused.

Other integrity quirks in this table: `dispatch_status` is null in 16,473 of 16,474 rows;
`repolish_status` has casing duplicates ("Direct ok" vs "Direct Ok"); inspector names duplicate by
case ("arjun"/"Arjun", "Ganesh Moorthy"/"moorthy").

Related: [[polish-qc-rw-status-semantics]]
