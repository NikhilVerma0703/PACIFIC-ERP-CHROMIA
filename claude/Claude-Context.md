# Claude working context — Pacific ERP

**Session:** 17–18 September 2026 · **Branch:** `main` · **Range:** `aceeb1d` → `892a97a` (15 commits, 41 files, +2,810 / −181)
**Repo:** `vmundra-pacific/Pacific-ERP` · **Working dir:** `C:\Users\user\Desktop\ERP`

This file is a handoff. It records what was changed, **why**, what was found along the way,
and what is still open. Where a decision could have gone another way, the reasoning is here
rather than only in the commit message.

> **The one rule this session kept proving:** a rule kept in two places is a rule kept in
> neither. Four separate bugs this session were the same shape — two halves of the system
> disagreeing about what "the same thing" means. They are marked ⚠ below.

---

## 1. Salesforce stock sync

**Status: scheduled, not yet writing.** `SF_ENABLED` is unset, so the cron runs every ten
minutes, reads everything, and answers `{ok:false, reason:"SF_ENABLED is not set"}`.

### What it does

One Vercel cron, `GET /api/salesforce/sync`, every 10 minutes. Aggregates AVAILABLE, whole,
sales-approved slabs by canonical design and thickness, derives `QZ-NAME-THK`, and writes:

- **`Product2`** — `ERP_Available_Slabs__c`, `ERP_Match__c`, `ERP_Other_Thickness_Stock__c`,
  `ERP_Stock_As_Of__c`, `ERP_SKU__c` where blank. **Only products whose values changed.**
- **`ERP_Stock__c`** — one row per stock line (828 today), keyed on `ERP_Key__c`.
- **Nothing else. No deletes, ever.** No `Integration_Log__c` row is written at all.

### Live numbers (final dry run, 2026-09-17 23:20)

```
304 published lines · 17,237 slabs · 124 of 169 products matched
828 stock rows · ourCalls {thisRun: 2} · stoodDown: null · wrote: nothing
```

### The bug that would have killed every run

`slab_number` is `double precision`. 95 live AVAILABLE slabs are sub-numbered `1.1, 1.2,
2.1…` under real designs (Cedar Charm, Taj Mahal). The unapproved-slab query cast its
parameter `::bigint[]`, so Postgres rejected the first fractional element — *"improper binary
format in array element 501"* (element 501 was `1.5`). The read is `strict` and fails closed,
so **no run could ever reach a write.** It would have looked like a Salesforce problem.

**The fix to not make:** filtering the fractions out makes the query run and silently
publishes unapproved stock to reps, because that array is what gets *subtracted*. A crash is
loud; that would have been quiet and wrong. Cast widened to `::double precision[]`.

### Guards — built, having only been described

`limits.ts` and `client.ts` both claimed the run read `Sforce-Limit-Info` and stood down
below 10% org remaining. **Nothing had ever compared it to anything.** `DAILY_CALL_BUDGET =
1000` was a constant and a unit test, not a brake. Both now exist:

- `orgNearlyOut()` — below 10% of the org's allowance, nothing is written. A **missing header
  reads as UNKNOWN, not empty**, or the sync stands down forever on a header that never arrives.
- `overOwnBudget()` — our own calls, counted in `client.ts`, summed for the day from
  `sf_sync_run` (which nothing had ever written a row to).

Both are asked **after every read and before the first write**, so a run that stands down
still returns the full picture of what it would have sent.

### The trial rule, and the trap in it

`Trial` is a canonical in `fg_design_alias` with **133 experimental variants** mapped onto it.
Being a canonical made it pass the publish rule — 740 slabs of experiments would have reached
reps as sellable stock.

⚠ **A product beats the marker.** A word-boundary test for "trail" withheld
`Astral Mist Kreos Trail-2` — a design the org genuinely sells as
`QZ-ASTRALMISTKREOSTRAIL2-20`. Caught by the test suite before it shipped. The marker now
decides only names Salesforce has never heard of. `Industrial` was always safe and is pinned.

### Administrator exchange (REPLY-5, REPLY-6)

He was right on all eight of his first points. Checking them found two defects neither side
had named (case folding, and the other two thirds of the Trial problem). His five asks are all
implemented:

| Ask | Done |
|---|---|
| Publish unmatched designs as unlinked lines | +3,499 slabs now visible, `Product_Missing__c` true |
| Trial rule on the yard's own spelling | Yes, with the product-beats-marker exception |
| `Stale__c` — his option 3 | Re-stamp every 30 min, written as **time**, not "every 3rd run" |
| Enforce the call ceiling | Both guards built |
| Pebbles Ice is his spelling | Aliased — 879 slabs across 4 yard spellings |

**Mockingbird** (his question): 1 slab, 2 cm, spelled exactly. Matched directly, no alias.

### Decisions recorded

- **Mocha Mist IS Matcha Mist** — owner, 2026-09-17, overriding the administrator's hold
  ("brown vs green"). 121 slabs now resolve to `QZ-MATCHAMIST-20`. Our matcher had flagged the
  pair as *check*, not *apply* — which is what it is for.
- **Prices for the 24 inactive products: deliberately not raised** with the administrator yet.
- **"Reversible" was overstated and is withdrawn.** Turning `SF_ENABLED` off stops future
  writes. It does **not** undo what is written. There is no rollback.

### ⚠ Still open

1. **Send the administrator the reply.** He believes the 10% org guard already existed —
   it did not until this session. He is relying on it.
2. **`SF_ENABLED=1`** — only after that. Scheduling and allowing writes are two switches.
3. Say **yes** to his *Samples in stock* view change (`Never_Stocked__c = false`), or reps see
   502 empty shelves.

---

## 2. Inventory — slab area

**A slab is 347 × 201 cm = 6.9747 m² = 75.076 sqft.** The CIOT measurement list's own row,
which the packing list, challan and workbook printed all along.

Finished Goods stores it as `137 × 79 inches` on 27,097 of 27,099 rows — **the rounded display
of those centimetres** (347 cm is 136.61 in). Squaring the rounded pair gives 75.16, 0.11%
high. ⚠ The same slab read 75.16 on one screen and 75.076 on another, both from this repo.

- `137 × 79` means *"a slab nobody measured"* → answered from the sheet.
- Any other pair is a real measurement → still multiplied out.
- `slabMeasure` had the same fault a layer down: its fallback rounded 347.98 **up** to 348,
  producing a third figure (75.292).
- The three inventory routes each carried their own copy of the formula — *that is how it
  drifted*. They import the shared one now.

**A test asserted the bug:** `sqftFromIn(137, 79) === 75.16, "the inventory module's own figure"`.

**What moved on paper:** packing lists print `347 × 201`; published yard area fell 2,276 sqft
(20,36,758 → 20,34,481) — the overstatement that was already there.

---

## 3. Inventory — design names

488 distinct names in the yard; 56 on the colour chart. **No master covers the stock.**

### The matcher (`src/lib/inventory/designSuggest.ts`, pure)

Three owner examples define it, and they cannot all be satisfied by a threshold:

```
"Antique Greya"  IS      "Antique Grey"    1 character apart
"Arlina Chromia" IS      "Arlina"          a line word on the end
"Arena"          IS NOT  "Arlina"          2 apart, both real designs
```

So it **ranks and explains; a human presses the button.** Nothing merges on its own. Arena /
Arlina has its own test, because every merge tool that has done damage was confident about a
pair like that.

- **Line words** (Chromia, Kreos, Robo…) come off either end — that is what turns a 0.57
  distance into an exact match.
- **`Trial`/`Trail` are deliberately NOT line words** — folding them would undo the Salesforce
  trial rule by the back door.
- Distance is **relative**, so a short name is judged more strictly.

### What the real data said

Only **16 of 104** backlog names get a suggestion — and the matcher is right to stay quiet.
`Sea Pearl` (547), `Sparkle White` (449), `Antique Grey` (250), `DESERT SILK` (146) are **real
designs missing from the colour chart**, not misspellings. The screen says so rather than
offering a wrong merge.

### ⚠ The two Alabaster Noir columns

`Alabaster Noir` (350) and `Alabaster noir` (1) showed as two columns. The two halves
disagreed again:

- display routes folded with an **exact** lookup → case twin stayed its own design;
- the new worklist folds **case** → considered it already resolved, never offered it.

Invisible to the tool that would fix it, visible as a duplicate column. One resolver now
(`buildDesignResolver`), used by Slabs by design, the slab list and the export.

**490 columns → 201.** Nineteen names / 1,206 slabs folded by case alone. It also repaired
merges that were *already leaking*: Varun had merged `Bellagio Gold` → Honeydew, but
`Bellagio gold` escaped it.

### ⚠ The regression I introduced, then found

Folding the column without folding the **drill-through** meant clicking a design returned
fewer slabs than the column claimed. Sixteen designs disagreed:

```
Honeydew  column 969 → drill-through 505   (464 missing)
Artemis   column 144 → drill-through  93   ( 51 missing)
```

Found by checking rather than hoping the class of bug had one instance.

### Deliberately NOT changed

The **approval key** in `searchWhere.ts:412` still folds by exact lookup. Widening it changes
**which stock is hidden** from non-admins, not what a column is called. **Owner's call.**

---

## 4. Production planning — its own Office tab

Moved `/office/commercial/production-planning` → `/office/production-planning`, plus
`/office/approved-plan` (read-only) for the plant's managers.

⚠ **Moving a page out of a gated prefix is a widening, not a rename.** Everything under
`/office/commercial` is refused by `maySeeCommercialModule`; a path outside inherits none of
it. Shipped naively it would have opened the queue to every uncapped login reaching `/office`.
One pure rule (`lib/production-plan/access-rules.ts`) is imported by middleware, both pages
and the nav.

| | board | approved plan |
|---|---|---|
| ADMIN | ALLOW | ALLOW |
| LINE_MANAGER | refused | **ALLOW** |
| INCHARGE / commercial desks / anon | refused | refused |

- **"Approved" = SCHEDULED or IN_PRODUCTION.** There is no APPROVED status; adding one was
  declined as bigger than the ask. QUEUED is withheld — a floor working to an unsettled
  running order is the failure this prevents.
- Named `approved-plan`, not `production-plan`: the latter is a **mid-segment prefix** of
  `production-planning`, which `navHighlight.test.ts` caught.
- Nav rows added — `/office` redirects non-OFFICE branches, so without them a LINE_MANAGER
  could only reach it by typing the URL.

---

## 5. Batch report — QC grades split by thickness

Each QC grade bar is stacked by thickness **in the same bar**, keeping its grade colour, drawn
as shades of that grade. Thickness comes from the **shared resolver**, not `polish_qc`'s raw
string, so `3cm` and `3 cm` do not become two bands. *"Not recorded"* is an absence, not a
thickness — grey, stacked last. Both `/batch` and `/office/batch-lookup`.

---

## 6. Deliverables produced

| | |
|---|---|
| `docs/salesforce-link/SALESFORCE-ADMIN-TASKS.md` | The corrected handoff (in repo) |
| Commercial Handbook | Published artifact, desk-filtered — **send the link, not a file** |
| `docs/salesforce-link/DESIGN.md` | 32 drift findings corrected |

---

## 7. Environment

Set in Vercel: `SF_LOGIN_URL` (the **My Domain** host — the client-credentials grant fails
against `login.salesforce.com`), `SF_CLIENT_ID`, `SF_CLIENT_SECRET`. `CRON_SECRET` already
existed. **`SF_ENABLED` deliberately unset.**

Local `.env.local` carries the same three.
⚠ **`DATABASE_URL`, `AUTH_SECRET` and `FINANCE_ENGINE_KEY` were pasted into a chat transcript
this session and have NOT been rotated.** The owner declined. Recorded because it is still true.

---

## 8. Gates

`tsc` clean · **2,826 / 2,826 tests** (+56 this session) · `next build` compiles.

`npm test` runs through `--experimental-strip-types`, which **erases types but cannot
transform them**. Constructor parameter properties and extensionless imports make a module
unloadable — `client.ts` had both, so it had zero coverage and nothing failed. Fixed; the
first test in `salesforceClient.test.ts` guards the import itself.

---

## 9. Open items

| Who | What |
|---|---|
| **Owner** | Send the administrator the reply (**he is relying on a guard that only just became real**) |
| **Owner** | `SF_ENABLED=1`, after the above. Not reversible in the sense of undoing writes |
| **Owner** | ~35 real designs missing from the colour chart (Sea Pearl, Sparkle White, Antique Grey…) |
| **Owner** | Approval-key folding — changes which stock is hidden |
| **Owner** | Rotate the three leaked secrets (declined so far) |
| **Owner** | Prices for the 24 inactive Salesforce products |
| **Admin** | Relabel `ERP_Stock_As_Of__c` → "when this count last changed" |
| **Deferred** | Design-name rewrite across the 22 tables that hold one. **Not done** — merges change what screens display; stored text is untouched and reversible |
