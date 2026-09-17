---
name: commercial-module-decisions
description: Commercial module — 66 owner answers over three rounds, deployed to production 2026-09-09; round four sent, four desks on four roles.
metadata:
  type: project
---

Pacific ERP's Commercial module. **Deployed to production on 2026-09-09** (main
`e03e081`) — it is no longer on the `commercial-module` branch, and any earlier
note saying so is stale.

Sixty-six owner answers are built in and recorded, one file per round, in
`docs/commercial-module/`: DECISIONS.md (31, 2026-09-07), DECISIONS-2.md (20,
2026-09-08), DECISIONS-3.md (15, 2026-09-09). OPEN-QUESTIONS-4.md is the
fourteen questions sent back on 2026-09-09; every one has a default and the
module runs on it, so nothing is blocked waiting for answers.

Four desks, four roles (`src/lib/commercial/access-rules.ts`, area model
`commercialGate(action, area)`):

| desk | login | role |
|---|---|---|
| Santosh Thapa | mis.pespl@thepacific.group | `COMMERCIAL_MANAGER` — done 2026-09-09 |
| Setumani R | Commercial@pacific-surfaces.com | `COMMERCIAL_EXEC` — **owner must create** |
| Raghav | Docs@pacific-surfaces.com | `COMMERCIAL_DOCS` — **owner must create** |
| Murali | customs@pacific-surfaces.com | `COMMERCIAL_LOGISTICS` — **owner must create** |

Two things worth not rediscovering:

* **A role change needs a `session_version` bump.** `src/auth.ts` writes the
  role into the JWT at sign-in and never re-reads it; only `sessionVersion` is
  revalidated per request. Change a role in SQL without bumping it and the
  person keeps the old role until they next sign in. Users & Roles does the
  bump itself — match it when going round the UI.
* **Commercial is an OFFICE module.** The shop-floor sidebar carries only
  `/office/commercial/dispatch-check`, which is the one part bay 5 works.

Schema is scripts 0076, 0077, 0079, 0080, 0081 — all applied and verified
against Neon. See [[neon-db-state]].
