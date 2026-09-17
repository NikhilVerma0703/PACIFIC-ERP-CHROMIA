---
name: salesforce-org-state
description: Pacific's Salesforce org as read 2026-09-14 — deterministic QZ- product codes, sampling objects built but empty, 26 sales orders stuck Pending because the planned middleware was never built.
metadata:
  type: project
---

Read live on 2026-09-14 through the Salesforce connector (signed in as Mohamed
Kursheeth, System Administrator — same person as the ERP's `mohamed.shalman@`
Finance login). Full record: `docs/salesforce-link/DISCOVERY.md` in the ERP repo.

* **Product codes are a function, not a list.** `Product2.ProductCode` =
  `QZ-<NAME uppercased, non-alphanumerics stripped>-<thickness mm>`; 110 active
  quartz products, only 20 mm and 12 mm. `ERP_SKU__c` (55 filled) is identical
  to the code — never ask the owner for "the list of codes".
* **The ERP's yard names are the problem, not the codes.** 383 free-text
  design spellings have no product; map through `fg_design_alias` (canonical
  design), never derive from raw `fg_finished_slab.design`. 30 mm is the
  largest body of ERP stock (10,391 AVAILABLE) and has no Salesforce product.
* **Sampling objects exist and are empty**: `Sample_Dispatch__c` (+Items),
  `Sample_Stand__c` — one test record each. Full field design incl. approval
  fields; the approval process routes EVERY request to the rep's manager, the
  owner wants approval only for stands.
* **26 `Integration_Log__c` rows, all "T5 – Sales order / Outbound / Pending"**,
  newest 2026-09-08: a trigger queues orders for a "middleware" that was never
  built. Surfaced to the owner 2026-09-14; not acted on.
* No Salesforce wiring exists in the ERP (no library, no credentials).

See [[commercial-module-decisions]] (the design-code master) and
[[fg-view-grant]].
