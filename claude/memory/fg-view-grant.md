---
name: fg-view-grant
description: users.fg_view is a per-login read-only finished-goods grant (chromia@, gibin@); revoking it needs a session_version bump or the old token keeps it until next sign-in.
metadata:
  type: project
---

Finished-goods visibility for a login OFF the Office branch is a per-login
boolean, `users.fg_view` (scripts/0083, 2026-09-14), not a role. Granted to
`chromia@thepacific.group` (LINE_MANAGER/CHROMIA) and `gibin@thepacific.group`
(LINE_MANAGER/FABRICATION) at the owner's request: "full visibility but no
edit options".

Things worth not rediscovering:

* **The flag rides in the JWT and is never re-read.** Granting or revoking it
  needs `session_version = session_version + 1` in the same UPDATE, or the
  person keeps their old token's answer until they next sign in of their own
  accord. Users & Roles does the bump itself; a hand UPDATE must too.
* **The gate split runs fail-closed.** `inventoryGate()` is the WRITE-strength
  gate and is built on `canWriteInventory()`, which has no fgView term — a new
  write route gated the usual way refuses a viewer by default. Reads opt in to
  `inventoryReadGate()` by name. Do not invert this.
* **The fence and the gates share one function.** `hasFgView` in
  `src/lib/inventory/accessRules.ts` (pure, import-free) is what middleware,
  `auth.config.ts`'s `authorized()`, and every route gate ask. `fgViewMayVisit`
  in `lib/routeCaps.ts` names the only paths the grant opens: `/inventory*`,
  `/api/inventory*`, and the exact path `/api/photo` (scoped in-route to
  model `FinishedSlab`).
* **A viewer's page load still runs `sweepExpiredReservations()`.** That is
  deliberate: the clock picks the rows, the viewer cannot aim it, and the same
  holds would lapse on the next office read. Argued in `access.ts`.
* **There is deliberately NO "viewer" option in the admin view-as simulator.**
  The first cut added one; the owner saw it the same day and asked for the
  finished-goods screen to be reverted ("Why has the UI changed for finished
  goods. Please revert it back", 2026-09-14). For every login that already had
  the module it was the only visible change the grant made. A test now pins it
  absent. Do not re-add it without asking.

See [[commercial-module-decisions]] for the module the inventory bridge feeds.
