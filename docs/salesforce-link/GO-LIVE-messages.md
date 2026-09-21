# Go-live — the two messages, and what happens between them

Hold until the administrator confirms he has updated the check list to **197** and
**~845** (REPLY-13). Then run these in order.

---

## STEP 1 — send this, then set the variable

> **Subject: Setting `SF_ENABLED` now — 〈HH:MM〉 IST, 〈date〉**
>
> Setting `SF_ENABLED` now, at **〈HH:MM〉 IST**. The sync cron runs every ten minutes, so
> the first writing run will begin within ten minutes of this message.
>
> We will write again when it has **finished**, not when it starts, and we will send the
> run's own figures so you can compare them against your query rather than take ours.
>
> Reminder of the two corrected expectations: about **845** `ERP_Stock__c` rows, and
> **197** with `Product_Missing__c = true`.

Fill in the real time. He asked for it specifically, so that if anything odd appears in the
org he can tell our first run apart from his own test rows.

---

## STEP 2 — set the variable

**Vercel → the Pacific-ERP project → Settings → Environment Variables**

| | |
|---|---|
| Key | `SF_ENABLED` |
| Value | `1` |
| Environment | **Production** only |

Then **Deployments → the latest production deployment → ⋯ → Redeploy.**

**The redeploy is not optional.** An environment variable reaches a running deployment only
when that deployment is rebuilt; set it without redeploying and the route will go on
answering *"SF_ENABLED is not set, so nothing is written"* while the dashboard shows the
variable present. That gap has fooled better people than us.

---

## STEP 3 — watch the first run

Open **`/office/salesforce`**. Within ten minutes a run appears. What a good first run looks
like:

| Figure | Expect |
|---|---|
| `stockRows.toPush` | **845** — everything, because the mirror is empty |
| `stockRows.unchanged` | **0** — for the same reason |
| `wrote.stockRows` | **845** |
| `wrote.products` | **169** |
| `wrote.failures` | **empty** |
| `productMissingRows` | **197** |
| `stoodDown` | **null** |
| `ourCalls.thisRun` | single figures |

Every later run should read `toPush` near zero and `unchanged` near 845. That is the diff
working: only what changed costs a call.

**If `stoodDown` is not null**, the run declined to write and both alerts have fired — the
ops Telegram group will have a message and the administrator will have been paged. Nothing
is broken and nothing is lost; the next run sends it. Do not set anything else.

**If `wrote.failures` is non-empty**, send us the list before telling the administrator it
worked.

---

## STEP 4 — send this once it has FINISHED

> **Subject: First writing run has finished**
>
> The first writing run finished at **〈HH:MM〉 IST**. Our side reports:
>
> - `ERP_Stock__c` rows written: **〈wrote.stockRows〉**
> - Products updated: **〈wrote.products〉**
> - Rows with `Product_Missing__c = true`: **〈productMissingRows〉**
> - Failures: **〈none, or the list〉**
> - API calls for the run: **〈ourCalls.thisRun〉**
>
> `Synced_At__c` on every row carries the run's timestamp. Please check by query whenever
> suits — we have not touched the 26 `T5` rows.
>
> The 30 mm list follows separately, with the 24 unpriced designs marked.

---

## Turning it off

Delete `SF_ENABLED` (or set it to anything other than `1`) and redeploy. The next run
refuses to write within ten minutes.

**This stops future writes. It does not undo what has already been written** — the
administrator has stated he understands that, and it is worth us remembering it too. There
is no unwind; there is only "stop, then correct forward".
